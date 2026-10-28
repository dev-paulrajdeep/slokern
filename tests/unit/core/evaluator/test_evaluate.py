"""
Purpose: Unit tests for core/evaluator/evaluate.
Owner: Rajdeep (Historical design: Daksh)
"""

import math

import pytest

from slokern.contracts.metrics import MetricSet, PercentileDistribution
from slokern.core.evaluator.evaluate import evaluate_constraint, get_observed_value


@pytest.fixture
def dummy_metric_set() -> MetricSet:
    return MetricSet(
        metric_version="1.0.0",
        run_id="test-run-123",
        sample_count=100,
        failed_request_count=0,
        offered_load_rps=10.0,
        achieved_load_rps=10.0,
        generator_saturated=False,
        ttft_ms=PercentileDistribution(p50=100.0, p90=150.0, p95=200.0, p99=250.0, mean=110.0, min=50.0, max=300.0),
        itl_ms=PercentileDistribution(p50=10.0, p90=15.0, p95=20.0, p99=25.0, mean=12.0, min=5.0, max=30.0),
        e2e_latency_ms=PercentileDistribution(p50=500.0, p90=700.0, p95=800.0, p99=900.0, mean=550.0, min=300.0, max=1000.0),
        request_throughput_rps=9.5,
        token_throughput_tps=500.0,
        error_rate=0.01,
        metadata={}
    )

def test_get_observed_value_throughput(dummy_metric_set: MetricSet) -> None:
    assert get_observed_value(dummy_metric_set, "request_throughput", "") == 9.5
    assert get_observed_value(dummy_metric_set, "request_throughput_rps", "") == 9.5
    assert get_observed_value(dummy_metric_set, "token_throughput", "") == 500.0
    assert get_observed_value(dummy_metric_set, "token_throughput_tps", "") == 500.0

def test_get_observed_value_error_rate(dummy_metric_set: MetricSet) -> None:
    assert get_observed_value(dummy_metric_set, "error_rate", "") == 0.01

def test_get_observed_value_percentiles(dummy_metric_set: MetricSet) -> None:
    assert get_observed_value(dummy_metric_set, "ttft", "p95") == 200.0
    assert get_observed_value(dummy_metric_set, "ttft_ms", "p50") == 100.0
    assert get_observed_value(dummy_metric_set, "itl", "mean") == 12.0
    assert get_observed_value(dummy_metric_set, "itl_ms", "max") == 30.0
    assert get_observed_value(dummy_metric_set, "e2e_latency", "p99") == 900.0
    assert get_observed_value(dummy_metric_set, "e2e_latency_ms", "min") == 300.0

def test_get_observed_value_invalid_or_missing(dummy_metric_set: MetricSet) -> None:
    assert get_observed_value(dummy_metric_set, "invalid_metric", "") is None
    assert get_observed_value(dummy_metric_set, "ttft", "invalid_stat") is None

def test_evaluate_constraint_valid_operators() -> None:
    """Test evaluate_constraint with valid values and operators."""
    # <=
    assert evaluate_constraint(10.0, 15.0, "<=") is True
    assert evaluate_constraint(15.0, 15.0, "<=") is True
    assert evaluate_constraint(20.0, 15.0, "<=") is False

    # <
    assert evaluate_constraint(10.0, 15.0, "<") is True
    assert evaluate_constraint(15.0, 15.0, "<") is False
    assert evaluate_constraint(20.0, 15.0, "<") is False

    # >=
    assert evaluate_constraint(20.0, 15.0, ">=") is True
    assert evaluate_constraint(15.0, 15.0, ">=") is True
    assert evaluate_constraint(10.0, 15.0, ">=") is False

    # >
    assert evaluate_constraint(20.0, 15.0, ">") is True
    assert evaluate_constraint(15.0, 15.0, ">") is False
    assert evaluate_constraint(10.0, 15.0, ">") is False

def test_evaluate_constraint_none_values() -> None:
    """Test evaluate_constraint with None values."""
    assert evaluate_constraint(None, 10.0, "<=") is None
    assert evaluate_constraint(10.0, None, "<=") is None  # type: ignore[arg-type]
    assert evaluate_constraint(None, None, "<=") is None  # type: ignore[arg-type]

def test_evaluate_constraint_boolean_values() -> None:
    """Test evaluate_constraint with boolean values."""
    assert evaluate_constraint(True, 10.0, "<=") is None
    assert evaluate_constraint(False, 10.0, "<=") is None
    assert evaluate_constraint(10.0, True, "<=") is None
    assert evaluate_constraint(10.0, False, "<=") is None

def test_evaluate_constraint_negative_values() -> None:
    """Test evaluate_constraint with negative values."""
    assert evaluate_constraint(-1.0, 10.0, "<=") is None
    assert evaluate_constraint(10.0, -1.0, "<=") is None
    assert evaluate_constraint(-1.0, -1.0, "<=") is None

def test_evaluate_constraint_non_finite_values() -> None:
    """Test evaluate_constraint with non-finite values (NaN, Inf)."""
    assert evaluate_constraint(math.nan, 10.0, "<=") is None
    assert evaluate_constraint(10.0, math.nan, "<=") is None

    assert evaluate_constraint(math.inf, 10.0, "<=") is None
    assert evaluate_constraint(10.0, math.inf, "<=") is None

    assert evaluate_constraint(-math.inf, 10.0, "<=") is None
    assert evaluate_constraint(10.0, -math.inf, "<=") is None

def test_evaluate_constraint_unsupported_operators() -> None:
    """Test evaluate_constraint with unsupported operators."""
    assert evaluate_constraint(10.0, 15.0, "==") is None
    assert evaluate_constraint(10.0, 15.0, "!=") is None
    assert evaluate_constraint(10.0, 15.0, "abc") is None
    assert evaluate_constraint(10.0, 15.0, "") is None
