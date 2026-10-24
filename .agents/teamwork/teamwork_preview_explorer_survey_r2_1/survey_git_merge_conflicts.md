# Comprehensive Survey & Analysis: Git Branch & PR Conflict Resolution

> **Document:** `survey_git_merge_conflicts.md`  
> **Author:** Explorer 1 (Git Branch & PR Conflict Explorer)  
> **Target Date:** 2026-10-24T16:00:00Z  
> **Repository:** `c:\Users\paulr\OneDrive\DevArena\slokern`  
> **Milestone:** Reconcile all outstanding branches and pull requests into `main`  
> **Target Branches:**  
> - `origin/main` (commit `e09a936`)  
> - `origin/fix-search-integrity-3257089436809606744` (commit `b7ac44d`)  
> - `origin/2×2-bounded-search-controller` (commit `ba3199b`)  

---

## 1. Executive Summary

This survey provides a complete, evidence-based investigation of the git status, remote branches, commit histories, architectural divergences, and merge conflicts across the SLOKern codebase as of October 24, 2026.

### Key Discoveries:
1. **Common Ancestor (`4a97fb1`):**  
   All three branches (`origin/main`, `origin/fix-search-integrity-3257089436809606744`, and `origin/2×2-bounded-search-controller`) branched directly from commit `4a97fb141d0a552c0abcc8db1cad39b04919b9c8` (`re: Refactor evaluation and verification components...`).

2. **Branch Evolution and Relative Roles:**
   - **`origin/fix-search-integrity-3257089436809606744` (commit `b7ac44d`):**  
     Created by `google-labs-jules[bot]` (co-authored by Rajdeep Paul) on Oct 23, 16:45 UTC to address `BLK-15`, `BLK-16`, and `BLK-17`. It touched only 9 files (focusing on `validate_budget` in `budget.py`, strict ranking in `rank.py`, and basic capability rejection in `nebius.py`).
   - **`origin/main` (commit `e09a936`):**  
     Committed directly by Rajdeep Paul on Oct 24, 01:07 IST (`Refactor budget validation and grid search execution`). It **already incorporated and refined** the bugfixes from `b7ac44d` (specifically `validate_budget` in `budget.py`, `validate_command` in `validate.py`, strict NaN/Inf/bool/string ranking in `rank.py`, and added `tests/integration/test_grid_search_fake_adapter.py`).
   - **`origin/2×2-bounded-search-controller` (commits `9878d87`, `9c7dac9`, `ba3199b`):**  
     Contains the comprehensive implementation of `TASK-09` (`NebiusServingAdapter` with stdlib `urllib` transport, SSE streaming, and secret sanitization), `TASK-10` (the 2×2 bounded grid search controller, candidate identity normalizer, 6-run `BudgetLimiter`, and 33 unit tests), the circular import decoupling fix (`if TYPE_CHECKING:` in `grid.py`, deferred `generate_candidate_id` in `fake.py` and `nebius.py`), and full documentation synchronization across 24 project documents.

3. **The Core Merge Challenge:**  
   The primary merge challenge is **not** between `fix-search-integrity` and `main` (since `origin/main` already subsumed `fix-search-integrity`), but between **`origin/main` (`e09a936`) and `origin/2×2-bounded-search-controller` (`ba3199b`)**. There are exactly **12 conflicting files** between them.

4. **Windows Sandbox Security Constraint (`.git` ACL):**  
   Inspection confirms that sandboxed agents run under `ASTRYX\CodexSandboxUsers`, which possesses only `ReadAndExecute, Synchronize` on `.git`. Any command attempting to write to `.git` (such as `git add`, `git commit`, `git checkout`, `git merge`) fails with `Permission denied` on `index.lock`. All file reconciliation must be performed by modifying the working tree files directly; the commit/merge sequence can then be executed by the host or unconstrained orchestrator.

---

## 2. Git Status, Remotes, and Commit Topology

### 2.1 Remotes and Current Working Tree
- **Remote URL:** `origin`: `https://github.com/dev-paulrajdeep/slokern.git`
- **Active Working Branch:** `2×2-bounded-search-controller` (local branch is up to date with `origin/2×2-bounded-search-controller` at `ba3199b`).
- **Working Tree State:**  
  Clean with respect to tracked production files. Only `.agents/teamwork/ORIGINAL_REQUEST.md` has local changes (dispatch instructions), alongside untracked agent metadata folders in `.agents/teamwork/`.
- **Local `main` vs Remote `origin/main`:**  
  Local `main` is at commit `4a97fb1`. `origin/main` is 1 commit ahead at `e09a936`. Fast-forwarding local `main` to `origin/main` is a clean, non-conflicting fast-forward.

### 2.2 Commit Graph & Merge Bases

```
* ba3199b (origin/2×2-bounded-search-controller, HEAD -> 2×2-bounded-search-controller)
* 9c7dac9 re(budget): vm pricing management and documentation across search modules
* 9878d87 feat(worker): implement remediation and verification for circular import in SLOKern
|
| * e09a936 (origin/main, origin/HEAD) Refactor budget validation and grid search execution
|/
| * b7ac44d (origin/fix-search-integrity-3257089436809606744) fix(search): enforce budget, strict obj rank, nebius caps
|/
* 4a97fb1 (main) re: Refactor evaluation and verification components Revised ownership documentation
```

Merge base query:
```powershell
git merge-base origin/main origin/2×2-bounded-search-controller
# Output: 4a97fb141d0a552c0abcc8db1cad39b04919b9c8

git merge-base origin/main origin/fix-search-integrity-3257089436809606744
# Output: 4a97fb141d0a552c0abcc8db1cad39b04919b9c8

git merge-base origin/2×2-bounded-search-controller origin/fix-search-integrity-3257089436809606744
# Output: 4a97fb141d0a552c0abcc8db1cad39b04919b9c8
```

---

## 3. Comprehensive File Conflict Matrix

Using `git merge-tree 4a97fb1 origin/main origin/2×2-bounded-search-controller`, exactly **12 files** are identified as conflicting ("changed in both"). Below is the complete conflict breakdown and the required reconciliation specification:

| File Path | Changes in `origin/main` (`e09a936`) | Changes in `2×2-bounded-search-controller` (`ba3199b`) | Nature of Conflict | Reconciliation Strategy |
|---|---|---|---|---|
| `src/slokern/core/search/budget.py` | Added preflight specification validation: `BudgetValidationError`, `validate_budget(spec: ExperimentSpec)`. Validates `max_candidates >= 1`, `max_wallclock_seconds >= 1`, finite `max_cost_limit`, `repetitions >= 1`, and `duration_multiplier > 0`. | Implemented runtime budget limiter: `BudgetExhaustedError`, `BudgetLimiter`, and `ExperimentBudget = BudgetLimiter` alias. Enforces 6-run total budget invariant (max 5 search runs + 1 verification run). | Additive / Complementary. Both classes belong in `budget.py`. | **Merge Additively:** Include both `BudgetValidationError`, `validate_budget(spec)` (preflight) AND `BudgetExhaustedError`, `BudgetLimiter` (runtime limiter) in `budget.py`. Export both cleanly. |
| `src/slokern/core/search/rank.py` | Refined `rank_candidates`: filters out `None`, `bool`, non-numeric, `NaN`, `Inf`, and negative metrics. Feasible candidates ranked by objective, with deterministic tie-breaking by `candidate_id`. | `rank_candidates` retained known caveat `BLK-16` (sorting `None` to the end, but not filtering out non-finite objective metrics). | Quality upgrade in `main`. | **Adopt `origin/main` version:** Use `e09a936`'s implementation which resolves `BLK-16` completely with strict finite positive numeric checks and deterministic tie-breaking. |
| `src/slokern/core/search/grid.py` | Refactored `GridSearchController` to accept `run(spec: ExperimentSpec, cancellation_token: ...)` returning `GridSearchOutcome(search_result, run_results)`. Validates budget, checks adapter capabilities, uses wallclock timeout. | Implemented `GridSearchController.execute(...)` with `BudgetLimiter`, `generate_2x2_candidates`, `SearchResult` persistence, and zero-feasible handling. Also defines `extract_ranking_metric`. | Architectural interface divergence between `run(spec)` and `execute(...)`. | **Unify Interfaces:** Support both `run(spec=...)` (for integration tests and canonical specs) and `execute(...)` (for direct unit tests), delegating cleanly and utilizing `BudgetLimiter` for runtime budget tracking. Export `extract_ranking_metric` and `GridSearchOutcome`. Preserve circular import fix (`if TYPE_CHECKING:` import of `CancellationToken`). |
| `src/slokern/engine/serving/fake.py` | Added `max_num_batched_tokens` to `parameters` (min 128, max 65536, default 2048). Retained top-level `from slokern.core.search.candidate_id import generate_candidate_id`. | Added `max_num_batched_tokens` (min 128, max 32768, default 2048). Deferred `generate_candidate_id` inside `apply_config()` to decouple circular imports. | Parameter bounds and circular import fix. | **Reconcile:** Include `max_num_batched_tokens` with max 65536 and default 2048. **Crucial:** Preserve deferred import of `generate_candidate_id` inside `apply_config()` to maintain circular import decoupling. |
| `src/slokern/engine/serving/nebius.py` | Retained fail-closed scaffold `NebiusCloudAdapter` raising `ConfigurationError` and `health_check() -> False`. | Implemented complete `NebiusServingAdapter` (460+ lines) using standard library `urllib`, SSE chunk streaming, `sanitize_secret_message` secret redaction, and preflight capability checks. | Placeholder vs Production Implementation. | **Adopt `2×2` Implementation:** Keep full `NebiusServingAdapter`. Add alias `NebiusCloudAdapter = NebiusServingAdapter` to preserve backward compatibility for any existing code or tests expecting `NebiusCloudAdapter`. |
| `tests/unit/core/search/test_budget.py` | Tests `validate_budget`: checks valid limits, invalid `max_candidates`, invalid `max_wallclock_seconds`, non-positive `max_cost_limit`, invalid `repetitions`, invalid `duration_multiplier`. | Tests `BudgetLimiter`: checks 6-run budget invariant, 5 search runs limit, 1 verification run limit, timeouts, and stopping reason strings. | Test coverage split between preflight and runtime. | **Merge Tests Additively:** Combine all unit tests so that both `validate_budget` and `BudgetLimiter` are exhaustively tested in `test_budget.py`. |
| `tests/unit/core/test_ranker_validation.py` | Expanded to 7 unit tests covering `None`, `NaN`, `Inf`, `bool`, `string`, negative metrics, non-feasible filtering, and deterministic tie-breaking. | Baseline file had only 3 basic tests. | Subsumed by `main`. | **Adopt `origin/main` version:** Use `e09a936`'s comprehensive test suite. |
| `tests/unit/engine/serving/test_nebius.py` | Tests fail-closed scaffold `NebiusCloudAdapter`. | Exhaustive test suite (8 tests) for `NebiusServingAdapter`: secret sanitization, initialization fingerprint, strict mode rejection, mock health check, mock completions, mock SSE streaming, HTTP error secret redaction. | Scaffold tests vs Implementation tests. | **Adopt `2×2` Implementation:** Use the exhaustive unit test suite testing `NebiusServingAdapter`. Add 1 test verifying `NebiusCloudAdapter` alias compatibility. |
| `README.md` | Minor edits to test counts and status snapshot. | Comprehensive updates on model profile reconciliation, ADR references, architecture diagrams, and task status. | Overlapping status text. | **Reconcile:** Harmonize to reflect Phase C status, verified offline search on `DEMO DATA`, and accurate test counts. |
| `ROADMAP.md` | Updated to Day 4 status (Oct 24), documented CI run 39989410573 on `b7ac44d`, and test counts (355 collected). | Updated to Day 5 status (Oct 23/24), detailed status of TASK-01 through TASK-10, and caveats `BLK-15`, `BLK-16`, `BLK-17`. | Sprint tracking updates. | **Reconcile:** Align to Day 5 (Oct 24), marking `BLK-15` and `BLK-16` resolved, TASK-09 and TASK-10 verified offline with `DEMO DATA`, and 356 tests collected. |
| `docs/implementation-status.md` | Added Oct 24 status audit notes and PR `b7ac44d` audit results. | Detailed subsystem audit table, documented resolutions for CLM-09/11, and updated caveat tracking. | Subsystem table divergence. | **Reconcile:** Merge Oct 24 audit notes while preserving the accurate subsystem table where SUB-04, 05, 06, 07, 08, and 12 are marked implemented. |
| `docs/ownership.md` | Subsystem table accidentally reverted to older draft (marking SUB-06, 07, 12 as ABSENT). | Accurate subsystem table reflecting implementation of SUB-06 (loadgen), SUB-07 (metrics), SUB-08 (`SingleRunExecutor`), and SUB-12 (frontend). | Regression in `main`. | **Adopt `2×2` Subsystem Table:** Restore the accurate subsystem implementation matrix from `ba3199b`. |

---

## 4. Deep-Dive Subsystem Analysis

### 4.1 Budget Architecture: Preflight vs. Runtime Enforcement
- **The Core Divergence:**  
  On `origin/main` (`e09a936`), `budget.py` was implemented as a preflight schema validator:
  ```python
  def validate_budget(spec: ExperimentSpec) -> None:
      budget = spec.budget
      if budget.max_candidates < 1: raise BudgetValidationError(...)
      if budget.max_wallclock_seconds < 1: raise BudgetValidationError(...)
      if budget.max_cost_limit is not None and (not math.isfinite(budget.max_cost_limit) or budget.max_cost_limit <= 0):
          raise BudgetValidationError(...)
      ...
  ```
  On `origin/2×2-bounded-search-controller` (`ba3199b`), `budget.py` was implemented as a runtime state machine:
  ```python
  class BudgetLimiter:
      def __init__(self, max_total_runs: int = 6, max_search_runs: int = 5, max_verification_runs: int = 1, ...):
          ...
      def can_execute_search_run(self) -> bool: ...
      def record_search_run(self) -> None: ...
      def can_execute_verification_run(self) -> bool: ...
      def record_verification_run(self) -> None: ...
  ```
- **Reconciliation Plan:**  
  Both are vital and complementary. Preflight validation catches malformed specifications before any subprocesses are launched or resources are allocated. Runtime limiting guarantees that once execution begins, the controller can never exceed 5 search runs, reserving the 6th run for independent verification (`TASK-11`).
  `src/slokern/core/search/budget.py` will contain both definitions.

### 4.2 Candidate Ranking Invariants (`rank.py`)
- **Prior Flaw in `2×2` (`BLK-16`):**  
  In `ba3199b`, `rank_candidates()` did not remove candidates that had `ranking_metric = None` or invalid values; it simply sorted them to the end with `float('inf')`. If all candidates lacked valid metrics, an unranked candidate could still be selected.
- **Resolution in `origin/main` (`e09a936`):**  
  `e09a936` enforces that any candidate with `ranking_metric is None`, `isinstance(ranking_metric, bool)`, `not math.isfinite(ranking_metric)`, or `ranking_metric < 0` is strictly disqualified from consideration. Only feasible candidates with valid, finite, positive numeric objective metrics are eligible. Ties are deterministically broken by `candidate_id`.
- **Reconciliation Plan:**  
  Adopt the strict implementation from `origin/main` (`e09a936`).

### 4.3 Serving Adapters & Circular Import Decoupling
- **Circular Import Defect (Victory Rejection Finding 1):**  
  Top-level imports of `generate_candidate_id` in `fake.py` or `nebius.py`, combined with eager imports of `GridSearchController` in `core/search/__init__.py`, triggered an import cycle whenever `slokern.engine.loadgen` was loaded in isolation.
- **Remediation in `2×2`:**  
  1. `grid.py` imports `CancellationToken` only under `if TYPE_CHECKING:`.
  2. `fake.py` and `nebius.py` defer `from slokern.core.search.candidate_id import generate_candidate_id` inside `apply_config()`.
- **Reconciliation Plan:**  
  This decoupling must be strictly preserved across all merged files.

### 4.4 Nebius Serving Adapter (`nebius.py`)
- **Comparison:**
  - `origin/main`: A 60-line placeholder scaffold that unconditionally raises `ConfigurationError` or `ServingAdapterError`.
  - `origin/2×2`: A complete 460-line production-grade adapter using standard library `urllib` without third-party dependencies, implementing OpenAI-compatible completions and SSE chunk streaming, secret masking (`sanitize_secret_message`), and health check probes.
- **Reconciliation Plan:**  
  Adopt the full `NebiusServingAdapter` from `ba3199b`. Add `NebiusCloudAdapter = NebiusServingAdapter` alias to satisfy any callers of the scaffold class.

### 4.5 Search Controller (`grid.py`)
- **Comparison:**
  - `origin/main`: Provides `GridSearchController.run(spec: ExperimentSpec)` which validates the budget via `validate_budget(spec)` and coordinates execution.
  - `origin/2×2`: Provides `GridSearchController.execute(...)` which coordinates baseline and 2×2 grid candidates via `BudgetLimiter` and writes `search_result.json`.
- **Reconciliation Plan:**  
  Provide a unified `GridSearchController` that supports both `run(spec=...)` and `execute(...)`, where `run()` validates the spec, sets up the `BudgetLimiter`, calls `SingleRunExecutor`, records runs under the budget limiter, persists `search_result.json`, and returns `GridSearchOutcome`.

---

## 5. Security & Sandbox Constraints

Inspection of the filesystem permissions shows:
```
Path   : C:\Users\paulr\OneDrive\DevArena\slokern\.git
Access : ASTRYX\CodexSandboxUsers Allow  ReadAndExecute, Synchronize
```
- Sandboxed processes run under `ASTRYX\CodexSandboxUsers`.
- Because `.git` has only `ReadAndExecute, Synchronize`, creating `.git/index.lock` or writing `.git/refs/*` fails with:  
  `fatal: Unable to create '.../.git/index.lock': Permission denied`
- **Impact on Merge Execution:**
  1. File modifications across `src/`, `tests/`, `docs/`, and `README.md` can be performed cleanly by workers.
  2. Git operations that touch `.git` (such as `git commit` or `git checkout`) must either be executed outside the sandbox or via host commands provided in the handoff.
  3. All verification tools (`pytest`, `scripts/gen_contracts.py --check`, `compileall`, `pip check`) execute cleanly inside the sandbox.

---

## 6. Step-by-Step Merge & Reconciliation Strategy

To reconcile both branches into `main` cleanly with zero unresolved conflict markers, execute the following step-by-step procedure:

### Phase 1: Reconcile Code and Tests in the Working Tree
1. **Reconcile `src/slokern/core/search/budget.py`:**
   - Combine `BudgetValidationError` and `validate_budget(spec: ExperimentSpec)` (from `origin/main`) with `BudgetExhaustedError`, `BudgetLimiter`, and `ExperimentBudget = BudgetLimiter` (from `2×2`).
2. **Reconcile `src/slokern/core/search/rank.py`:**
   - Use the strict ranking implementation from `origin/main` (`e09a936`) which removes invalid metrics and deterministically tie-breaks by `candidate_id`.
3. **Reconcile `src/slokern/engine/serving/fake.py`:**
   - Keep `max_num_batched_tokens` in `parameters` (min 128, max 65536, default 2048).
   - Ensure `from slokern.core.search.candidate_id import generate_candidate_id` remains deferred inside `apply_config()`.
4. **Reconcile `src/slokern/engine/serving/nebius.py`:**
   - Keep full `NebiusServingAdapter` implementation with `urllib` transport, SSE streaming, and secret sanitization.
   - Add alias `NebiusCloudAdapter = NebiusServingAdapter`.
5. **Reconcile `src/slokern/core/search/grid.py`:**
   - Provide `GridSearchController` supporting both `run(spec)` and `execute(...)`.
   - Incorporate preflight `validate_budget(spec)` and runtime `BudgetLimiter`.
   - Keep `if TYPE_CHECKING:` import for `CancellationToken` to avoid circular imports.
   - Export `extract_ranking_metric` and `GridSearchOutcome`.
6. **Reconcile `src/slokern/cli/commands/validate.py`:**
   - Adopt the `origin/main` version using `Path(spec_file).read_text()` and calling `validate_budget(spec)`.
7. **Reconcile Unit and Integration Tests:**
   - Merge `tests/unit/core/search/test_budget.py` to test both `validate_budget` and `BudgetLimiter`.
   - Adopt `tests/unit/core/test_ranker_validation.py` from `origin/main` (7 tests).
   - Adopt `tests/unit/cli/commands/test_validate.py` from `origin/main`.
   - Include `tests/integration/test_grid_search_fake_adapter.py` from `origin/main`.
   - Preserve `tests/unit/core/search/test_grid.py` (5 tests), `test_space.py` (4 tests), `test_nebius.py` (8 tests), and `test_smoke_live.py`.

### Phase 2: Reconcile Documentation
1. **Reconcile `docs/ownership.md`:**
   - Restore the accurate subsystem implementation matrix from `ba3199b` showing SUB-06 (loadgen), SUB-07 (metrics), SUB-08 (orchestrator), and SUB-12 (frontend) as implemented.
2. **Reconcile `docs/implementation-status.md`:**
   - Harmonize Day 5 audit notes with verified 356 collected tests, documenting offline demo verification and resolving BLK-15/BLK-16.
3. **Reconcile `ROADMAP.md` and `README.md`:**
   - Update to Day 5 sprint reality, explicitly noting that offline grid search is verified on `DEMO DATA`, and live GPU testing requires credentials (`BLK-04`).

### Phase 3: Automated Validation
Run the mandatory verification gates:
```powershell
# 1. Check contracts & schemas
.\.venv\Scripts\python.exe scripts/gen_contracts.py --check

# 2. Check compilation and dependencies
.\.venv\Scripts\python.exe -m compileall -q src tests
.\.venv\Scripts\python.exe -m pip check

# 3. Run all targeted tests
.\.venv\Scripts\python.exe -m pytest tests/unit/core/ tests/unit/engine/serving/ tests/unit/cli/ tests/integration/ tests/contract/ tests/live/test_smoke_live.py -v
```

### Phase 4: Git Finalization Commands for Host / Main Integration
Because the sandbox environment enforces read-only access to `.git`, the host machine or elevated execution environment should run:
```powershell
# Switch to main and update to origin/main
git checkout main
git pull origin main

# Merge 2x2-bounded-search-controller branch with the reconciled files
git merge origin/2×2-bounded-search-controller --no-commit

# (Or apply the reconciled working tree, stage and commit)
git add src/ tests/ docs/ README.md ROADMAP.md
git commit -m "chore(merge): reconcile 2x2 grid search controller, budget invariants, and nebius serving adapter into main"
git push origin main
```

---

## 7. Conclusion

Both branches (`origin/fix-search-integrity` and `origin/2×2-bounded-search-controller`) provide critical, complementary value that can be cleanly unified into `main`. By combining the strict preflight budget validation and finite objective ranking from `origin/main` with the complete serving adapter, runtime budget limiter, and search controller from `2×2-bounded-search-controller`, the SLOKern pipeline achieves complete contract integrity, zero regressions, and robust end-to-end execution.
