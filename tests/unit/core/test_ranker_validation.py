import pytest
from slokern.core.search.rank import rank_candidates, EvaluatedCandidate
from slokern.contracts.enums import FeasibilityVerdict, RankingObjective
from slokern.contracts.metrics import MetricSet, PercentileDistribution
from slokern.core.search.rank import EvaluatedCandidate, rank_candidates
from slokern.core.search.space import validate_candidate_settings


def make_metrics():
    return MetricSet(
        metric_version="1.0",
        run_id="run-test",
        sample_count=1,
        failed_request_count=0,
        offered_load_rps=1.0,
        achieved_load_rps=1.0,
        generator_saturated=False,
        ttft_ms=PercentileDistribution(),
        itl_ms=PercentileDistribution(),
        e2e_latency_ms=PercentileDistribution(),
        request_throughput_rps=1.0,
        token_throughput_tps=10.0,
        error_rate=0.0,
    )


def candidate(candidate_id, ranking_metric, verdict=FeasibilityVerdict.FEASIBLE):
    return EvaluatedCandidate(candidate_id, verdict, ranking_metric, make_metrics())


# flake8: noqa: E501,F401,F811,E402,E302,E305,W293
from slokern.contracts.metrics import MetricSet, PercentileDistribution
import math


def create_mock_metric_set():
    return MetricSet(
        metric_version="1.0",
        run_id="test",
        sample_count=100,
        failed_request_count=0,
        offered_load_rps=10,
        achieved_load_rps=10,
        generator_saturated=False,
        ttft_ms=PercentileDistribution(),
        itl_ms=PercentileDistribution(),
        e2e_latency_ms=PercentileDistribution(),
        request_throughput_rps=10,
        token_throughput_tps=50,
        error_rate=0.0,
    )


def test_rank_candidates_filters_missing_cost():
    c1 = EvaluatedCandidate(
        "c1", FeasibilityVerdict.FEASIBLE, 10.0, create_mock_metric_set()
    )
    c2 = EvaluatedCandidate(
        "c2", FeasibilityVerdict.FEASIBLE, None, create_mock_metric_set()
    )
    ranked = rank_candidates([c1, c2], RankingObjective.MONETARY_COST_PER_TOKEN)
    assert len(ranked) == 1
    assert ranked[0].candidate_id == "c1"


def test_rank_candidates_filters_nan_inf():
    c1 = EvaluatedCandidate(
        "c1", FeasibilityVerdict.FEASIBLE, float("nan"), create_mock_metric_set()
    )
    c2 = EvaluatedCandidate(
        "c2", FeasibilityVerdict.FEASIBLE, float("inf"), create_mock_metric_set()
    )
    c3 = EvaluatedCandidate(
        "c3", FeasibilityVerdict.FEASIBLE, 10.0, create_mock_metric_set()
    )
    ranked = rank_candidates([c1, c2, c3], RankingObjective.MONETARY_COST_PER_TOKEN)
    assert len(ranked) == 1
    assert ranked[0].candidate_id == "c3"


def test_rank_candidates_empty_if_all_invalid():
    c1 = EvaluatedCandidate(
        "c1", FeasibilityVerdict.FEASIBLE, float("nan"), create_mock_metric_set()
    )
    ranked = rank_candidates([c1], RankingObjective.MONETARY_COST_PER_TOKEN)
    assert len(ranked) == 0


def test_rank_candidates_preserves_deterministic_tie_breaks():
    c1 = EvaluatedCandidate(
        "cand2", FeasibilityVerdict.FEASIBLE, 10.0, create_mock_metric_set()
    )
    c2 = EvaluatedCandidate(
        "cand1", FeasibilityVerdict.FEASIBLE, 10.0, create_mock_metric_set()
    )
    ranked = rank_candidates([c1, c2], RankingObjective.MONETARY_COST_PER_TOKEN)
    assert ranked[0].candidate_id == "cand1"
    assert ranked[1].candidate_id == "cand2"


def test_rank_candidates_invalid_objective_types():
    # String is invalid
    c1 = EvaluatedCandidate(
        "c1", FeasibilityVerdict.FEASIBLE, "10.0", create_mock_metric_set()
    )
    ranked = rank_candidates([c1], RankingObjective.MONETARY_COST_PER_TOKEN)
    assert len(ranked) == 0
