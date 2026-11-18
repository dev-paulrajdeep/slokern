"""
Purpose: Serving adapter connecting to a locally running vLLM instance (WSL2 / Linux).
Owner: Rajdeep
Authority: Aligned with AGENTS.md Section 1, 3, 9, 12, 13 and DEC-0014
"""

import ipaddress
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Iterator, Optional, Union

from slokern.contracts.config import CandidateConfig
from slokern.contracts.enums import ParameterStatus
from slokern.engine.serving.base import (
    BaseServingAdapter,
    ConfigurationError,
    ServingRequest,
    ServingResponse,
    TokenChunk,
)
from slokern.engine.serving.capabilities import ParameterSpec, RuntimeCapabilities
from slokern.engine.serving.ollama import StrictLoopbackRedirectHandler, _probe_local_gpu
from slokern.engine.store.redact import sanitize_secret_message


def _build_vllm_capabilities(runtime_name: str, model_name: str) -> RuntimeCapabilities:
    """
    Defines declared runtime capabilities for local vLLM serving endpoint.
    Dynamic request parameters (concurrency, max_tokens, temperature) are declared as supported.
    Process startup flags (max_num_seqs, max_num_batched_tokens) are registered with their
    fixed physical defaults on the local host.
    """
    return RuntimeCapabilities(
        runtime_name=runtime_name,
        supported_models=[model_name, "Qwen/Qwen3-1.7B", "*"],
        parameters={
            "concurrency": ParameterSpec(
                name="concurrency",
                param_type="int",
                default=2,
                min_value=1,
                max_value=2,
                description="Maximum concurrent in-flight requests (bounded by vLLM --max-num-seqs 2 on RTX 5060)",
            ),
            "concurrency_limit": ParameterSpec(
                name="concurrency_limit",
                param_type="int",
                default=2,
                min_value=1,
                max_value=2,
                description="Maximum concurrent in-flight requests (bounded by vLLM --max-num-seqs 2 on RTX 5060)",
            ),
            "max_tokens": ParameterSpec(
                name="max_tokens",
                param_type="int",
                default=64,
                min_value=1,
                max_value=2048,
                description="Maximum output tokens to generate per completion request",
            ),
            "temperature": ParameterSpec(
                name="temperature",
                param_type="float",
                default=0.0,
                min_value=0.0,
                max_value=2.0,
                description="Sampling temperature (0.0 for deterministic benchmark runs)",
            ),
            "top_p": ParameterSpec(
                name="top_p",
                param_type="float",
                default=1.0,
                min_value=0.0,
                max_value=1.0,
                description="Top-p nucleus sampling probability",
            ),
            "presence_penalty": ParameterSpec(
                name="presence_penalty",
                param_type="float",
                default=0.0,
                min_value=-2.0,
                max_value=2.0,
                description="Presence penalty",
            ),
            "frequency_penalty": ParameterSpec(
                name="frequency_penalty",
                param_type="float",
                default=0.0,
                min_value=-2.0,
                max_value=2.0,
                description="Frequency penalty",
            ),
        },
        supports_streaming=True,
        supports_dynamic_batching=True,
        max_concurrency=2,
    )


def classify_qwen3_text(text: str) -> Dict[str, Any]:
    """
    Classifies generated text from Qwen3 into reasoning (<think>...</think>),
    final content, and unclassified blocks.
    Returns token counts and character breakdowns.
    """
    reasoning_text = ""
    content_text = text
    unclassified_text = ""

    think_match = re.search(r"<think>(.*?)</think>", text, re.DOTALL)
    if think_match:
        reasoning_text = think_match.group(1).strip()
        content_text = (text[:think_match.start()] + text[think_match.end():]).strip()
    elif "<think>" in text and "</think>" not in text:
        # Incomplete think block (e.g. truncated generation)
        parts = text.split("<think>", 1)
        content_text = parts[0].strip()
        reasoning_text = parts[1].strip()
        unclassified_text = "truncated_think_block"

    # Token heuristic: whitespace words + punctuation count
    reasoning_toks = len(reasoning_text.split()) if reasoning_text else 0
    content_toks = len(content_text.split()) if content_text else 0

    return {
        "reasoning_tokens": reasoning_toks,
        "content_tokens": content_toks,
        "total_classified_tokens": reasoning_toks + content_toks,
        "has_reasoning": bool(reasoning_text),
        "unclassified_flag": unclassified_text if unclassified_text else None,
    }


class VLLMServingAdapter(BaseServingAdapter):
    """
    Serving adapter connecting to a locally running vLLM instance on loopback (WSL2 / Linux).
    Supports OpenAI-compatible /v1/ endpoints, monotonic streaming token instrumentation,
    Prometheus /metrics scraping, and Qwen3 reasoning token classification.
    """

    DEFAULT_BASE_URL = "http://localhost:8000"
    DEFAULT_MODEL = "slokern-qwen3-1.7b"
    DEFAULT_RUNTIME_NAME = "vllm"

    def __init__(
        self,
        model_name: Optional[str] = None,
        runtime_name: str = DEFAULT_RUNTIME_NAME,
        base_url: Optional[str] = None,
        timeout_s: float = 60.0,
        allow_remote: bool = False,
        scrape_prometheus: bool = True,
        capabilities: Optional[RuntimeCapabilities] = None,
    ) -> None:
        resolved_model = model_name or os.environ.get("VLLM_MODEL_ID", self.DEFAULT_MODEL)
        super().__init__(model_name=resolved_model, runtime_name=runtime_name)

        raw_url = base_url or os.environ.get("VLLM_BASE_URL", self.DEFAULT_BASE_URL)
        self.base_url = self._validate_and_normalize_url(raw_url, allow_remote=allow_remote)
        env_timeout = os.environ.get("VLLM_TIMEOUT_S")
        self.timeout_s = float(env_timeout) if env_timeout else timeout_s
        self.scrape_prometheus = scrape_prometheus
        self.capabilities = capabilities or _build_vllm_capabilities(runtime_name, resolved_model)
        self._opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}), StrictLoopbackRedirectHandler()
        )

    def _validate_and_normalize_url(self, raw_url: str, allow_remote: bool = False) -> str:
        """
        Validates the base URL against strict loopback security rules and userinfo prohibitions.
        """
        parsed = urllib.parse.urlsplit(raw_url)
        if not parsed.scheme or not parsed.netloc:
            raise ConfigurationError(f"Invalid vLLM base_url '{raw_url}': missing scheme or netloc")

        if parsed.username or parsed.password or "@" in parsed.netloc:
            raise ConfigurationError(
                f"URL credentials (userinfo) are prohibited in vLLM base_url '{raw_url}'"
            )

        hostname = (parsed.hostname or "").lower()
        if not hostname:
            raise ConfigurationError(f"Invalid vLLM base_url '{raw_url}': missing hostname")

        remote_allowed = allow_remote or (
            os.environ.get("VLLM_ALLOW_REMOTE", "").strip().lower() in ("1", "true")
        )

        is_loopback = False
        if hostname in ("localhost", "localhost."):
            is_loopback = True
        else:
            try:
                ip = ipaddress.ip_address(hostname)
                is_loopback = ip.is_loopback
            except ValueError:
                is_loopback = False

        if not is_loopback and not remote_allowed:
            raise ConfigurationError(
                f"Host '{hostname}' is not a permitted loopback address (127.0.0.1, localhost, ::1). "
                f"Remote vLLM access must be explicitly enabled via allow_remote=True or VLLM_ALLOW_REMOTE=1."
            )

        return raw_url.rstrip("/")

    def _sanitize(self, msg: str) -> str:
        return sanitize_secret_message(msg)

    def _build_headers(self) -> Dict[str, str]:
        """Constructs headers. Note: Authorization header omitted for local isolation."""
        return {
            "Content-Type": "application/json",
            "User-Agent": "SLOKern/1.0",
        }

    def get_capabilities(self) -> RuntimeCapabilities:
        """Returns declared capabilities and supported parameter envelope."""
        return self.capabilities

    def get_environment_fingerprint(self) -> Dict[str, Any]:
        """Returns local hardware/runtime environment documentation."""
        parsed = urllib.parse.urlsplit(self.base_url)
        fp: Dict[str, Any] = {
            "provider": "vllm",
            "endpoint_host": parsed.netloc or "localhost:8000",
            "runtime_name": self.runtime_name,
            "model_name": self.model_name,
            "is_simulated": False,
            "security_boundary": "strict_loopback",
            "execution_mode": "enforce_eager",
            "attention_backend": "FlashAttention-2",
            "max_model_len": 4096,
            "max_num_seqs": 2,
            "gpu_memory_utilization": 0.80,
            "dtype": "bfloat16",
            "evidence_classification": "LIVE",
        }
        gpu = _probe_local_gpu()
        if gpu:
            fp.update(gpu)
        return fp

    def check_readiness(self) -> Dict[str, Any]:
        """
        Probes local vLLM daemon readiness via GET /health and verifies model via GET /v1/models.
        Returns detailed readiness dictionary.
        """
        # 1. Health check
        health_endpoint = f"{self.base_url}/health"
        health_req = urllib.request.Request(
            health_endpoint,
            headers=self._build_headers(),
            method="GET",
        )
        try:
            with self._opener.open(health_req, timeout=min(5.0, self.timeout_s)) as resp:
                if resp.status != 200:
                    return {
                        "ready": False,
                        "status": "daemon_error",
                        "daemon_reachable": True,
                        "model_available": False,
                        "error": f"vLLM daemon returned HTTP {resp.status} on /health.",
                    }
        except urllib.error.URLError as exc:
            reason = str(exc.reason)
            return {
                "ready": False,
                "status": "connection_error",
                "daemon_reachable": False,
                "model_available": False,
                "message": f"Cannot connect to vLLM daemon at {self.base_url}: {reason}. Ensure vLLM is running.",
                "error": f"Cannot connect to vLLM daemon at {self.base_url}: {reason}. Ensure vLLM is running.",
            }
        except Exception as exc:
            return {
                "ready": False,
                "status": "connection_error",
                "daemon_reachable": False,
                "model_available": False,
                "message": f"Error probing vLLM endpoint: {exc}",
                "error": f"Error probing vLLM endpoint: {exc}",
            }

        # 2. Model catalog check
        models_endpoint = f"{self.base_url}/v1/models"
        models_req = urllib.request.Request(
            models_endpoint,
            headers=self._build_headers(),
            method="GET",
        )
        try:
            with self._opener.open(models_req, timeout=min(5.0, self.timeout_s)) as resp:
                if resp.status != 200:
                    return {
                        "ready": False,
                        "status": "daemon_error",
                        "daemon_reachable": True,
                        "model_available": False,
                        "error": f"vLLM daemon returned HTTP {resp.status} on /v1/models.",
                    }
                body = resp.read().decode("utf-8")
                data = json.loads(body)
                models = data.get("data", [])
                target = self.model_name.lower()

                discovered_ids = []
                for m in models:
                    m_id = str(m.get("id", "")).strip()
                    discovered_ids.append(m_id)
                    if m_id.lower() == target or target in m_id.lower():
                        return {
                            "ready": True,
                            "status": "ready",
                            "daemon_reachable": True,
                            "model_available": True,
                            "discovered_models": discovered_ids,
                            "message": f"vLLM daemon ready with model '{self.model_name}'.",
                        }

                return {
                    "ready": False,
                    "status": "model_missing",
                    "daemon_reachable": True,
                    "model_available": False,
                    "discovered_models": discovered_ids,
                    "message": f"vLLM daemon reachable, but model '{self.model_name}' not found. Available: {discovered_ids}",
                    "error": f"vLLM daemon reachable, but model '{self.model_name}' not found. Available: {discovered_ids}",
                }
        except Exception as exc:
            return {
                "ready": False,
                "status": "model_check_error",
                "daemon_reachable": True,
                "model_available": False,
                "message": f"Error querying vLLM models: {exc}",
                "error": f"Error querying vLLM models: {exc}",
            }

    def health_check(self) -> bool:
        """
        Probes local vLLM daemon readiness via GET /health and verifies model availability.
        """
        return bool(self.check_readiness().get("ready", False))

    def apply_config(
        self,
        candidate_config: CandidateConfig,
        strict: bool = False,
    ) -> CandidateConfig:
        """
        Applies candidate configuration to vLLM adapter.
        Evaluates dynamic parameters against capabilities.
        Startup parameters (such as max_num_batched_tokens) are categorized as UNSUPPORTED
        unless they match the verified physical startup configuration.
        """
        if not self.capabilities.is_model_supported(candidate_config.model_name):
            raise ConfigurationError(
                self._sanitize(
                    f"Model '{candidate_config.model_name}' is not supported by runtime '{self.runtime_name}'."
                )
            )

        normalized_requested = dict(candidate_config.requested_settings)
        if "concurrency" in normalized_requested and "concurrency_limit" not in normalized_requested:
            normalized_requested["concurrency_limit"] = normalized_requested["concurrency"]
        elif "concurrency_limit" in normalized_requested and "concurrency" not in normalized_requested:
            normalized_requested["concurrency"] = normalized_requested["concurrency_limit"]

        effective_settings, parameter_status, notes = self.capabilities.evaluate_settings(
            normalized_requested
        )

        if strict:
            rejected_or_unsupported = {
                k: v for k, v in parameter_status.items()
                if v in (ParameterStatus.REJECTED, ParameterStatus.UNSUPPORTED)
            }
            if rejected_or_unsupported:
                raise ConfigurationError(
                    self._sanitize(
                        f"Configuration rejected by runtime '{self.runtime_name}': {rejected_or_unsupported}. "
                        f"Notes: {notes}"
                    )
                )

        cand_id = candidate_config.candidate_id
        if not cand_id:
            from slokern.core.search.candidate_id import generate_candidate_id

            cand_id = generate_candidate_id(
                candidate_config.model_name,
                self.runtime_name,
                candidate_config.requested_settings,
            )

        updated_config = CandidateConfig(
            candidate_id=cand_id,
            model_name=candidate_config.model_name,
            runtime_name=self.runtime_name,
            requested_settings=candidate_config.requested_settings,
            effective_settings=effective_settings,
            parameter_status=parameter_status,
            environment_fingerprint=self.get_environment_fingerprint(),
        )
        self._current_config = updated_config
        return updated_config

    def _normalize_request(self, request: Union[ServingRequest, str]) -> ServingRequest:
        if isinstance(request, str):
            return ServingRequest(prompt=request)
        return request

    def generate(self, request: Union[ServingRequest, str]) -> ServingResponse:
        """
        Synchronously executes a non-streaming completion against /v1/chat/completions.
        Measures client-observed start-to-completion duration via monotonic timing.
        """
        req = self._normalize_request(request)
        endpoint = f"{self.base_url}/v1/chat/completions"

        max_tokens = req.max_tokens
        temperature = req.temperature
        if self._current_config and self._current_config.effective_settings:
            eff = self._current_config.effective_settings
            if "max_tokens" in eff and eff["max_tokens"] is not None:
                max_tokens = int(eff["max_tokens"])
            if "temperature" in eff and eff["temperature"] is not None:
                temperature = float(eff["temperature"])

        payload = {
            "model": self.model_name,
            "messages": [{"role": "user", "content": req.prompt}],
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": False,
        }
        data_bytes = json.dumps(payload).encode("utf-8")

        http_req = urllib.request.Request(
            endpoint,
            data=data_bytes,
            headers=self._build_headers(),
            method="POST",
        )

        t_start = time.perf_counter()
        try:
            with self._opener.open(http_req, timeout=self.timeout_s) as resp:
                t_end = time.perf_counter()
                status_code = resp.status
                body = resp.read().decode("utf-8")
                total_latency_ms = round((t_end - t_start) * 1000.0, 2)

                resp_data = json.loads(body)
                if "error" in resp_data:
                    sanitized_err = self._sanitize(str(resp_data["error"]))
                    return ServingResponse(
                        request_id=req.request_id,
                        run_id=req.run_id,
                        text="",
                        input_tokens=max(1, len(req.prompt.split())),
                        output_tokens=0,
                        first_token_latency_ms=None,
                        itl_observations_ms=[],
                        total_latency_ms=total_latency_ms,
                        status_code=500,
                        error=sanitized_err,
                        error_type="server_error",
                        metadata={"provider": "vllm", "live": True},
                    )

                choices = resp_data.get("choices", [])
                text = ""
                if choices:
                    text = choices[0].get("message", {}).get("content", "")

                usage = resp_data.get("usage", {})
                input_tokens = usage.get("prompt_tokens", max(1, len(req.prompt.split())))
                output_tokens = usage.get("completion_tokens", max(0, len(text.split())))

                # Classify Qwen3 tokens
                classification = classify_qwen3_text(text)

                metadata: Dict[str, Any] = {
                    "provider": "vllm",
                    "model": self.model_name,
                    "live": True,
                    "reasoning_tokens": classification["reasoning_tokens"],
                    "content_tokens": classification["content_tokens"],
                    "has_reasoning": classification["has_reasoning"],
                }

                return ServingResponse(
                    request_id=req.request_id,
                    run_id=req.run_id,
                    text=text,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    first_token_latency_ms=total_latency_ms,
                    itl_observations_ms=[],
                    total_latency_ms=total_latency_ms,
                    status_code=status_code,
                    error=None,
                    error_type=None,
                    metadata=metadata,
                )

        except urllib.error.HTTPError as exc:
            total_latency_ms = round((time.perf_counter() - t_start) * 1000.0, 2)
            error_body = ""
            try:
                error_body = exc.read().decode("utf-8")
            except Exception:
                pass
            sanitized_err = self._sanitize(f"HTTP {exc.code} {exc.reason}: {error_body}")
            error_type = "cuda_out_of_memory" if "out of memory" in error_body.lower() else "server_error"

            return ServingResponse(
                request_id=req.request_id,
                run_id=req.run_id,
                text="",
                input_tokens=max(1, len(req.prompt.split())),
                output_tokens=0,
                first_token_latency_ms=None,
                itl_observations_ms=[],
                total_latency_ms=total_latency_ms,
                status_code=exc.code,
                error=sanitized_err,
                error_type=error_type,
                metadata={"provider": "vllm", "live": True},
            )

        except (urllib.error.URLError, TimeoutError, ConfigurationError) as exc:
            total_latency_ms = round((time.perf_counter() - t_start) * 1000.0, 2)
            sanitized_err = self._sanitize(f"Network error: {exc}")
            is_timeout = "timed out" in str(exc).lower() or isinstance(exc, TimeoutError)

            return ServingResponse(
                request_id=req.request_id,
                run_id=req.run_id,
                text="",
                input_tokens=max(1, len(req.prompt.split())),
                output_tokens=0,
                first_token_latency_ms=None,
                itl_observations_ms=[],
                total_latency_ms=total_latency_ms,
                status_code=504 if is_timeout else 502,
                error=sanitized_err,
                error_type="timeout" if is_timeout else "network_error",
                metadata={"provider": "vllm", "live": True},
            )

    def stream_generate(self, request: Union[ServingRequest, str]) -> Iterator[TokenChunk]:
        """
        Executes a streaming request against /v1/chat/completions (stream=True).
        Parses SSE stream line-by-line, determining client-observed TTFT on the first
        chunk containing non-empty content or reasoning_content using time.perf_counter().
        Captures chunk-gap ITL deltas and tags reasoning vs content tokens.
        """
        req = self._normalize_request(request)
        endpoint = f"{self.base_url}/v1/chat/completions"

        max_tokens = req.max_tokens
        temperature = req.temperature
        if self._current_config and self._current_config.effective_settings:
            eff = self._current_config.effective_settings
            if "max_tokens" in eff and eff["max_tokens"] is not None:
                max_tokens = int(eff["max_tokens"])
            if "temperature" in eff and eff["temperature"] is not None:
                temperature = float(eff["temperature"])

        payload = {
            "model": self.model_name,
            "messages": [{"role": "user", "content": req.prompt}],
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": True,
        }
        data_bytes = json.dumps(payload).encode("utf-8")

        http_req = urllib.request.Request(
            endpoint,
            data=data_bytes,
            headers=self._build_headers(),
            method="POST",
        )

        t_start = time.perf_counter()
        last_chunk_time = t_start
        chunk_index = 0
        first_content_received = False
        in_think_block = False

        try:
            with self._opener.open(http_req, timeout=self.timeout_s) as resp:
                for raw_line in resp:
                    line = raw_line.decode("utf-8").strip()
                    if not line:
                        continue

                    # Handle SSE data lines
                    if line.startswith("data:"):
                        line_data = line[5:].strip()
                    else:
                        continue

                    if line_data == "[DONE]":
                        # Final stream termination marker
                        now = time.perf_counter()
                        elapsed_ms = round((now - t_start) * 1000.0, 2)
                        yield TokenChunk(
                            token="",
                            token_id=chunk_index + 1,
                            index=chunk_index,
                            timestamp_ms=elapsed_ms,
                            latency_ms=round((now - last_chunk_time) * 1000.0, 2),
                            is_last=True,
                            error=None,
                            metadata={"provider": "vllm", "live": True, "done": True},
                        )
                        return

                    try:
                        chunk_data = json.loads(line_data)
                    except json.JSONDecodeError:
                        continue

                    # Check for server-reported error
                    if "error" in chunk_data:
                        elapsed_ms = round((time.perf_counter() - t_start) * 1000.0, 2)
                        sanitized_err = self._sanitize(str(chunk_data["error"]))
                        yield TokenChunk(
                            token="",
                            token_id=chunk_index + 1,
                            index=chunk_index,
                            timestamp_ms=elapsed_ms,
                            latency_ms=elapsed_ms if chunk_index == 0 else round((time.perf_counter() - last_chunk_time) * 1000.0, 2),
                            is_last=True,
                            error=sanitized_err,
                            metadata={"provider": "vllm", "live": True, "error_type": "server_error"},
                        )
                        return

                    choices = chunk_data.get("choices", [])
                    if not choices:
                        continue

                    choice = choices[0]
                    delta = choice.get("delta", {})
                    token_str = delta.get("content") or delta.get("reasoning_content") or ""
                    finish_reason = choice.get("finish_reason")

                    # Skip empty initial chunk (often only contains role: "assistant")
                    if not token_str and finish_reason is None:
                        continue

                    now = time.perf_counter()
                    elapsed_ms = round((now - t_start) * 1000.0, 2)

                    # Track TTFT on first content-bearing token
                    if not first_content_received and token_str:
                        first_content_received = True
                        latency_ms = elapsed_ms  # TTFT
                    else:
                        latency_ms = round((now - last_chunk_time) * 1000.0, 2)  # ITL

                    last_chunk_time = now

                    # Track reasoning block state
                    if "<think>" in token_str:
                        in_think_block = True
                    is_reasoning = in_think_block or bool(delta.get("reasoning_content"))
                    if "</think>" in token_str:
                        in_think_block = False

                    is_last = finish_reason is not None

                    chunk_meta = {
                        "provider": "vllm",
                        "live": True,
                        "token_category": "reasoning" if is_reasoning else "content",
                    }

                    yield TokenChunk(
                        token=token_str,
                        token_id=chunk_index + 1,
                        index=chunk_index,
                        timestamp_ms=elapsed_ms,
                        latency_ms=latency_ms,
                        is_last=is_last,
                        error=None,
                        metadata=chunk_meta,
                    )
                    chunk_index += 1

                    if is_last:
                        return

        except urllib.error.HTTPError as exc:
            elapsed_ms = round((time.perf_counter() - t_start) * 1000.0, 2)
            err_body = ""
            try:
                err_body = exc.read().decode("utf-8")
            except Exception:
                pass
            sanitized_err = self._sanitize(f"HTTP {exc.code} {exc.reason}: {err_body}")
            error_type = "cuda_out_of_memory" if "out of memory" in err_body.lower() else "server_error"

            yield TokenChunk(
                token="",
                token_id=chunk_index + 1,
                index=chunk_index,
                timestamp_ms=elapsed_ms,
                latency_ms=round((time.perf_counter() - last_chunk_time) * 1000.0, 2),
                is_last=True,
                error=sanitized_err,
                metadata={"provider": "vllm", "live": True, "error_type": error_type, "status_code": exc.code},
            )

        except (urllib.error.URLError, TimeoutError, ConfigurationError) as exc:
            elapsed_ms = round((time.perf_counter() - t_start) * 1000.0, 2)
            sanitized_err = self._sanitize(f"Stream network error: {exc}")
            is_timeout = "timed out" in str(exc).lower() or isinstance(exc, TimeoutError)

            yield TokenChunk(
                token="",
                token_id=chunk_index + 1,
                index=chunk_index,
                timestamp_ms=elapsed_ms,
                latency_ms=round((time.perf_counter() - last_chunk_time) * 1000.0, 2),
                is_last=True,
                error=sanitized_err,
                metadata={"provider": "vllm", "live": True, "error_type": "timeout" if is_timeout else "network_error"},
            )

    def scrape_prometheus_metrics(self, timeout_s: float = 5.0) -> Dict[str, Any]:
        """
        Scrapes and parses Prometheus metrics from GET /metrics.
        Returns dictionary of counters, gauges, and histograms.
        """
        endpoint = f"{self.base_url}/metrics"
        req = urllib.request.Request(
            endpoint,
            headers=self._build_headers(),
            method="GET",
        )

        counters: Dict[str, float] = {}
        gauges: Dict[str, float] = {}
        histograms: Dict[str, Dict[str, Any]] = {}

        try:
            with self._opener.open(req, timeout=timeout_s) as resp:
                if resp.status != 200:
                    return {"success": False, "error": f"HTTP {resp.status}"}

                content = resp.read().decode("utf-8", errors="replace")
                for line in content.splitlines():
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue

                    # Parse metric_name{labels} value [timestamp]
                    match = re.match(r"^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([^\s]+)", line)
                    if not match:
                        continue

                    m_name, m_labels, m_val_str = match.groups()
                    try:
                        m_val = float(m_val_str)
                    except ValueError:
                        continue

                    # Categorize histogram components
                    if m_name.endswith("_bucket"):
                        base_name = m_name[:-7]
                        hist = histograms.setdefault(base_name, {"buckets": {}, "sum": 0.0, "count": 0.0})
                        if m_labels and 'le="' in m_labels:
                            le_match = re.search(r'le="([^"]+)"', m_labels)
                            if le_match:
                                le_str = le_match.group(1)
                                le_val = float("inf") if le_str == "+Inf" else float(le_str)
                                hist["buckets"][le_val] = m_val
                    elif m_name.endswith("_sum"):
                        base_name = m_name[:-4]
                        hist = histograms.setdefault(base_name, {"buckets": {}, "sum": 0.0, "count": 0.0})
                        hist["sum"] = m_val
                    elif m_name.endswith("_count"):
                        base_name = m_name[:-6]
                        hist = histograms.setdefault(base_name, {"buckets": {}, "sum": 0.0, "count": 0.0})
                        hist["count"] = m_val
                    elif "total" in m_name:
                        counters[m_name] = m_val
                    else:
                        gauges[m_name] = m_val

                return {
                    "success": True,
                    "counters": counters,
                    "gauges": gauges,
                    "histograms": histograms,
                    "scraped_at": time.time(),
                }
        except Exception as exc:
            return {
                "success": False,
                "error": str(exc),
                "scraped_at": time.time(),
            }

    @staticmethod
    def calculate_prometheus_cross_check(
        before: Dict[str, Any],
        after: Dict[str, Any],
        client_ttft_mean_ms: float,
        skew_threshold_ms: float = 25.0,
    ) -> Dict[str, Any]:
        """
        Cross-checks client-observed TTFT against Prometheus vLLM internal histogram.
        Flags warnings if client vs server TTFT skew exceeds skew_threshold_ms (default: 25.0 ms).
        """
        if not before.get("success") or not after.get("success"):
            return {
                "reconciled": False,
                "warning": "Prometheus scraping failed or unavailable",
            }

        hist_before = before.get("histograms", {}).get("vllm:time_to_first_token_seconds", {})
        hist_after = after.get("histograms", {}).get("vllm:time_to_first_token_seconds", {})

        count_delta = hist_after.get("count", 0.0) - hist_before.get("count", 0.0)
        sum_delta = hist_after.get("sum", 0.0) - hist_before.get("sum", 0.0)

        server_ttft_mean_ms: Optional[float] = None
        if count_delta > 0:
            server_ttft_mean_ms = round((sum_delta / count_delta) * 1000.0, 2)

        skew_ms = (
            round(abs(client_ttft_mean_ms - server_ttft_mean_ms), 2)
            if server_ttft_mean_ms is not None
            else None
        )

        skew_warning = skew_ms is not None and skew_ms > skew_threshold_ms

        return {
            "reconciled": True,
            "count_delta": count_delta,
            "server_ttft_mean_ms": server_ttft_mean_ms,
            "client_ttft_mean_ms": client_ttft_mean_ms,
            "skew_ms": skew_ms,
            "skew_threshold_ms": skew_threshold_ms,
            "skew_warning": skew_warning,
            "warning_message": (
                f"Client vs server TTFT skew {skew_ms}ms exceeds {skew_threshold_ms}ms threshold (potential client queue/socket delay)"
                if skew_warning
                else None
            ),
        }
