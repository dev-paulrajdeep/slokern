"""
Purpose: Runs the documented demo path: 2x2 grid search + verification + reporting.
Owner: Rajdeep
Authority: Aligned with AGENTS.md Sections 1, 3, 5, 7, 8 and ROADMAP.md TASK-10, TASK-11, TASK-12.
Strictly labeled DEMO DATA for simulated offline execution with zero GPU allocation.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from typing import Any, Dict, List
import uuid

from slokern.contracts.config import CandidateConfig
from slokern.contracts.enums import (
    ArrivalMode,
    ExecutionStatus,
    FeasibilityVerdict,
    RankingObjective,
    VerificationState,
)
from slokern.contracts.evidence import RawRequestMeasurement
from slokern.contracts.metrics import MetricSet
from slokern.contracts.report import BaselineSummary, ReportArtifact, SearchSummary
from slokern.contracts.run import RunRecord
from slokern.contracts.search import SearchResult
from slokern.contracts.spec import (
    ExperimentBudget,
    ExperimentSpec,
    ExperimentVerificationPolicy,
    SLOConstraint,
    SLOSpec,
    WorkloadSpec,
)
from slokern.contracts.verdict import FeasibilityResult
from slokern.contracts.verification import DriftAnalysis, VerificationRecord
from slokern.core.search.budget import BudgetLimiter
from slokern.core.search.candidate_id import generate_candidate_id
from slokern.core.search.grid import GridSearchController
from slokern.engine.runner.run_executor import SingleRunExecutor
from slokern.engine.serving.fake import FakeServingAdapter


def run_slokern_e2e(
    experiment_id: str = "exp-e2e-demo",
    output_root: str = "artifacts",
) -> Path:
    """
    Executes the complete SLOKern experiment flow end-to-end:
    Phase 1: Bounded 2x2 grid search (Runs 0-4 under BudgetLimiter)
    Phase 2: Independent single-run verification execution (Run 5)
    Phase 3: Publish evidence-backed report (report.json & report.md)
    """
    exp_dir = Path(output_root) / "experiments" / experiment_id
    exp_dir.mkdir(parents=True, exist_ok=True)

    print("\n=======================================================")
    print(" SLOKern End-to-End Pipeline Execution (DEMO DATA)")
    print(f" Experiment ID: {experiment_id}")
    print(f" Output Root:   {exp_dir.resolve()}")
    print("=======================================================\n")

    # 1. Define Workload & SLO Specifications
    workload = WorkloadSpec(
        schema_version="1.0.0",
        workload_name="e2e-demo-workload",
        fixture_id="fix-e2e-01",
        arrival_mode=ArrivalMode.CONSTANT,
        target_offered_rate=10.0,
        concurrency_limit=4,
        warmup_duration_s=1,
        measurement_duration_s=2,
        max_input_tokens=128,
        max_output_tokens=32,
    )

    slo = SLOSpec(
        slo_id="slo-e2e-01",
        constraints=[
            SLOConstraint(
                metric_name="ttft_ms",
                statistic="p95",
                threshold=500.0,
                unit="ms",
                operator="<=",
            ),
            SLOConstraint(
                metric_name="error_rate",
                statistic="mean",
                threshold=0.01,
                unit="fraction",
                operator="<=",
            ),
        ],
        min_sample_count=5,
    )

    budget = BudgetLimiter(
        max_total_runs=6,
        max_search_runs=5,
        max_verification_runs=1,
    )

    exp_spec = ExperimentSpec(
        experiment_id=experiment_id,
        workload=workload,
        slo=slo,
        search_space={
            "max_num_batched_tokens": [1024, 2048],
            "max_num_seqs": [16, 64],
        },
        budget=ExperimentBudget(
            max_candidates=4,
            max_wallclock_seconds=300,
        ),
        verification_policy=ExperimentVerificationPolicy(
            repetitions=1,
            duration_multiplier=1.0,
        ),
    )
    (exp_dir / "experiment_spec.json").write_text(
        exp_spec.model_dump_json(indent=2), encoding="utf-8"
    )

    # 2. Serving Adapter & Executor Setup (DEMO DATA)
    adapter = FakeServingAdapter(
        model_name="meta-llama/Meta-Llama-3-8B-Instruct",
        runtime_name="vllm-fake",
        simulate_delay=False,
    )

    executor = SingleRunExecutor(
        adapter=adapter,
        artifacts_root=output_root,
        isolate_process=False,  # In-process execution avoids Windows sandbox socket stalls
    )

    # 3. Define Baseline Candidate (Run 0)
    baseline_settings = {"max_num_batched_tokens": 1024, "max_num_seqs": 16}
    baseline_id = generate_candidate_id(
        model_name=adapter.model_name,
        runtime_name=adapter.runtime_name,
        requested_settings=baseline_settings,
    )
    baseline_config = CandidateConfig(
        candidate_id=baseline_id,
        model_name=adapter.model_name,
        runtime_name=adapter.runtime_name,
        requested_settings=baseline_settings,
        effective_settings={},
        parameter_status={},
        environment_fingerprint={},
    )

    # 4. Phase 1: Execute 2x2 Grid Search (5 runs: 1 baseline + 4 candidates)
    print(">>> Phase 1: Launching 2x2 Grid Search (Runs 0-4)...")
    controller = GridSearchController(
        single_run_executor=executor,
        artifacts_root=output_root,
        default_objective=RankingObjective.MAX_THROUGHPUT_UNDER_SLO,
    )

    search_result = controller.execute(
        baseline_config=baseline_config,
        workload=workload,
        slo=slo,
        experiment_id=experiment_id,
        ranking_objective=RankingObjective.MAX_THROUGHPUT_UNDER_SLO,
        serving_adapter=adapter,
        budget_limiter=budget,
    )

    print(f"    [OK] Search completed. Stopping reason: {search_result.stopping_reason}")
    print(f"    [OK] Tested candidates count: {len(search_result.tested_candidates)}")
    print(f"    [OK] Winning candidate ID:    {search_result.selected_candidate_id}")
    print(f"    [OK] Budget search executed:  {budget.search_runs_executed}/5")
    print(f"    [OK] Budget total executed:   {budget.runs_executed}/6")

    winner_id = search_result.selected_candidate_id
    assert winner_id is not None, "At least one candidate must be feasible in demo"

    # Find winning configuration and search metrics
    winner_run_id = None
    winner_cfg = None
    winner_metrics = None
    for run_dir in (exp_dir / "runs").iterdir():
        if not run_dir.is_dir():
            continue
        rec_path = run_dir / "run_record.json"
        if rec_path.exists():
            rec = RunRecord.model_validate_json(rec_path.read_text(encoding="utf-8"))
            if rec.candidate_id == winner_id and not rec.is_verification_run:
                winner_run_id = rec.run_id
                winner_cfg = CandidateConfig.model_validate_json(
                    (run_dir / "applied_config.json").read_text(encoding="utf-8")
                )
                winner_metrics = MetricSet.model_validate_json(
                    (run_dir / "metrics.json").read_text(encoding="utf-8")
                )
                break

    assert winner_run_id is not None, f"Could not locate run record for winner {winner_id}"
    assert winner_cfg is not None, f"Could not locate applied config for winner {winner_id}"
    assert winner_metrics is not None, f"Could not locate metrics for winner {winner_id}"

    # 5. Phase 2: Independent Verification Run (Run 5, Budget 6th run)
    print("\n>>> Phase 2: Launching Independent Verification Rerun (Run 5)...")
    assert budget.can_execute_verification_run(), "Verification run budget must be available"
    budget.record_verification_run()

    verification_run_id = f"run-05-verify-{winner_id[:6]}"
    assert verification_run_id != winner_run_id, "Verification run ID must be fresh"

    verif_res = executor.execute(
        candidate_config=winner_cfg,
        workload=workload,
        slo=slo,
        experiment_id=experiment_id,
        run_id=verification_run_id,
        is_verification_run=True,
    )

    assert verif_res.is_completed, "Verification run must complete successfully"
    verif_metrics = verif_res.metric_set
    assert verif_metrics is not None, "Verification run metrics must be calculated"

    # Compute Drift Analysis
    ttft_delta = (
        ((verif_metrics.ttft_ms.p95 - winner_metrics.ttft_ms.p95) / winner_metrics.ttft_ms.p95) * 100.0
        if (winner_metrics.ttft_ms and winner_metrics.ttft_ms.p95 > 0 and verif_metrics.ttft_ms)
        else 0.0
    )
    tps_delta = (
        ((verif_metrics.token_throughput_tps - winner_metrics.token_throughput_tps) / winner_metrics.token_throughput_tps) * 100.0
        if winner_metrics.token_throughput_tps > 0
        else 0.0
    )

    drift = DriftAnalysis(
        metric_deltas={
            "ttft_p95_pct": round(ttft_delta, 2),
            "token_throughput_pct": round(tps_delta, 2),
        },
        slo_drift_detected=(
            verif_res.feasibility_result is None
            or verif_res.feasibility_result.overall_verdict != FeasibilityVerdict.FEASIBLE
        ),
    )

    verif_verdict = (
        VerificationState.VERIFIED
        if (verif_res.feasibility_result and verif_res.feasibility_result.overall_verdict == FeasibilityVerdict.FEASIBLE)
        else VerificationState.VERIFICATION_FAILED
    )

    verif_record = VerificationRecord(
        verification_id=f"verif-{uuid.uuid4().hex[:12]}",
        experiment_id=experiment_id,
        candidate_id=winner_id,
        original_run_id=winner_run_id,
        verification_run_id=verification_run_id,
        verification_verdict=verif_verdict,
        drift_analysis=drift,
        final_decision_notes=(
            f"[DEMO DATA] Winner verified under fresh run ID {verification_run_id}. "
            f"Verdict: {verif_verdict.value}. TTFT drift: {ttft_delta:+.2f}%."
        ),
    )
    (exp_dir / "verification_record.json").write_text(
        verif_record.model_dump_json(indent=2), encoding="utf-8"
    )

    print(f"    [OK] Verification completed. Verdict: {verif_record.verification_verdict.value}")
    print(f"    [OK] Total runs executed: {budget.runs_executed}/{budget.max_total_runs}")
    print(f"    [OK] Budget exhausted:    {budget.is_exhausted()}")

    # 6. Phase 3: Publish Evidence-Backed Report (JSON & Markdown)
    print("\n>>> Phase 3: Publishing Evidence-Backed Report...")
    baseline_run_dir = exp_dir / "runs" / f"run-00-baseline-{baseline_id[:6]}"
    baseline_feas = FeasibilityResult.model_validate_json(
        (baseline_run_dir / "feasibility.json").read_text(encoding="utf-8")
    )
    baseline_metrics = MetricSet.model_validate_json(
        (baseline_run_dir / "metrics.json").read_text(encoding="utf-8")
    )

    baseline_summary = BaselineSummary(
        baseline_candidate_id=baseline_id,
        verdict=baseline_feas.overall_verdict,
        metrics={
            "ttft_p95_ms": baseline_metrics.ttft_ms.p95 if baseline_metrics.ttft_ms else None,
            "token_throughput_tps": baseline_metrics.token_throughput_tps,
            "error_rate": baseline_metrics.error_rate,
        },
    )

    search_summary = SearchSummary(
        tested_candidates=search_result.tested_candidates,
        rejected_options=[
            cid for cid, s in search_result.candidate_summaries.items()
            if s.verdict != FeasibilityVerdict.FEASIBLE
        ],
        rankings=[winner_id],
    )

    report_artifact = ReportArtifact(
        report_id=f"rep-{uuid.uuid4().hex[:12]}",
        created_at=datetime.now(timezone.utc).isoformat(),
        experiment_spec=exp_spec,
        environment_fingerprint=adapter.get_environment_fingerprint(),
        baseline_summary=baseline_summary,
        search_summary=search_summary,
        selected_candidate=winner_cfg,
        verification_record=verif_record,
        limitations_disclosed={
            "data_mode": "DEMO DATA",
            "adapter": "FakeServingAdapter",
            "gpu_allocated": False,
            "search_space_bounds": exp_spec.search_space,
            "clock_source": "time.time() float seconds (synthetic simulation)",
        },
        cost_accounting_basis="DEMO DATA: Synthetic simulation with zero GPU hardware expenditure.",
        artifact_paths={
            "search_result": str((exp_dir / "search_result.json").relative_to(output_root)).replace("\\", "/"),
            "verification_record": str((exp_dir / "verification_record.json").relative_to(output_root)).replace("\\", "/"),
            "baseline_raw_trace": str((baseline_run_dir / "raw_measurements.jsonl").relative_to(output_root)).replace("\\", "/"),
            "verification_raw_trace": str((exp_dir / "runs" / verification_run_id / "raw_measurements.jsonl").relative_to(output_root)).replace("\\", "/"),
        },
    )

    (exp_dir / "report.json").write_text(
        report_artifact.model_dump_json(indent=2), encoding="utf-8"
    )

    # Render Markdown report
    base_ttft = baseline_summary.metrics.get("ttft_p95_ms")
    base_ttft_str = f"{base_ttft:.2f}" if base_ttft is not None else "N/A"
    winner_ttft = winner_metrics.ttft_ms.p95 if winner_metrics.ttft_ms else 0.0
    verif_ttft = verif_metrics.ttft_ms.p95 if verif_metrics.ttft_ms else 0.0

    markdown_report = f"""# SLOKern Optimization & Verification Report (DEMO DATA)

> **WARNING — DEMO DATA:** All measurements, configurations, and verdicts below were generated using `FakeServingAdapter` for local testing and presentation. Zero GPU resources were utilized.

## 1. Executive Summary

| Attribute | Value |
|---|---|
| **Report ID** | `{report_artifact.report_id}` |
| **Experiment ID** | `{exp_spec.experiment_id}` |
| **Model** | `{adapter.model_name}` |
| **Serving Runtime** | `{adapter.runtime_name}` |
| **Verification Verdict** | **{verif_record.verification_verdict.value}** |
| **Winning Candidate** | `{winner_id}` |
| **Stopping Reason** | `{search_result.stopping_reason}` |

## 2. Serving Environment & Fingerprint
- **Hardware Model:** {report_artifact.environment_fingerprint.get('hardware_model')}
- **Driver Version:** {report_artifact.environment_fingerprint.get('driver_version')}
- **CUDA Version:** {report_artifact.environment_fingerprint.get('cuda_version')}
- **Notice:** {report_artifact.environment_fingerprint.get('disclaimer')}

## 3. Baseline vs. Verified Configuration

| Metric | Baseline ({baseline_id[:8]}) | Winner (Search) | Winner (Verified) | Drift (ΔM) |
|---|---|---|---|---|
| **Batched Tokens** | {baseline_settings['max_num_batched_tokens']} | {winner_cfg.requested_settings.get('max_num_batched_tokens')} | {winner_cfg.requested_settings.get('max_num_batched_tokens')} | 0.0% |
| **Max Concurrency**| {baseline_settings['max_num_seqs']} | {winner_cfg.requested_settings.get('max_num_seqs')} | {winner_cfg.requested_settings.get('max_num_seqs')} | 0.0% |
| **TTFT p95 (ms)** | {base_ttft_str} | {winner_ttft:.2f} | {verif_ttft:.2f} | {ttft_delta:+.2f}% |
| **Throughput (tps)**| {baseline_summary.metrics['token_throughput_tps']:.2f} | {winner_metrics.token_throughput_tps:.2f} | {verif_metrics.token_throughput_tps:.2f} | {tps_delta:+.2f}% |
| **Feasibility** | {baseline_summary.verdict.value} | FEASIBLE | {verif_res.feasibility_result.overall_verdict.value if verif_res.feasibility_result else 'UNKNOWN'} | — |

## 4. Verification Evidence & Drift Analysis
- **Original Run ID:** `{verif_record.original_run_id}`
- **Fresh Verification Run ID:** `{verif_record.verification_run_id}`
- **SLO Drift Detected:** `{verif_record.drift_analysis.slo_drift_detected if verif_record.drift_analysis else False}`
- **Notes:** {verif_record.final_decision_notes}

## 5. Traceability & Artifact Index
- **Search Result Contract:** `{report_artifact.artifact_paths['search_result']}`
- **Verification Record Contract:** `{report_artifact.artifact_paths['verification_record']}`
- **Baseline Raw Trace:** `{report_artifact.artifact_paths['baseline_raw_trace']}`
- **Verification Raw Trace:** `{report_artifact.artifact_paths['verification_raw_trace']}`
"""
    (exp_dir / "report.md").write_text(markdown_report, encoding="utf-8")
    print(f"    [OK] Emitted {exp_dir / 'report.json'}")
    print(f"    [OK] Emitted {exp_dir / 'report.md'}")

    return exp_dir


def validate_all_artifacts(experiment_dir: Path) -> None:
    """
    Validates all emitted artifacts against the 11 canonical Pydantic v2 contract schemas
    with extra='forbid' enforcement.
    """
    exp_dir = Path(experiment_dir)
    print(f"\n>>> Validating All Contract Schemas in {exp_dir}...")

    # 1. ExperimentSpec (embeds WorkloadSpec & SLOSpec)
    spec_path = exp_dir / "experiment_spec.json"
    assert spec_path.exists(), f"Missing {spec_path}"
    exp_spec = ExperimentSpec.model_validate_json(spec_path.read_text(encoding="utf-8"))
    WorkloadSpec.model_validate(exp_spec.workload.model_dump())
    SLOSpec.model_validate(exp_spec.slo.model_dump())
    print("    [OK] Contract 1/11: ExperimentSpec (and embedded WorkloadSpec, SLOSpec)")

    # 2. SearchResult
    search_path = exp_dir / "search_result.json"
    assert search_path.exists(), f"Missing {search_path}"
    search_res = SearchResult.model_validate_json(search_path.read_text(encoding="utf-8"))
    print(f"    [OK] Contract 2/11: SearchResult ({len(search_res.tested_candidates)} candidates tested)")

    # 3. VerificationRecord
    verif_path = exp_dir / "verification_record.json"
    assert verif_path.exists(), f"Missing {verif_path}"
    verif_rec = VerificationRecord.model_validate_json(verif_path.read_text(encoding="utf-8"))
    assert verif_rec.verification_run_id != verif_rec.original_run_id, "Verification run ID must be distinct!"
    print(f"    [OK] Contract 3/11: VerificationRecord (verdict={verif_rec.verification_verdict.value})")

    # 4. ReportArtifact
    report_path = exp_dir / "report.json"
    assert report_path.exists(), f"Missing {report_path}"
    report_art = ReportArtifact.model_validate_json(report_path.read_text(encoding="utf-8"))
    print(f"    [OK] Contract 4/11: ReportArtifact (report_id={report_art.report_id})")

    # 5-11: Per-run artifacts (CandidateConfig, RunRecord, MetricSet, FeasibilityResult, RawRequestMeasurement)
    runs_dir = exp_dir / "runs"
    assert runs_dir.exists(), f"Missing {runs_dir}"
    run_folders = [d for d in runs_dir.iterdir() if d.is_dir()]
    assert len(run_folders) == 6, f"Expected 6 runs (5 search + 1 verification), found {len(run_folders)}"

    total_measurements = 0
    for run_dir in run_folders:
        run_name = run_dir.name
        # RunRecord
        run_rec_path = run_dir / "run_record.json"
        assert run_rec_path.exists(), f"Missing {run_rec_path}"
        run_rec = RunRecord.model_validate_json(run_rec_path.read_text(encoding="utf-8"))

        # CandidateConfig
        cfg_path = run_dir / "applied_config.json"
        assert cfg_path.exists(), f"Missing {cfg_path}"
        CandidateConfig.model_validate_json(cfg_path.read_text(encoding="utf-8"))

        # MetricSet
        metrics_path = run_dir / "metrics.json"
        assert metrics_path.exists(), f"Missing {metrics_path}"
        MetricSet.model_validate_json(metrics_path.read_text(encoding="utf-8"))

        # FeasibilityResult
        feas_path = run_dir / "feasibility.json"
        assert feas_path.exists(), f"Missing {feas_path}"
        FeasibilityResult.model_validate_json(feas_path.read_text(encoding="utf-8"))

        # RawRequestMeasurement
        trace_path = run_dir / "raw_measurements.jsonl"
        assert trace_path.exists(), f"Missing {trace_path}"
        with open(trace_path, "r", encoding="utf-8") as f:
            for line_no, line in enumerate(f, start=1):
                stripped = line.strip()
                if not stripped:
                    continue
                measurement = RawRequestMeasurement.model_validate_json(stripped)
                # Verify strict monotonicity
                if measurement.first_token_at is not None:
                    assert (
                        measurement.scheduled_at
                        <= measurement.sent_at
                        <= measurement.first_token_at
                        <= measurement.completed_at
                    ), f"Monotonicity breach in {run_name} line {line_no}"
                else:
                    assert (
                        measurement.scheduled_at
                        <= measurement.sent_at
                        <= measurement.completed_at
                    ), f"Monotonicity breach in {run_name} line {line_no}"
                total_measurements += 1

    print(f"    [OK] Contracts 5-11/11: All 6 runs verified.")
    print(f"         Validated {total_measurements} RawRequestMeasurement records across 6 runs.")
    print("=======================================================")
    print(" ALL 11 CONTRACT SCHEMAS VALIDATED 100% CLEANLY (extra='forbid')!")
    print("=======================================================\n")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="SLOKern End-to-End Pipeline Demo (DEMO DATA)"
    )
    parser.add_argument(
        "--experiment-id",
        type=str,
        default="exp-e2e-demo",
        help="Experiment identifier (default: exp-e2e-demo)",
    )
    parser.add_argument(
        "--output-root",
        type=str,
        default="artifacts",
        help="Root artifacts directory (default: artifacts)",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Only validate existing artifacts without re-running pipeline",
    )
    args = parser.parse_args()

    exp_dir = Path(args.output_root) / "experiments" / args.experiment_id

    if not args.validate_only:
        exp_dir = run_slokern_e2e(
            experiment_id=args.experiment_id,
            output_root=args.output_root,
        )

    validate_all_artifacts(exp_dir)


if __name__ == "__main__":
    main()
