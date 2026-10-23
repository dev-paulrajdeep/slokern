from slokern.contracts.spec import ExperimentSpec


class BudgetValidationError(ValueError):
    # flake8: noqa: E501,F401,F811,E402,E302,E305,W293
    pass


def validate_budget(spec: ExperimentSpec) -> None:
    """
    Validates that the experiment budget is positive and that the required
    independent verification repetitions are preserved.
    """
    if spec.budget.max_candidates < 1:
        raise BudgetValidationError(
            f"max_candidates must be >= 1, got {spec.budget.max_candidates}"
        )

    if spec.verification_policy.repetitions < 1:
        raise BudgetValidationError(
            f"verification_policy.repetitions must be >= 1, got {spec.verification_policy.repetitions}"
        )
