"""
Purpose: Candidate, runtime and total experiment budget enforcement.
Owner: Rajdeep (Historical design: Rohan)
Authority: Aligned with AGENTS.md Section 6, ROADMAP.md Section 3.2, and TASK-10
"""

import time
from typing import Optional


class BudgetExhaustedError(Exception):
    """Raised when an execution attempt would exceed the allowed experiment budget."""
    pass


class BudgetLimiter:
    """
    Defaults to a 6-run allocation:
    1 baseline + 4 search candidates + 1 verification run = 6 runs total.
    The default search limit is 5 (baseline + candidates). Constructor limits are
    configurable, so this class does not itself make that allocation invariant.
    """

    def __init__(
        self,
        max_total_runs: int = 6,
        max_search_runs: int = 5,
        max_verification_runs: int = 1,
        timeout_seconds: Optional[float] = None,
    ) -> None:
        if max_search_runs + max_verification_runs > max_total_runs:
            raise ValueError(
                f"Sum of max_search_runs ({max_search_runs}) and max_verification_runs "
                f"({max_verification_runs}) exceeds max_total_runs ({max_total_runs})."
            )

        self.max_total_runs = max_total_runs
        self.max_search_runs = max_search_runs
        self.max_verification_runs = max_verification_runs
        self.timeout_seconds = timeout_seconds

        self.start_time = time.time()
        self._runs_executed = 0
        self._search_runs_executed = 0
        self._verification_runs_executed = 0

    @property
    def runs_executed(self) -> int:
        """Total benchmark runs executed so far (search + verification)."""
        return self._runs_executed

    @property
    def search_runs_executed(self) -> int:
        """Candidate search runs executed so far (baseline + search candidates)."""
        return self._search_runs_executed

    @property
    def verification_runs_executed(self) -> int:
        """Independent verification runs executed so far."""
        return self._verification_runs_executed

    @property
    def remaining_total_runs(self) -> int:
        """Remaining total experiment run budget."""
        return max(0, self.max_total_runs - self._runs_executed)

    @property
    def remaining_search_runs(self) -> int:
        """Remaining search phase run budget."""
        return max(0, self.max_search_runs - self._search_runs_executed)

    @property
    def remaining_verification_runs(self) -> int:
        """Remaining verification phase run budget."""
        return max(0, self.max_verification_runs - self._verification_runs_executed)

    def is_timed_out(self) -> bool:
        """Returns True if timeout_seconds is exceeded."""
        if self.timeout_seconds is None or self.timeout_seconds <= 0:
            return False
        return (time.time() - self.start_time) >= self.timeout_seconds

    def is_search_exhausted(self) -> bool:
        """Returns True if search phase budget has been reached."""
        return (
            self._search_runs_executed >= self.max_search_runs
            or self._runs_executed >= self.max_total_runs
        )

    def is_exhausted(self) -> bool:
        """Returns True if the total experiment budget of 6 runs has been reached."""
        return self._runs_executed >= self.max_total_runs

    def can_execute_search_run(self) -> bool:
        """Returns True if another search run can be dispatched under the budget and deadline."""
        if self.is_timed_out():
            return False
        return (
            self._search_runs_executed < self.max_search_runs
            and self._runs_executed < self.max_total_runs
        )

    def record_search_run(self) -> None:
        """
        Records the execution of a candidate search run.
        Raises BudgetExhaustedError if the search budget is already exhausted.
        """
        if not self.can_execute_search_run():
            if self.is_timed_out():
                raise BudgetExhaustedError(
                    f"Experiment budget timed out after {self.timeout_seconds}s."
                )
            raise BudgetExhaustedError(
                f"Search run budget exhausted: {self._search_runs_executed}/{self.max_search_runs} "
                f"search runs executed (total: {self._runs_executed}/{self.max_total_runs})."
            )

        self._search_runs_executed += 1
        self._runs_executed += 1

    def can_execute_verification_run(self) -> bool:
        """Returns True if the independent verification run can be dispatched."""
        if self.is_timed_out():
            return False
        return (
            self._verification_runs_executed < self.max_verification_runs
            and self._runs_executed < self.max_total_runs
        )

    def record_verification_run(self) -> None:
        """
        Records the execution of an independent verification run.
        Raises BudgetExhaustedError if the verification budget is already exhausted.
        """
        if not self.can_execute_verification_run():
            if self.is_timed_out():
                raise BudgetExhaustedError(
                    f"Experiment budget timed out after {self.timeout_seconds}s."
                )
            raise BudgetExhaustedError(
                f"Verification run budget exhausted: {self._verification_runs_executed}/"
                f"{self.max_verification_runs} runs executed (total: {self._runs_executed}/"
                f"{self.max_total_runs})."
            )

        self._verification_runs_executed += 1
        self._runs_executed += 1

    def get_stopping_reason(
        self,
        space_exhausted: bool = False,
        cancelled: bool = False,
        early_convergence: bool = False,
    ) -> str:
        """
        Derives canonical stopping reason string conforming to SearchResult schema.
        Canonical reasons: 'budget_exhausted', 'space_exhausted', 'early_convergence', 'timeout', 'cancelled'.
        """
        if cancelled:
            return "cancelled"
        if self.is_timed_out():
            return "timeout"
        if early_convergence:
            return "early_convergence"
        if space_exhausted:
            return "space_exhausted"
        if self.is_search_exhausted():
            return "budget_exhausted"
        return "space_exhausted"


# Class alias for backward compatibility / caller convenience
ExperimentBudget = BudgetLimiter
