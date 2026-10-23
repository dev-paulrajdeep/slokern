"""
Independent stress test script run by sentinel_victory_auditor_2.
Verifies R1, R2, R3 invariants directly.
"""

import sys
import os
import json
import pytest

from slokern.core.search.space import generate_2x2_candidates, BOUNDED_SEARCH_SPACE_2X2
from slokern.core.search.candidate_id import generate_candidate_id
from slokern.core.search.budget import BudgetLimiter, BudgetExhaustedError
from slokern.core.search.rank import rank_candidates, EvaluatedCandidate
from slokern.contracts.enums import FeasibilityVerdict, RankingObjective
from slokern.contracts.metrics import MetricSet
from slokern.contracts.search import SearchResult, CandidateSummary
from slokern.engine.serving.nebius import sanitize_secret_message, NebiusServingAdapter
from pydantic import ValidationError

def test_space_and_candidate_ids():
    cands = generate_2x2_candidates("meta-llama/Llama-3-8B", "vllm-nebius")
    assert len(cands) == 4, f"Expected 4 candidates, got {len(cands)}"
    ids = set()
    for c in cands:
        expected_id = generate_candidate_id(c.model_name, c.runtime_name, c.requested_settings)
        assert c.candidate_id == expected_id, f"ID mismatch: {c.candidate_id} vs {expected_id}"
        ids.add(c.candidate_id)
    assert len(ids) == 4, "Candidate IDs must be distinct"
    print("[PASS] test_space_and_candidate_ids")

def test_budget_invariants():
    budget = BudgetLimiter(max_total_runs=6, max_search_runs=5, max_verification_runs=1)
    for i in range(5):
        assert budget.can_execute_search_run(), f"Should allow search run {i}"
        budget.record_search_run()
    
    assert not budget.can_execute_search_run(), "Search run 6 must not be allowed"
    try:
        budget.record_search_run()
        assert False, "Should have raised BudgetExhaustedError on search run 6"
    except BudgetExhaustedError:
        pass

    assert budget.can_execute_verification_run(), "Reserved verification run must be available"
    budget.record_verification_run()
    assert not budget.can_execute_verification_run(), "Second verification run must not be allowed"
    try:
        budget.record_verification_run()
        assert False, "Should have raised BudgetExhaustedError on 2nd verification run"
    except BudgetExhaustedError:
        pass
    print("[PASS] test_budget_invariants")

def test_deterministic_ranking_tie_breaking():
    cand1 = EvaluatedCandidate(candidate_id="b_cand", verdict=FeasibilityVerdict.FEASIBLE, ranking_metric=10.0, metric_set=None)
    cand2 = EvaluatedCandidate(candidate_id="a_cand", verdict=FeasibilityVerdict.FEASIBLE, ranking_metric=10.0, metric_set=None)
    cand_infeasible = EvaluatedCandidate(candidate_id="z_cand", verdict=FeasibilityVerdict.INFEASIBLE, ranking_metric=1.0, metric_set=None)
    
    ranked = rank_candidates([cand1, cand2, cand_infeasible], RankingObjective.MONETARY_COST_PER_TOKEN)
    assert len(ranked) == 2, "Infeasible candidates must be excluded"
    assert ranked[0].candidate_id == "a_cand", "Tie-break must sort candidate_id alphabetically"
    assert ranked[1].candidate_id == "b_cand"
    print("[PASS] test_deterministic_ranking_tie_breaking")

def test_secret_sanitization():
    secret = "sk-nebius-secret-1234567890abcdef"
    msg = f"Failed with Bearer {secret} and api_key='{secret}'"
    sanitized = sanitize_secret_message(msg, secret)
    assert secret not in sanitized, "Secret must be completely redacted"
    assert "***REDACTED***" in sanitized, "Redaction token must be present"
    print("[PASS] test_secret_sanitization")

def test_search_result_forbids_extra():
    data = {
        "experiment_id": "exp-1",
        "baseline_candidate_id": "base-1",
        "tested_candidates": ["base-1"],
        "candidate_summaries": {
            "base-1": {"verdict": "FEASIBLE", "ranking_metric": 1.0}
        },
        "ranking_objective": "GPU_SECONDS_PER_REQUEST",
        "selected_candidate_id": "base-1",
        "selection_rationale": "ok",
        "stopping_reason": "space_exhausted",
        "illegal_extra_field": 123
    }
    try:
        SearchResult.model_validate(data)
        assert False, "Should have failed due to extra='forbid'"
    except ValidationError:
        pass
    print("[PASS] test_search_result_forbids_extra")

if __name__ == "__main__":
    test_space_and_candidate_ids()
    test_budget_invariants()
    test_deterministic_ranking_tie_breaking()
    test_secret_sanitization()
    test_search_result_forbids_extra()
    print("ALL INDEPENDENT STRESS TESTS PASSED!")
