import pytest
from slokern.core.search.budget import validate_budget, BudgetValidationError
from slokern.contracts.spec import (
    # flake8: noqa: E501,F401,F811,E402,E302,E305,W293
    ExperimentSpec,
    WorkloadSpec,
    SLOSpec,
    ExperimentBudget,
    ExperimentVerificationPolicy,
)
from slokern.contracts.enums import ArrivalMode


def create_mock_spec(max_candidates: int, repetitions: int) -> ExperimentSpec:
    return ExperimentSpec(
        experiment_id="test",
        workload=WorkloadSpec(
            schema_version="1.0",
            workload_name="test",
            fixture_id="fix",
            arrival_mode=ArrivalMode.CONSTANT,
            target_offered_rate=10,
            concurrency_limit=10,
            warmup_duration_s=1,
            measurement_duration_s=5,
            max_input_tokens=100,
            max_output_tokens=100,
        ),
        slo=SLOSpec(slo_id="slo", constraints=[], min_sample_count=1),
        search_space={},
        budget=ExperimentBudget(
            max_candidates=max_candidates, max_wallclock_seconds=300
        ),
        verification_policy=ExperimentVerificationPolicy(
            repetitions=repetitions, duration_multiplier=1.0
        ),
    )


def test_validate_budget_valid():
    spec = create_mock_spec(max_candidates=4, repetitions=1)
    validate_budget(spec)  # Should not raise


def test_validate_budget_invalid_candidates():
    spec = create_mock_spec(max_candidates=0, repetitions=1)
    with pytest.raises(BudgetValidationError, match="budget.max_candidates must be >= 1"):
        validate_budget(spec)


def test_validate_budget_invalid_repetitions():
    spec = create_mock_spec(max_candidates=4, repetitions=0)
    with pytest.raises(BudgetValidationError, match="budget.verification_policy.repetitions must be >= 1"):
        validate_budget(spec)
