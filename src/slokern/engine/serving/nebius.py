from typing import Dict, Any, Union, Iterator, AsyncIterator
import asyncio

# flake8: noqa: E501,F401,F811,E402,E302,E305,W293
from slokern.engine.serving.base import (
    BaseServingAdapter,
    ServingRequest,
    ServingResponse,
    TokenChunk,
    ConfigurationError,
)
from slokern.contracts.config import CandidateConfig
from slokern.contracts.enums import ParameterStatus
from slokern.engine.serving.capabilities import RuntimeCapabilities, ParameterSpec


class NebiusCloudAdapter(BaseServingAdapter):
    """
    Adapter for Nebius Token Factory (managed endpoint).
    Supports only client request parameters, rejects engine settings.
    """

    def get_capabilities(self) -> RuntimeCapabilities:
        return RuntimeCapabilities(
            runtime_name="NebiusCloudTokenFactory",
            supported_models=[
                "nvidia/Nemotron-3-Nano-30B-A3B",
                "meta-llama/Meta-Llama-3-8B-Instruct",
            ],
            parameters={
                # Supports client-side flags only
                "max_tokens": ParameterSpec(
                    name="max_tokens", param_type="int", default=128
                ),
                "temperature": ParameterSpec(
                    name="temperature", param_type="float", default=0.0
                ),
            },
            supports_streaming=True,
            supports_dynamic_batching=True,
            max_concurrency=256,
        )

    def apply_config(
        self, candidate_config: CandidateConfig, strict: bool = False
    ) -> CandidateConfig:
        caps = self.get_capabilities()
        eff_settings, param_status, notes = caps.evaluate_settings(
            candidate_config.requested_settings
        )

        rejected = []
        unsupported = []

        for p, status in param_status.items():
            if status == ParameterStatus.REJECTED:
                rejected.append(p)
            elif status == ParameterStatus.UNSUPPORTED:
                unsupported.append(p)

        # If strict or there are rejected/unsupported engine settings requested
        if rejected or unsupported:
            msg = f"Cannot apply config: rejected={rejected}, unsupported={unsupported}. Notes: {notes}"
            raise ConfigurationError(msg)

        candidate_config.effective_settings = eff_settings
        self._current_config = candidate_config
        return candidate_config

    def health_check(self) -> bool:
        # Mocked as true for unverified integration
        return True

    def get_environment_fingerprint(self) -> Dict[str, Any]:
        return {"provider": "Nebius", "adapter": "NebiusCloudAdapter"}

    def generate(self, request: Union[ServingRequest, str]) -> ServingResponse:
        raise NotImplementedError("Live execution requires valid credentials")

    def stream_generate(
        self, request: Union[ServingRequest, str]
    ) -> Iterator[TokenChunk]:
        raise NotImplementedError("Live execution requires valid credentials")
