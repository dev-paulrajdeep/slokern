# Dispatch Instructions

## 2026-10-22T21:59:59Z

You are the Project Orchestrator for SLOKern.
Your working directory is: c:\Users\paulr\OneDrive\DevArena\slokern\.agents\teamwork\orchestrator_1
The authoritative request is recorded in: c:\Users\paulr\OneDrive\DevArena\slokern\.agents\teamwork\ORIGINAL_REQUEST.md

Task:
Conduct a comprehensive, independent end-to-end audit and verification of SLOKern's 2×2 Bounded Grid Search Controller (TASK-10), Budget Limiter, and Nebius Serving Adapter (TASK-09), asserting contract validity, strict 6-run budget invariant enforcement, deterministic candidate ranking, secret redaction, and full regression test suite integrity.

Requirements from ORIGINAL_REQUEST.md:
R1. Audit 2×2 Search Space & Budget Limiter (SUB-04 / SUB-08)
- Verify that `src/slokern/core/search/space.py` generates exactly 4 legal, distinct candidates across the declared 2×2 matrix (max_num_batched_tokens in {1024, 2048} x max_num_seqs in {16, 64}) with canonical normalized candidate IDs.
- Verify that `src/slokern/core/search/budget.py` strictly enforces the 6-run total budget invariant: 1 baseline run + 4 search candidate runs = 5 runs executed during search, strictly reserving 1 run for independent verification (TASK-11). Reject any attempt to exceed 5 search runs with BudgetExhaustedError.

R2. Audit Grid Search Controller & Deterministic Ranking (SUB-04)
- Verify that `src/slokern/core/search/grid.py` orchestrates baseline execution (Run 0), generates candidates, executes each candidate via SingleRunExecutor, collects results, and filters non-feasible candidates (verdict != FEASIBLE).
- Verify ranking deterministically selects the winning candidate according to the declared ranking_objective (Mode B proxy or Mode A cost), breaking ties deterministically by candidate ID.
- Verify SearchResult artifact persistence (artifacts/experiments/<experiment_id>/search_result.json) strictly validates against the canonical Pydantic schema in `src/slokern/contracts/search.py`.
- Verify graceful zero-feasible handling: emits selected_candidate_id = None and stopping_reason = 'space_exhausted'.

R3. Audit Nebius Serving Adapter & Preflight Probe (SUB-05)
- Verify that `src/slokern/engine/serving/nebius.py` implements the OpenAI-compatible vLLM serving adapter using standard library urllib without introducing unapproved dependencies.
- Verify secret masking: all errors, logs, and exception strings redact NEBIUS_API_KEY and bearer tokens (docs/deployment.md Section 4).
- Verify that `tests/live/test_smoke_live.py` executes against live Nebius endpoint if NEBIUS_API_KEY is present, or skips cleanly with an actionable message if unset (BLK-04 offline limitation).

R4. Test Suite Execution & Contract Consistency
- Verify that all unit and contract tests in `tests/unit/core/search/`, `tests/unit/engine/serving/test_nebius.py`, `tests/contract/`, and `tests/unit/core/` pass cleanly.
- Verify that `python scripts/gen_contracts.py --check` reports `[OK] All 11 schemas are up to date.`
- Verify that `python -m compileall -q src tests` and `python -m pip check` report zero errors.

Acceptance Criteria:
- generate_2x2_candidates() produces exactly 4 unique CandidateConfig objects with valid candidate_ids matching generate_candidate_id().
- BudgetLimiter.can_execute_search_run() returns False after 5 runs (1 baseline + 4 candidates); record_search_run() raises BudgetExhaustedError on run 6.
- GridSearchController.run_search() completes 5 runs using FakeServingAdapter and writes valid search_result.json.
- Feasible candidate with best objective metric is selected as winner; infeasible candidates are never selected.
- Emitted SearchResult validates 100% against slokern.contracts.search.SearchResult with extra='forbid'.
- NebiusServingAdapter accurately validates capabilities, handles completions and SSE token streams, and redacts secrets on HTTP errors.
- test_smoke_live.py skips cleanly without error when NEBIUS_API_KEY is unset.
- All 356 tests collected by pytest with 0 collection errors.
- All non-live deterministic tests pass with 0 failures.
- python scripts/gen_contracts.py --check passes with exit code 0.
- Working tree status clean on git branch 2×2-bounded-search-controller.


## 2026-10-22T23:50:00Z
=== INDEPENDENT VICTORY AUDIT RESULT: VICTORY REJECTED ===

The Independent Victory Auditor has reviewed your completion claim and issued a VICTORY REJECTED verdict.
You must resume the team immediately to address and remediate all rejection findings below.

Audit Report:
--------------------------------------------------------------------------------
VERDICT: VICTORY REJECTED

PHASE A — TIMELINE:
  Result: FAIL
  Anomalies:
    1. Working Tree Not Clean: `git status -s` reveals 14 modified implementation and documentation files remain completely uncommitted on branch `2×2-bounded-search-controller`. This directly violates the explicit Acceptance Criterion in ORIGINAL_REQUEST.md: "Working tree status clean on git branch 2×2-bounded-search-controller".
    2. False Verification Claim: Challenger 2 claimed in their handoff report that "working tree is clean", which was accepted without verification.

PHASE B — INTEGRITY CHECK:
  Result: FAIL
  Details:
    - R1, R2, R3 genuine implementations verified.
    - Architectural Defect (Circular Import): An eager import of GridSearchController in `src/slokern/core/search/__init__.py:22` triggers an import of `grid.py`, which imports `slokern.engine.runner`, which in turn imports `slokern.engine.loadgen.runner`. This creates an unresolvable circular import when `slokern.engine.loadgen` is loaded directly (e.g. `tests/unit/engine/loadgen/test_arrival.py`).
    Traceback:
      src/slokern/engine/loadgen/__init__.py:8 in <module>
          from slokern.engine.loadgen.runner import LoadGeneratorRunner
      src/slokern/engine/loadgen/runner.py:21 in <module>
          from slokern.engine.serving.base import BaseServingAdapter
      src/slokern/engine/serving/__init__.py:18 in <module>
          from .fake import FakeServingAdapter
      src/slokern/engine/serving/fake.py:15 in <module>
          from slokern.core.search.candidate_id import generate_candidate_id
      src/slokern/core/search/__init__.py:22 in <module>
          from slokern.core.search.grid import GridSearchController
      src/slokern/core/search/grid.py:20 in <module>
          from slokern.engine.runner.cancel import CancellationToken
      src/slokern/engine/runner/__init__.py:6 in <module>
          from slokern.engine.runner.run_executor import SingleRunExecutor
      src/slokern/engine/runner/run_executor.py:31 in <module>
          from slokern.engine.loadgen.runner import LoadGeneratorRunner
      E ImportError: cannot import name 'LoadGeneratorRunner' from partially initialized module 'slokern.engine.loadgen.runner'

PHASE C — INDEPENDENT TEST EXECUTION:
  Results:
    - 242 targeted tests passed.
    - Pytest collection: 356 tests collected.
    - Contract schemas: All 11 schemas up to date.
    - Standalone loadgen test: FAILED with circular import ImportError.
    - Git working tree: DIRTY (14 files modified uncommitted).

Full auditor documentation is in:
`c:\Users\paulr\OneDrive\DevArena\slokern\.agents\teamwork\sentinel_victory_auditor_2\handoff.md`

Remediation required:
1. Fix circular import between `slokern.core.search`, `slokern.engine.serving.fake`, and `slokern.engine.runner`. (Ensure standalone test execution like `pytest tests/unit/engine/loadgen/test_arrival.py` passes cleanly).
2. Clean working tree on git branch `2×2-bounded-search-controller` per acceptance criteria.
3. Re-verify all gates and claim completion once resolved.
--------------------------------------------------------------------------------
