"""
Regression and integrity tests for experiment history, metadata recovery, and state independence.
Authority: AGENTS.md § 1, 3, 4, 5, 7, 8, 13 and DEC-0014
"""

import json
from pathlib import Path

from slokern.api.routes.experiments import (
    _classify_evidence,
    _find_campaign_spec,
    get_experiment_candidates,
    get_experiment_detail,
    get_experiment_verification,
    list_experiments,
)


def _write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def _create_sample_run(
    run_dir: Path,
    run_id: str,
    exp_id: str,
    candidate_id: str,
    verdict: str = "FEASIBLE",
    validity: str = "VALID",
    execution_status: str = "COMPLETED",
    is_verification: bool = False,
    provider: str = "ollama",
    is_simulated: bool = False,
    mode: str = None,
    ttft_p95: float = 45.0,
    throughput: float = 50.0,
    error_rate: float = 0.0,
) -> None:
    _write_json(
        run_dir / "run_record.json",
        {
            "run_id": run_id,
            "experiment_id": exp_id,
            "candidate_id": candidate_id,
            "is_verification_run": is_verification,
            "execution_status": execution_status,
            "started_at": "2026-11-08T10:00:00Z",
            "completed_at": "2026-11-08T10:00:15Z",
        },
    )
    _write_json(
        run_dir / "metrics.json",
        {
            "metric_version": "1.0.0",
            "run_id": run_id,
            "sample_count": 30,
            "failed_request_count": 0,
            "offered_load_rps": 2.0,
            "achieved_load_rps": 2.0,
            "generator_saturated": validity == "CONTAMINATED",
            "ttft_ms": {"p50": ttft_p95 * 0.6, "p95": ttft_p95, "p99": ttft_p95 * 1.2},
            "itl_ms": {"p50": 10.0, "p95": 12.0},
            "e2e_latency_ms": {"p50": 100.0, "p95": 150.0},
            "token_throughput_tps": throughput,
            "request_throughput_rps": 2.0,
            "error_rate": error_rate,
        },
    )
    _write_json(
        run_dir / "feasibility.json",
        {
            "policy_version": "1.0.0",
            "run_id": run_id,
            "overall_verdict": verdict,
            "validity_status": validity,
            "audit_notes": "Hard constraints satisfied" if verdict == "FEASIBLE" else "Contaminated/Failed",
            "constraint_evaluations": [
                {
                    "metric_name": "ttft_ms",
                    "statistic": "p95",
                    "observed_value": ttft_p95,
                    "required_threshold": 2500.0,
                    "operator": "<=",
                    "passed": True if verdict == "FEASIBLE" else None,
                    "reason_code": "HARD_CONSTRAINTS_PASSED" if verdict == "FEASIBLE" else "GENERATOR_SATURATED",
                },
                {
                    "metric_name": "error_rate",
                    "statistic": "mean",
                    "observed_value": error_rate,
                    "required_threshold": 0.05,
                    "operator": "<=",
                    "passed": True if verdict == "FEASIBLE" else None,
                    "reason_code": "HARD_CONSTRAINTS_PASSED" if verdict == "FEASIBLE" else "GENERATOR_SATURATED",
                },
            ],
        },
    )
    fp = {
        "provider": provider,
        "is_simulated": is_simulated,
    }
    if mode:
        fp["mode"] = mode
    _write_json(
        run_dir / "applied_config.json",
        {
            "candidate_id": candidate_id,
            "model_name": "test-model-7b",
            "runtime_name": "ollama" if provider == "ollama" else "vllm-fake",
            "requested_settings": {"num_ctx": 4, "num_batch": 512},
            "effective_settings": {"num_ctx": 4, "num_batch": 512},
            "parameter_status": {},
            "environment_fingerprint": fp,
        },
    )
    (run_dir / "raw_measurements.jsonl").write_text("{}\n", encoding="utf-8")


def test_multi_tier_spec_recovery_from_experiment_spec(tmp_path: Path) -> None:
    exp_dir = tmp_path / "artifacts" / "experiments" / "exp-spec-tier1"
    _write_json(
        exp_dir / "experiment_spec.json",
        {
            "experiment_id": "exp-spec-tier1",
            "workload": {
                "workload_name": "tier1-workload",
                "arrival_mode": "constant",
                "target_offered_rate": 4.5,
                "measurement_duration_s": 20,
            },
            "slo": {
                "constraints": [
                    {"metric_name": "ttft_ms", "statistic": "p95", "threshold": 200.0, "operator": "<="}
                ]
            },
            "search_space": {"max_num_seqs": [8, 16], "max_num_batched_tokens": [256, 512]},
            "budget": {"max_candidates": 4},
            "verification_policy": {"duration_multiplier": 2.0},
        },
    )
    _create_sample_run(
        exp_dir / "runs" / "run-01",
        run_id="run-01",
        exp_id="exp-spec-tier1",
        candidate_id="cand-01",
    )

    spec = _find_campaign_spec("exp-spec-tier1", artifacts_root=str(tmp_path / "artifacts"), exp_dir=exp_dir)
    assert spec is not None
    assert spec["workload"]["workload_name"] == "tier1-workload"
    assert spec["workload"]["target_offered_rate"] == 4.5

    summaries = list_experiments(artifacts_root=str(tmp_path / "artifacts"))
    match = next(s for s in summaries if s["id"] == "exp-spec-tier1")
    assert match["workload"] == "tier1-workload"
    assert match["arrivalMode"] == "constant"
    assert match["targetOfferedRateRps"] == 4.5
    assert match["candidateBudget"] == 4
    assert match["searchSpaceCandidateCount"] == 4
    assert len(match["sloConstraints"]) == 1


def test_multi_tier_spec_recovery_from_report_json(tmp_path: Path) -> None:
    exp_dir = tmp_path / "artifacts" / "experiments" / "exp-spec-tier2"
    _write_json(
        exp_dir / "report.json",
        {
            "report_id": "rep-tier2",
            "experiment_spec": {
                "experiment_id": "exp-spec-tier2",
                "workload": {
                    "workload_name": "embedded-report-workload",
                    "arrival_mode": "poisson",
                    "target_offered_rate": 8.0,
                },
                "slo": {"constraints": []},
            },
            "environment_fingerprint": {"provider": "ollama", "is_simulated": False},
        },
    )
    _create_sample_run(
        exp_dir / "runs" / "run-01",
        run_id="run-01",
        exp_id="exp-spec-tier2",
        candidate_id="cand-01",
    )

    spec = _find_campaign_spec("exp-spec-tier2", artifacts_root=str(tmp_path / "artifacts"), exp_dir=exp_dir)
    assert spec is not None
    assert spec["workload"]["workload_name"] == "embedded-report-workload"

    summaries = list_experiments(artifacts_root=str(tmp_path / "artifacts"))
    match = next(s for s in summaries if s["id"] == "exp-spec-tier2")
    assert match["workload"] == "embedded-report-workload"
    assert match["arrivalMode"] == "poisson"


def test_qwen3_authoritative_verified_run_recovers_feasible_verdict(tmp_path: Path) -> None:
    """
    Direct regression reproduction for the local Qwen3 campaign defect:
    A winning candidate had multiple runs, where an earlier run was VALID/FEASIBLE and verified,
    but a later contaminated run (GENERATOR_SATURATED) was overwriting it alphabetically.
    """
    exp_id = "exp-local-qwen3-tuning"
    exp_dir = tmp_path / "artifacts" / "experiments" / exp_id
    cand_win = "cand-winner-qwen"

    # Search result designating cand-winner-qwen
    _write_json(
        exp_dir / "search_result.json",
        {
            "experiment_id": exp_id,
            "selected_candidate_id": cand_win,
            "tested_candidates": [cand_win],
            "candidate_summaries": {cand_win: {"verdict": "FEASIBLE", "ranking_metric": 50.6}},
            "ranking_objective": "max_throughput_under_slo",
            "selection_rationale": "Selected candidate highest throughput among FEASIBLE",
        },
    )

    # Verification record pointing to run-01-auth as the authoritative run
    _write_json(
        exp_dir / "verification_record.json",
        {
            "verification_id": "verif-qwen-01",
            "experiment_id": exp_id,
            "candidate_id": cand_win,
            "original_run_id": "run-01-auth",
            "verification_run_id": "run-verify-99",
            "verification_verdict": "VERIFIED",
        },
    )

    # 1. Authoritative original run (FEASIBLE, VALID)
    _create_sample_run(
        exp_dir / "runs" / "run-01-auth",
        run_id="run-01-auth",
        exp_id=exp_id,
        candidate_id=cand_win,
        verdict="FEASIBLE",
        validity="VALID",
        throughput=50.6,
    )

    # 2. Alphabetically later contaminated run (INCONCLUSIVE, CONTAMINATED)
    _create_sample_run(
        exp_dir / "runs" / "run-zz-contaminated",
        run_id="run-zz-contaminated",
        exp_id=exp_id,
        candidate_id=cand_win,
        verdict="INCONCLUSIVE",
        validity="CONTAMINATED",
        throughput=30.0,
    )

    # 3. Independent verification run
    _create_sample_run(
        exp_dir / "runs" / "run-verify-99",
        run_id="run-verify-99",
        exp_id=exp_id,
        candidate_id=cand_win,
        verdict="FEASIBLE",
        validity="VALID",
        is_verification=True,
    )

    # Candidate evaluation must select the authoritative run, NOT the contaminated one
    candidates = get_experiment_candidates(exp_id, artifacts_root=str(tmp_path / "artifacts"))
    assert len(candidates) == 1
    winner_cand = candidates[0]
    assert winner_cand["id"] == cand_win
    assert winner_cand["tag"] == "WINNER"
    assert winner_cand["feasible"] is True
    assert winner_cand["feasibilityVerdict"] == "FEASIBLE"
    assert winner_cand["evidenceValidity"] == "VALID"
    assert winner_cand["run_id"] == "run-01-auth"

    # list_experiments must report Feasible and Verified concurrently without contradiction
    summaries = list_experiments(artifacts_root=str(tmp_path / "artifacts"))
    exp_summary = next(s for s in summaries if s["id"] == exp_id)
    assert exp_summary["run"] == "run-01-auth"
    assert exp_summary["feasibility"] == "Feasible"
    assert exp_summary["verification"] == "Verified"
    assert exp_summary["measurementValidity"] == "VALID"
    assert exp_summary["clientSaturation"] is False

    # get_experiment_verification fallback
    verif = get_experiment_verification(exp_id, artifacts_root=str(tmp_path / "artifacts"))
    assert verif["original_run_id"] == "run-01-auth"


def test_contaminated_evidence_cannot_produce_feasible_recommendation(tmp_path: Path) -> None:
    """
    Verify that when all evidence for an experiment is contaminated,
    it strictly reports INCONCLUSIVE and cannot produce a FEASIBLE verdict.
    """
    exp_id = "exp-all-contaminated"
    exp_dir = tmp_path / "artifacts" / "experiments" / exp_id
    cand_id = "cand-bad"

    _write_json(
        exp_dir / "search_result.json",
        {
            "experiment_id": exp_id,
            "selected_candidate_id": cand_id,
            "tested_candidates": [cand_id],
        },
    )

    _create_sample_run(
        exp_dir / "runs" / "run-01",
        run_id="run-01",
        exp_id=exp_id,
        candidate_id=cand_id,
        verdict="INCONCLUSIVE",
        validity="CONTAMINATED",
    )

    candidates = get_experiment_candidates(exp_id, artifacts_root=str(tmp_path / "artifacts"))
    assert len(candidates) == 1
    assert candidates[0]["feasibilityVerdict"] == "INCONCLUSIVE"
    assert candidates[0]["feasible"] is False
    assert candidates[0]["tag"] == "INCONCLUSIVE"

    summaries = list_experiments(artifacts_root=str(tmp_path / "artifacts"))
    exp_summary = next(s for s in summaries if s["id"] == exp_id)
    assert exp_summary["feasibility"] == "Inconclusive"
    assert exp_summary["measurementValidity"] == "CONTAMINATED"
    assert exp_summary["clientSaturation"] is True


def test_independent_states_execution_validity_feasibility_verification(tmp_path: Path) -> None:
    """
    Verify state independence:
    Execution Completion (Completed/Running/Failed), Measurement Validity (Valid/Contaminated),
    Feasibility (Feasible/Inconclusive/Infeasible), and Verification (Pending/Verified/Failed).
    """
    exp_id = "exp-independent-states"
    exp_dir = tmp_path / "artifacts" / "experiments" / exp_id
    cand_id = "cand-state-test"

    _write_json(
        exp_dir / "search_result.json",
        {
            "experiment_id": exp_id,
            "selected_candidate_id": cand_id,
            "tested_candidates": [cand_id],
        },
    )

    # Run is COMPLETED, but evidence is CONTAMINATED, feasibility is INCONCLUSIVE, verification is NOT RUN (Pending)
    _create_sample_run(
        exp_dir / "runs" / "run-completed-but-contaminated",
        run_id="run-completed-but-contaminated",
        exp_id=exp_id,
        candidate_id=cand_id,
        execution_status="COMPLETED",
        verdict="INCONCLUSIVE",
        validity="CONTAMINATED",
    )

    summaries = list_experiments(artifacts_root=str(tmp_path / "artifacts"))
    exp_summary = next(s for s in summaries if s["id"] == exp_id)

    # 1. Execution status is Completed (process ran to completion without crashing)
    assert exp_summary["state"] == "Completed"
    # 2. Validity is CONTAMINATED (client generator saturated)
    assert exp_summary["measurementValidity"] == "CONTAMINATED"
    # 3. Feasibility is Inconclusive (unreliable evidence cannot pass or fail hard SLO)
    assert exp_summary["feasibility"] == "Inconclusive"
    # 4. Verification is Pending (no verification rerun executed)
    assert exp_summary["verification"] == "Pending"


def test_evidence_classification_distinguishability(tmp_path: Path) -> None:
    """
    Verify LIVE, DEMO DATA, and UNVERIFIED records remain strictly distinguishable.
    """
    # 1. Direct helper tests
    assert _classify_evidence({"provider": "ollama"}, is_simulated=False) == "LIVE"
    assert _classify_evidence({"provider": "nebius"}, is_simulated=False) == "LIVE"
    assert _classify_evidence({"mode": "DEMO DATA", "is_simulated": True}) == "DEMO DATA"
    assert _classify_evidence({"provider": "fake"}, is_simulated=False) == "DEMO DATA"
    assert _classify_evidence({}, is_simulated=None) == "UNVERIFIED"

    # 2. Experiment artifact integration tests
    # Live experiment
    live_exp = tmp_path / "artifacts" / "experiments" / "exp-live"
    _create_sample_run(
        live_exp / "runs" / "run-01",
        run_id="run-01",
        exp_id="exp-live",
        candidate_id="cand-01",
        provider="ollama",
        is_simulated=False,
    )

    # Demo experiment
    demo_exp = tmp_path / "artifacts" / "experiments" / "exp-demo"
    _create_sample_run(
        demo_exp / "runs" / "run-02",
        run_id="run-02",
        exp_id="exp-demo",
        candidate_id="cand-02",
        provider="fake",
        mode="DEMO DATA",
        is_simulated=True,
    )

    detail_live = get_experiment_detail("exp-live", artifacts_root=str(tmp_path / "artifacts"))
    assert detail_live["evidence_classification"] == "LIVE"

    detail_demo = get_experiment_detail("exp-demo", artifacts_root=str(tmp_path / "artifacts"))
    assert detail_demo["evidence_classification"] == "DEMO DATA"


def test_verification_only_experiment_resolves_feasible_and_candidate(tmp_path: Path) -> None:
    """
    Direct regression reproduction for exp-28579777 / exp-a30d62b1:
    Experiment contains only a verification run and verification_record.json.
    Must discover the candidate and report Feasible + Verified without contradiction.
    """
    exp_id = "exp-verif-only"
    exp_dir = tmp_path / "artifacts" / "experiments" / exp_id
    cand_id = "cand-vllm-01"

    _write_json(
        exp_dir / "verification_record.json",
        {
            "verification_id": "verif-test-01",
            "experiment_id": exp_id,
            "candidate_id": cand_id,
            "original_run_id": "run-orig-01",
            "verification_run_id": "run-verify-abc",
            "verification_verdict": "VERIFIED",
        },
    )
    _create_sample_run(
        exp_dir / "runs" / "run-verify-abc",
        run_id="run-verify-abc",
        exp_id=exp_id,
        candidate_id=cand_id,
        verdict="FEASIBLE",
        validity="VALID",
        is_verification=True,
    )

    candidates = get_experiment_candidates(exp_id, artifacts_root=str(tmp_path / "artifacts"))
    assert len(candidates) == 1
    assert candidates[0]["id"] == cand_id
    assert candidates[0]["feasible"] is True

    summaries = list_experiments(artifacts_root=str(tmp_path / "artifacts"))
    exp_summary = next(s for s in summaries if s["id"] == exp_id)
    assert exp_summary["candidateId"] == cand_id
    assert exp_summary["feasibility"] == "Feasible"
    assert exp_summary["verification"] == "Verified"


def test_verify_search_campaign_prioritizes_valid_run_over_contaminated(tmp_path: Path) -> None:
    """
    Verify that verify_search_campaign ignores contaminated runs for the winning candidate
    and selects the valid, feasible search run as reference.
    """
    from slokern.contracts.enums import FeasibilityVerdict, RankingObjective
    from slokern.contracts.search import CandidateSummary, SearchResult
    from slokern.core.verification.protocol import verify_search_campaign

    exp_id = "exp-verify-campaign-quality"
    exp_dir = tmp_path / "artifacts" / "experiments" / exp_id
    cand_id = "cand-winner-01"

    search_result = SearchResult(
        experiment_id=exp_id,
        baseline_candidate_id=cand_id,
        tested_candidates=[cand_id],
        candidate_summaries={cand_id: CandidateSummary(verdict=FeasibilityVerdict.FEASIBLE, ranking_metric=100.0)},
        ranking_objective=RankingObjective.MAX_THROUGHPUT_UNDER_SLO,
        selected_candidate_id=cand_id,
        selection_rationale="Winner",
        stopping_reason="space_exhausted",
    )
    _write_json(exp_dir / "search_result.json", search_result.model_dump())
    from slokern.contracts.enums import ArrivalMode
    from slokern.contracts.spec import SLOConstraint, SLOSpec, WorkloadSpec
    workload = WorkloadSpec(
        schema_version="1.0.0",
        workload_name="test-workload",
        fixture_id="fix-test-01",
        arrival_mode=ArrivalMode.CONSTANT,
        target_offered_rate=2.0,
        concurrency_limit=2,
        warmup_duration_s=2,
        measurement_duration_s=5,
        max_input_tokens=64,
        max_output_tokens=32,
    )
    slo = SLOSpec(
        slo_id="slo-test-01",
        constraints=[
            SLOConstraint(metric_name="ttft_ms", statistic="p95", threshold=2500.0, unit="ms", operator="<=")
        ],
        min_sample_count=10,
    )

    # Valid search run
    _create_sample_run(
        exp_dir / "runs" / "run-01-valid",
        run_id="run-01-valid",
        exp_id=exp_id,
        candidate_id=cand_id,
        verdict="FEASIBLE",
        validity="VALID",
        ttft_p95=50.0,
    )
    # Contaminated rerun alphabetically later
    _create_sample_run(
        exp_dir / "runs" / "run-zz-contaminated",
        run_id="run-zz-contaminated",
        exp_id=exp_id,
        candidate_id=cand_id,
        verdict="INCONCLUSIVE",
        validity="CONTAMINATED",
        ttft_p95=999.0,
    )

    class DummyAdapter:
        model_name = "test-model-7b"
        runtime_name = "ollama"
        def get_environment_fingerprint(self):
            return {"provider": "ollama", "is_simulated": False}

    class DummyExecutor:
        def execute(self, **kwargs):
            from unittest.mock import MagicMock

            from slokern.contracts.enums import EvidenceValidity, ExecutionStatus
            from slokern.contracts.metrics import MetricSet, PercentileDistribution
            from slokern.contracts.verdict import FeasibilityResult
            res = MagicMock()
            rid = kwargs.get("run_id", "run-verify-test")
            res.run_record.execution_status = ExecutionStatus.COMPLETED
            res.run_record.run_id = rid
            dist = PercentileDistribution(p50=30.0, p90=40.0, p95=45.0, p99=50.0, mean=35.0, min=20.0, max=60.0)
            res.metric_set = MetricSet(
                metric_version="1.0.0",
                run_id=rid,
                sample_count=20,
                failed_request_count=0,
                offered_load_rps=2.0,
                achieved_load_rps=2.0,
                ttft_ms=dist,
                itl_ms=dist,
                e2e_latency_ms=dist,
                token_throughput_tps=50.0,
                request_throughput_rps=2.0,
                error_rate=0.0,
                generator_saturated=False,
            )
            res.feasibility_result = FeasibilityResult(
                policy_version="1.0.0",
                run_id=rid,
                overall_verdict=FeasibilityVerdict.FEASIBLE,
                constraint_evaluations=[],
                validity_status=EvidenceValidity.VALID,
                audit_notes="Hard constraints passed",
            )
            return res

    vrec = verify_search_campaign(
        experiment_id=exp_id,
        artifacts_root=tmp_path / "artifacts",
        search_result=search_result,
        workload=workload,
        slo=slo,
        adapter=DummyAdapter(),
        single_run_executor=DummyExecutor(),
    )
    # Must use run-01-valid as the original search run, NOT run-zz-contaminated
    assert vrec.original_run_id == "run-01-valid"


def test_six_run_budget_invariant() -> None:
    """
    Verify the strict 6-run budget invariant (AGENTS.md § 3.2):
    1 baseline + 4 search candidates + 1 verification = 6 runs total.
    """
    import pytest

    from slokern.core.search.budget import BudgetExhaustedError, BudgetLimiter

    budget = BudgetLimiter(max_total_runs=6, max_search_runs=5, max_verification_runs=1)
    assert budget.remaining_total_runs == 6
    assert budget.remaining_search_runs == 5
    assert budget.remaining_verification_runs == 1

    # 1 baseline + 4 candidates = 5 search runs
    for _ in range(5):
        assert budget.can_execute_search_run()
        budget.record_search_run()

    # 6th search run must be rejected
    assert not budget.can_execute_search_run()
    with pytest.raises(BudgetExhaustedError):
        budget.record_search_run()

    # 1 verification run is permitted
    assert budget.can_execute_verification_run()
    budget.record_verification_run()

    # Budget now completely exhausted
    assert budget.is_exhausted()
    assert not budget.can_execute_verification_run()
    with pytest.raises(BudgetExhaustedError):
        budget.record_verification_run()

