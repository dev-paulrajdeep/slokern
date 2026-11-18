"""
Purpose: Campaign lifecycle orchestration, 2x2 grid search execution, status query and SSE streaming.
Owner: Rajdeep
Authority: Aligned with AGENTS.md Section 1, 3, 5, 6, 7 and DEC-0014
"""

import json
import re
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from slokern.api.sse import SSEEventQueue
from slokern.contracts.config import CandidateConfig
from slokern.contracts.enums import (
    ArrivalMode,
    FeasibilityVerdict,
    RankingObjective,
    VerificationState,
)
from slokern.contracts.report import BaselineSummary, SearchSummary
from slokern.contracts.search import CandidateSummary, SearchResult
from slokern.contracts.spec import (
    ExperimentBudget,
    ExperimentSpec,
    ExperimentVerificationPolicy,
    SLOConstraint,
    SLOSpec,
    WorkloadSpec,
)
from slokern.contracts.verification import VerificationRecord
from slokern.core.search.grid import GridSearchController, extract_ranking_metric
from slokern.core.search.rank import EvaluatedCandidate, rank_candidates
from slokern.core.verification.compare import DriftPolicy
from slokern.core.verification.protocol import run_independent_verification
from slokern.engine.reporting.report_builder import build_report_artifact, write_report_artifacts
from slokern.engine.runner.run_executor import SingleRunExecutor
from slokern.engine.serving.factory import create_serving_adapter

ACTIVE_CAMPAIGNS: Dict[str, Dict[str, Any]] = {}
ACTIVE_CAMPAIGN_QUEUES: Dict[str, SSEEventQueue] = {}
CAMPAIGNS_LOCK = threading.Lock()


def get_campaign_queue(campaign_id: str) -> Optional[SSEEventQueue]:
    with CAMPAIGNS_LOCK:
        return ACTIVE_CAMPAIGN_QUEUES.get(campaign_id)


def _execute_campaign_worker(
    campaign_id: str,
    spec: ExperimentSpec,
    adapter_name: str,
    artifacts_root: str,
    sse_queue: SSEEventQueue,
    model_name: Optional[str] = None,
) -> None:
    """
    Background campaign worker executing the 6-run campaign:
    Run 0: Baseline candidate
    Runs 1-4: 4 grid candidates (2x2 grid search)
    Run 5: Independent verification rerun of winner candidate
    """
    try:
        adapter_kwargs = {}
        if model_name:
            adapter_kwargs["model_name"] = model_name
        adapter = create_serving_adapter(
            backend=adapter_name,
            **adapter_kwargs,
        )

        resolved_model = model_name or adapter.model_name or "meta-llama/Meta-Llama-3-8B-Instruct"

        single_run_executor = SingleRunExecutor(
            adapter=adapter,
            artifacts_root=Path(artifacts_root),
            isolate_process=False,
        )

        controller = GridSearchController(
            single_run_executor=single_run_executor,
            adapter=adapter,
            model_name=resolved_model,
            artifacts_root=artifacts_root,
        )

        # Emit campaign_started
        sse_queue.emit("campaign_started", {
            "campaign_id": campaign_id,
            "total_runs": 6,
            "adapter": adapter_name,
            "model_name": resolved_model,
        })

        # Generate candidate configs
        baseline_config = controller._make_config(
            {},
            model_name=resolved_model,
            runtime_name=adapter.runtime_name,
        )

        candidate_settings = controller._candidate_settings(spec)
        grid_configs = [
            controller._make_config(
                settings,
                model_name=resolved_model,
                runtime_name=adapter.runtime_name,
            )
            for settings in candidate_settings[:4]
        ]

        all_search_configs: List[CandidateConfig] = [baseline_config] + grid_configs
        cand_run_ids: Dict[str, str] = {}
        tested_ids: List[str] = []
        candidate_summaries: Dict[str, CandidateSummary] = {}
        evaluated_candidates: List[EvaluatedCandidate] = []
        run_results: List[Any] = []

        # Execute 5 Search Runs (Baseline + 4 Candidates)
        for idx, cand_config in enumerate(all_search_configs):
            if idx == 0:
                run_id = f"run-00-baseline-{cand_config.candidate_id[:6]}"
            else:
                run_id = f"run-{idx:02d}-cand-{cand_config.candidate_id[:6]}"
            cand_run_ids[cand_config.candidate_id] = run_id

            # Emit candidate_started
            sse_queue.emit("candidate_started", {
                "campaign_id": campaign_id,
                "run_index": idx,
                "total_runs": 6,
                "candidate_id": cand_config.candidate_id,
                "run_id": run_id,
                "settings": cand_config.requested_settings,
            })

            def on_progress(completed: int, total: int, current_ttft: Optional[float] = None, _idx=idx, _cid=cand_config.candidate_id, _rid=run_id) -> None:
                sse_queue.emit("request_progress", {
                    "campaign_id": campaign_id,
                    "run_index": _idx,
                    "candidate_id": _cid,
                    "run_id": _rid,
                    "completed": completed,
                    "total": total,
                    "current_ttft_ms": current_ttft,
                })

            run_res = single_run_executor.execute(
                candidate_config=cand_config,
                workload=spec.workload,
                slo=spec.slo,
                experiment_id=campaign_id,
                run_id=run_id,
                is_verification_run=False,
                adapter=adapter,
                progress_callback=on_progress,
                raise_on_failure=False,
            )
            run_results.append(run_res)

            verdict = (
                run_res.feasibility_result.overall_verdict
                if run_res.feasibility_result
                else FeasibilityVerdict.INCONCLUSIVE
            )
            is_feasible = verdict == FeasibilityVerdict.FEASIBLE
            metric_val = (
                extract_ranking_metric(run_res.metric_set, RankingObjective.MAX_THROUGHPUT_UNDER_SLO)
                if is_feasible
                else None
            )

            tested_ids.append(cand_config.candidate_id)
            candidate_summaries[cand_config.candidate_id] = CandidateSummary(
                verdict=verdict,
                ranking_metric=metric_val,
            )

            if run_res.metric_set is not None:
                evaluated_candidates.append(
                    EvaluatedCandidate(
                        candidate_id=cand_config.candidate_id,
                        verdict=verdict,
                        ranking_metric=metric_val,
                        metric_set=run_res.metric_set,
                    )
                )

            # Emit candidate_completed
            sse_queue.emit("candidate_completed", {
                "campaign_id": campaign_id,
                "run_index": idx,
                "candidate_id": cand_config.candidate_id,
                "run_id": run_id,
                "verdict": verdict.value,
                "is_feasible": is_feasible,
                "metric_set": run_res.metric_set.model_dump() if run_res.metric_set else None,
                "ranking_metric": metric_val,
            })

        # Rank Feasible Candidates & Select Winner
        ranked = rank_candidates(evaluated_candidates, RankingObjective.MAX_THROUGHPUT_UNDER_SLO)
        winner = ranked[0] if ranked else None
        winner_config = next((c for c in all_search_configs if winner and c.candidate_id == winner.candidate_id), None)
        if winner and winner_config:
            winning_run = next((r for r in run_results if getattr(r, "applied_config", None) and r.applied_config.candidate_id == winner.candidate_id), None)
            if winning_run and winning_run.applied_config:
                winner_config = winner_config.model_copy(update={
                    "effective_settings": winning_run.applied_config.effective_settings,
                    "parameter_status": winning_run.applied_config.parameter_status,
                    "environment_fingerprint": winning_run.applied_config.environment_fingerprint,
                })

        if winner:
            selection_rationale = (
                f"Selected candidate '{winner.candidate_id}': highest finite output-token "
                f"throughput ({winner.ranking_metric:g} tokens/s) among FEASIBLE tested candidates; "
                f"ties broken deterministically."
            )
        else:
            selection_rationale = (
                f"No candidate among {len(tested_ids)} tested configurations satisfied "
                f"all declared hard SLO constraints; no recommendation selected."
            )

        # Emit winner_selected
        sse_queue.emit("winner_selected", {
            "campaign_id": campaign_id,
            "winner_id": winner.candidate_id if winner else None,
            "winning_config": winner_config.requested_settings if winner_config else {},
            "selection_rationale": selection_rationale,
            "ranking_metric": winner.ranking_metric if winner else None,
        })

        # Persist SearchResult
        campaign_dir = Path(artifacts_root) / "experiments" / campaign_id
        campaign_dir.mkdir(parents=True, exist_ok=True)

        search_result = SearchResult(
            experiment_id=campaign_id,
            baseline_candidate_id=baseline_config.candidate_id,
            tested_candidates=tested_ids,
            candidate_summaries=candidate_summaries,
            ranking_objective=RankingObjective.MAX_THROUGHPUT_UNDER_SLO,
            selected_candidate_id=winner.candidate_id if winner else None,
            selection_rationale=selection_rationale,
            stopping_reason="space_exhausted",
        )
        (campaign_dir / "search_result.json").write_text(search_result.model_dump_json(indent=2), encoding="utf-8")
        (campaign_dir / "experiment_spec.json").write_text(spec.model_dump_json(indent=2), encoding="utf-8")

        # Run 6: Independent Verification Rerun
        verif_record: Optional[VerificationRecord] = None
        if winner and winner_config:
            orig_run_id = cand_run_ids.get(winner.candidate_id, f"run-search-{winner.candidate_id[:6]}")
            verif_run_id = f"run-05-verify-{winner.candidate_id[:6]}"

            # Emit verification_started
            sse_queue.emit("verification_started", {
                "campaign_id": campaign_id,
                "run_index": 5,
                "total_runs": 6,
                "candidate_id": winner.candidate_id,
                "run_id": verif_run_id,
                "original_run_id": orig_run_id,
            })

            def on_verif_progress(completed: int, total: int, current_ttft: Optional[float] = None, _cid=winner.candidate_id, _vrid=verif_run_id) -> None:
                sse_queue.emit("request_progress", {
                    "campaign_id": campaign_id,
                    "run_index": 5,
                    "candidate_id": _cid,
                    "run_id": _vrid,
                    "completed": completed,
                    "total": total,
                    "current_ttft_ms": current_ttft,
                })

            drift_policy = (
                DriftPolicy.from_verification_policy(spec.verification_policy)
                if spec.verification_policy
                else None
            )

            verif_record = run_independent_verification(
                original_run_id=orig_run_id,
                candidate_config=winner_config,
                workload=spec.workload,
                slo=spec.slo,
                experiment_id=campaign_id,
                original_metrics=winner.metric_set,
                drift_policy=drift_policy,
                adapter=adapter,
                single_run_executor=single_run_executor,
                artifacts_root=artifacts_root,
                seed=999,
                persist_record=True,
                existing_run_ids=list(cand_run_ids.values()),
                progress_callback=on_verif_progress,
            )

            # Persist verification_record.json in campaign directory
            (campaign_dir / "verification_record.json").write_text(
                verif_record.model_dump_json(indent=2), encoding="utf-8"
            )

            # Emit verification_completed
            sse_queue.emit("verification_completed", {
                "campaign_id": campaign_id,
                "run_index": 5,
                "verification_id": verif_record.verification_id,
                "verification_run_id": verif_record.verification_run_id,
                "verification_verdict": verif_record.verification_verdict.value,
                "is_verified": verif_record.verification_verdict == VerificationState.VERIFIED,
                "drift_analysis": verif_record.drift_analysis.model_dump() if verif_record.drift_analysis else None,
                "metric_deltas": verif_record.drift_analysis.metric_deltas if verif_record.drift_analysis else {},
            })
        else:
            # Emit verification_completed for inconclusive outcome when no candidate satisfied hard SLO constraints
            sse_queue.emit("verification_completed", {
                "campaign_id": campaign_id,
                "run_index": 5,
                "verification_id": None,
                "verification_run_id": None,
                "verification_verdict": "INCONCLUSIVE",
                "is_verified": False,
                "drift_analysis": None,
                "metric_deltas": {},
                "reason": "Verification skipped: no candidate satisfied hard SLO constraints.",
            })

        # Persist report.md and report.json
        baseline_verdict = (
            candidate_summaries[baseline_config.candidate_id].verdict
            if baseline_config.candidate_id in candidate_summaries
            else FeasibilityVerdict.INCONCLUSIVE
        )
        baseline_summary = BaselineSummary(
            baseline_candidate_id=baseline_config.candidate_id,
            verdict=baseline_verdict,
            metrics=run_results[0].metric_set.model_dump() if run_results and run_results[0].metric_set else {},
        )
        search_summary = SearchSummary(
            tested_candidates=tested_ids,
            rankings=[e.candidate_id for e in ranked],
            rejected_options=[e.candidate_id for e in evaluated_candidates if e.verdict != FeasibilityVerdict.FEASIBLE],
        )
        env_fp = adapter.get_environment_fingerprint() if hasattr(adapter, "get_environment_fingerprint") else {}
        limitations = {
            "search_space": spec.search_space,
            "sample_count": spec.workload.measurement_duration_s * spec.workload.target_offered_rate,
        }
        cost_basis = "Deterministic local or simulated inference timings. No external commercial pricing asserted."
        artifact_paths = {
            "search_result": str(campaign_dir / "search_result.json"),
            "report_markdown": str(campaign_dir / "report.md"),
        }
        if verif_record:
            artifact_paths["verification_record"] = str(campaign_dir / "verification_record.json")

        report = build_report_artifact(
            experiment_spec=spec,
            baseline_summary=baseline_summary,
            search_summary=search_summary,
            environment_fingerprint=env_fp,
            limitations_disclosed=limitations,
            cost_accounting_basis=cost_basis,
            artifact_paths=artifact_paths,
            selected_candidate=winner_config,
            verification_record=verif_record,
        )
        write_report_artifacts(report, campaign_dir)

        is_verified_final = (
            verif_record is not None
            and verif_record.verification_verdict == VerificationState.VERIFIED
        )

        campaign_result = {
            "campaign_id": campaign_id,
            "status": "COMPLETED",
            "winner_id": winner.candidate_id if winner else None,
            "is_verified": is_verified_final,
            "artifact_paths": artifact_paths,
        }

        with CAMPAIGNS_LOCK:
            ACTIVE_CAMPAIGNS[campaign_id] = campaign_result

        # Emit campaign_completed
        sse_queue.emit("campaign_completed", {
            "campaign_id": campaign_id,
            "winner_id": winner.candidate_id if winner else None,
            "is_verified": is_verified_final,
            "artifact_paths": artifact_paths,
        })
        sse_queue.close()

    except Exception as exc:
        err_msg = str(exc)
        campaign_result = {
            "campaign_id": campaign_id,
            "status": "FAILED",
            "error": err_msg,
        }
        with CAMPAIGNS_LOCK:
            ACTIVE_CAMPAIGNS[campaign_id] = campaign_result

        sse_queue.emit("campaign_failed", {
            "campaign_id": campaign_id,
            "error": err_msg,
        })
        sse_queue.close()


def dispatch_campaign_run(
    payload: Dict[str, Any],
    artifacts_root: str = "artifacts",
) -> Tuple[int, Dict[str, Any]]:
    """
    Validates input parameters, registers campaign record, and launches execution in a background worker.
    Returns (status_code, response_dict).
    """
    adapter_name = payload.get("adapter", "vllm")
    if not isinstance(adapter_name, str):
        return 400, {"error": "Invalid adapter parameter: must be a string."}

    norm_adapter = adapter_name.strip().lower()
    if norm_adapter not in ("vllm", "local-vllm", "local", "ollama", "fake"):
        return 400, {
            "error": f"Invalid adapter '{adapter_name}'. Supported adapters are: 'vllm', 'ollama' (or 'local'), 'fake'."
        }

    # Model validation
    model_name = payload.get("model_name")
    if model_name is not None and not isinstance(model_name, str):
        return 400, {"error": "Invalid model_name parameter: must be a string."}

    # Resolve Workload
    raw_workload = payload.get("workload")
    if raw_workload and isinstance(raw_workload, dict):
        try:
            target_rate = float(raw_workload.get("target_offered_rate", 2.0))
            meas_dur = int(raw_workload.get("measurement_duration_s", 5))
            warmup_dur = int(raw_workload.get("warmup_duration_s", 1))
            conc_limit = int(raw_workload.get("concurrency_limit", 2))

            if target_rate <= 0:
                return 400, {"error": "Validation error: target_offered_rate must be positive."}
            if meas_dur <= 0:
                return 400, {"error": "Validation error: measurement_duration_s must be positive."}
            if warmup_dur < 0:
                return 400, {"error": "Validation error: warmup_duration_s cannot be negative."}
            if conc_limit <= 0:
                return 400, {"error": "Validation error: concurrency_limit must be positive."}

            workload = WorkloadSpec(
                schema_version="1.0.0",
                workload_name=raw_workload.get("workload_name", "campaign-benchmark"),
                fixture_id=raw_workload.get("fixture_id", "fix-campaign-01"),
                arrival_mode=ArrivalMode(raw_workload.get("arrival_mode", "constant")),
                target_offered_rate=target_rate,
                concurrency_limit=conc_limit,
                warmup_duration_s=warmup_dur,
                measurement_duration_s=meas_dur,
                max_input_tokens=int(raw_workload.get("max_input_tokens", 64)),
                max_output_tokens=int(raw_workload.get("max_output_tokens", 32)),
            )
        except Exception as exc:
            return 400, {"error": f"Invalid workload specification: {exc}"}
    else:
        target_rate = float(payload.get("target_offered_rate", 5.0))
        meas_dur = int(payload.get("measurement_duration_s", 2))
        warmup_dur = int(payload.get("warmup_duration_s", 0))
        conc_limit = int(payload.get("concurrency_limit", 1 if norm_adapter in ("ollama", "local") else 2))

        if target_rate <= 0:
            return 400, {"error": "Validation error: target_offered_rate must be positive."}
        if meas_dur <= 0:
            return 400, {"error": "Validation error: measurement_duration_s must be positive."}

        workload = WorkloadSpec(
            schema_version="1.0.0",
            workload_name=payload.get("workload_name", "campaign-benchmark"),
            fixture_id="fix-campaign-01",
            arrival_mode=ArrivalMode(payload.get("arrival_mode", "constant")),
            target_offered_rate=target_rate,
            concurrency_limit=conc_limit,
            warmup_duration_s=warmup_dur,
            measurement_duration_s=meas_dur,
            max_input_tokens=int(payload.get("max_input_tokens", 64)),
            max_output_tokens=int(payload.get("max_output_tokens", 32)),
        )

    # Resolve SLO
    raw_slo = payload.get("slo")
    if raw_slo and isinstance(raw_slo, dict) and "constraints" in raw_slo:
        try:
            slo_data = {
                "slo_id": raw_slo.get("slo_id", "slo-campaign-01"),
                "constraints": raw_slo.get("constraints", []),
                "min_sample_count": int(raw_slo.get("min_sample_count", 1)),
            }
            slo = SLOSpec.model_validate(slo_data)
        except Exception as exc:
            return 400, {"error": f"Invalid SLO specification: {exc}"}
    else:
        slo_dict = raw_slo if isinstance(raw_slo, dict) else payload
        ttft_val = slo_dict.get(
            "p95_ttft_threshold",
            slo_dict.get("p95_ttft_ms", payload.get("p95_ttft_threshold", payload.get("p95_ttft_ms", 2500.0)))
        )
        ttft_thresh = float(ttft_val)
        err_thresh = float(slo_dict.get("max_error_rate", payload.get("max_error_rate", 0.05)))

        if ttft_thresh <= 0:
            return 400, {"error": "Validation error: p95_ttft_threshold must be positive."}
        if err_thresh < 0 or err_thresh > 1:
            return 400, {"error": "Validation error: max_error_rate must be between 0.0 and 1.0."}

        slo = SLOSpec(
            slo_id=slo_dict.get("slo_id", payload.get("slo_id", "slo-campaign-01")),
            constraints=[
                SLOConstraint(
                    metric_name="ttft_ms",
                    statistic="p95",
                    threshold=ttft_thresh,
                    unit="ms",
                    operator="<=",
                ),
                SLOConstraint(
                    metric_name="error_rate",
                    statistic="mean",
                    threshold=err_thresh,
                    unit="fraction",
                    operator="<=",
                ),
            ],
            min_sample_count=int(slo_dict.get("min_sample_count", payload.get("min_sample_count", 3))),
        )

    # Search space resolution
    search_space = payload.get("search_space")
    if not search_space:
        if norm_adapter in ("vllm", "local-vllm"):
            search_space = {
                "concurrency": [1, 2],
                "max_tokens": [32, 128],
            }
        elif norm_adapter in ("local", "ollama"):
            search_space = {
                "num_batch": [256, 1024],
                "num_ctx": [1024, 2048],
            }
        else:
            search_space = {
                "max_num_batched_tokens": [1024, 2048],
                "max_num_seqs": [16, 64],
            }

    campaign_id = payload.get("campaign_id", f"cmp-{uuid.uuid4().hex[:8]}")

    spec = ExperimentSpec(
        experiment_id=campaign_id,
        workload=workload,
        slo=slo,
        search_space=search_space,
        budget=ExperimentBudget(
            max_candidates=5,
            max_wallclock_seconds=int(payload.get("max_wallclock_seconds", 300)),
            max_cost_limit=None,
        ),
        verification_policy=ExperimentVerificationPolicy(
            repetitions=1,
            duration_multiplier=1.0,
            min_absolute_latency_drift_ms=25.0,
        ),
    )

    sse_queue = SSEEventQueue()
    with CAMPAIGNS_LOCK:
        ACTIVE_CAMPAIGNS[campaign_id] = {
            "campaign_id": campaign_id,
            "status": "RUNNING",
            "adapter": norm_adapter,
            "model_name": model_name,
            "workload": workload.model_dump(),
            "slo": slo.model_dump(),
            "search_space": search_space,
        }
        ACTIVE_CAMPAIGN_QUEUES[campaign_id] = sse_queue

    thread = threading.Thread(
        target=_execute_campaign_worker,
        args=(
            campaign_id,
            spec,
            norm_adapter,
            artifacts_root,
            sse_queue,
            model_name,
        ),
        daemon=True,
    )
    thread.start()

    return 202, {
        "campaign_id": campaign_id,
        "stream_url": f"/api/campaigns/{campaign_id}/stream",
        "status": "ACCEPTED",
        "message": f"Optimization campaign {campaign_id} started.",
    }


def get_campaign_status(campaign_id: str, artifacts_root: str = "artifacts") -> Dict[str, Any]:
    with CAMPAIGNS_LOCK:
        if campaign_id in ACTIVE_CAMPAIGNS:
            return ACTIVE_CAMPAIGNS[campaign_id]

    if not re.match(r"^[a-zA-Z0-9_\-]+$", campaign_id):
        return {"campaign_id": campaign_id, "error": f"Invalid campaign_id format: {campaign_id}"}

    camp_dir = Path(artifacts_root) / "experiments" / campaign_id
    if (camp_dir / "search_result.json").exists():
        try:
            search_res = json.loads((camp_dir / "search_result.json").read_text(encoding="utf-8"))
            has_verif = (camp_dir / "verification_record.json").exists()
            return {
                "campaign_id": campaign_id,
                "status": "COMPLETED",
                "search_result": search_res,
                "is_verified": has_verif,
                "artifact_paths": {
                    "search_result": str(camp_dir / "search_result.json"),
                    "verification_record": str(camp_dir / "verification_record.json") if has_verif else None,
                    "report_markdown": str(camp_dir / "report.md") if (camp_dir / "report.md").exists() else None,
                },
            }
        except Exception as exc:
            return {"campaign_id": campaign_id, "error": f"Failed reading campaign artifacts: {exc}"}

    return {"campaign_id": campaign_id, "error": "Campaign not found"}


def list_campaigns(artifacts_root: str = "artifacts", limit: int = 10) -> List[Dict[str, Any]]:
    campaigns = []
    seen_ids = set()
    with CAMPAIGNS_LOCK:
        for c in ACTIVE_CAMPAIGNS.values():
            campaigns.append(c)
            seen_ids.add(c.get("campaign_id"))

    exps_dir = Path(artifacts_root) / "experiments"
    if exps_dir.exists():
        candidates = [d for d in exps_dir.iterdir() if d.is_dir() and d.name.startswith("cmp-") and d.name not in seen_ids]
        candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        for d in candidates:
            st = get_campaign_status(d.name, artifacts_root=artifacts_root)
            if st.get("error") != "Campaign not found":
                campaigns.append(st)
            if len(campaigns) >= limit:
                break

    return campaigns[:limit]
