# Consolidated Survey & Audit Report: TASK-09 & TASK-10

> **Audit Target:** SLOKern 2×2 Bounded Grid Search Controller (TASK-10), Budget Limiter, and Nebius Serving Adapter (TASK-09)  
> **Auditor:** Consolidated Survey Explorer (`teamwork_preview_explorer_survey_r2`)  
> **Timestamp:** 2026-10-22T22:38:00Z  
> **Branch:** `2×2-bounded-search-controller`  
> **Integrity Mode:** Development / Verification  

---

## 1. Observation

Direct code and test observations were collected across the declared bounded scope (`src/slokern/core/search/`, `src/slokern/contracts/search.py`, `src/slokern/engine/serving/nebius.py`, `tests/live/test_smoke_live.py`, `scripts/gen_contracts.py`).

### 1.1 R1: 2×2 Search Space & Budget Limiter (`SUB-04` / `SUB-08`)
- **Search Space Dimensions (`src/slokern/core/search/space.py:12-15`):**
  ```python
  BOUNDED_SEARCH_SPACE_2X2: Dict[str, List[int]] = {
      "max_num_batched_tokens": [1024, 2048],
      "max_num_seqs": [16, 64],
  }
  ```
- **Candidate Generation & Canonical IDs (`src/slokern/core/search/space.py:36-67`):**
  `generate_2x2_candidates(model_name: str, runtime_name: str) -> List[CandidateConfig]` generates exactly 4 `CandidateConfig` objects iterating across `max_num_batched_tokens` $\in \{1024, 2048\}$ and `max_num_seqs` $\in \{16, 64\}$. Each candidate ID is computed via `generate_candidate_id(model_name, runtime_name, settings)`, which performs canonical JSON normalization and returns a 12-character SHA-256 hex digest (`src/slokern/core/search/candidate_id.py:61-69`).
- **6-Run Budget Invariant (`src/slokern/core/search/budget.py:23-39, 93-147`):**
  ```python
  class BudgetLimiter:
      def __init__(
          self,
          max_total_runs: int = 6,
          max_search_runs: int = 5,
          max_verification_runs: int = 1,
          timeout_seconds: Optional[float] = None,
      ) -> None:
  ```
  - `can_execute_search_run()` returns `True` only while `_search_runs_executed < 5` and `_runs_executed < 6`.
  - Calling `record_search_run()` on run 6 raises `BudgetExhaustedError("Search run budget exhausted: 5/5 search runs executed (total: 5/6)")`.
  - Exactly 1 run is reserved for independent verification via `can_execute_verification_run()` and `record_verification_run()`, raising `BudgetExhaustedError` on any execution beyond run 6.

### 1.2 R2: Grid Search Controller & Deterministic Ranking (`SUB-04`)
- **Execution Orchestration (`src/slokern/core/search/grid.py:179-265`):**
  - Run 0 (Baseline): executed with `baseline_run_id = f"run-00-baseline-{baseline_config.candidate_id[:6]}"` via `single_run_executor.execute()`.
  - Runs 1-4 (Search Candidates): iterates over `grid_candidates` from `generate_2x2_candidates()`, executing each with `run_id = f"run-{idx:02d}-cand-{candidate.candidate_id[:6]}"`.
- **Feasibility Filtering & Tie-Breaking (`src/slokern/core/search/rank.py:21-56`):**
  - Feasibility filter: `feasible_candidates = [c for c in evaluated_candidates if c.verdict == FeasibilityVerdict.FEASIBLE]`. Infeasible runs (`verdict != FEASIBLE`) are strictly excluded.
  - Direction: Cost (`MONETARY_COST_PER_TOKEN`, `MONETARY_COST_PER_1K_REQUESTS`, `GPU_SECONDS_PER_REQUEST`) is minimized; throughput (`MAX_THROUGHPUT_UNDER_SLO`) is maximized.
  - Deterministic tie-breaking: `c.candidate_id` is passed as the second element of the sort key tuple (`rank.py:52`).
- **Zero-Feasible Handling (`src/slokern/core/search/grid.py:308-319`):**
  When no candidate is feasible:
  - `selected_candidate_id = None`
  - `selection_rationale = f"No candidate among {len(tested_candidates)} tested configurations satisfied all declared hard SLO constraints."`
  - `stopping_reason = budget.get_stopping_reason(space_exhausted=all_grid_completed)` -> returns `"space_exhausted"` when all 4 grid candidates completed.
- **Contract Schema Validation (`src/slokern/contracts/search.py:12-31`):**
  `SearchResult` and `CandidateSummary` enforce `model_config = ConfigDict(extra="forbid")`. `grid.py:334-335` writes `search_result.json` to `artifacts/experiments/<experiment_id>/search_result.json` using `model_dump_json(indent=2)`.

### 1.3 R3: Nebius Serving Adapter & Preflight Probe (`SUB-05`)
- **Standard Library Urllib Implementation (`src/slokern/engine/serving/nebius.py:11-13`):**
  Uses `urllib.request`, `urllib.parse`, and `urllib.error`. No external HTTP libraries (`requests`, `httpx`, `aiohttp`) are imported.
- **Runtime Capabilities & Strict Validation (`src/slokern/engine/serving/nebius.py:62-104, 190-240`):**
  Exposes `max_num_seqs`, `max_num_batched_tokens`, `temperature`, and `max_tokens`. `apply_config(candidate_config, strict=True)` rejects unsupported parameters with `ConfigurationError`.
- **Generation & SSE Streaming (`src/slokern/engine/serving/nebius.py:247-462`):**
  - Non-streaming `generate()` calls `/chat/completions` with `stream=False`.
  - Streaming `stream_generate()` parses SSE lines (`data: {...}`, `data: [DONE]`), capturing TTFT on first chunk (`latency_ms`) and ITL on subsequent chunks.
- **Secret Redaction (`src/slokern/engine/serving/nebius.py:33-60`):**
  `sanitize_secret_message()` replaces explicit API keys with `***REDACTED***`, regex masks `Bearer <token>` patterns, and regex masks `api_key=...` assignments. Redaction is enforced across all HTTP error handlers and exception handlers. The `environment_fingerprint` never contains credentials (`nebius.py:157-171`).
- **Offline Clean Skip (`tests/live/test_smoke_live.py:25-31`):**
  When `NEBIUS_API_KEY` is not set, `test_smoke_live_endpoint()` calls `pytest.skip` with:
  `"NEBIUS_API_KEY environment variable is unset. Skipping live cloud probe per ROADMAP.md Section 6.1 (BLK-04 fallback policy). Set NEBIUS_API_KEY and NEBIUS_BASE_URL to execute live preflight probe."`

### 1.4 R4: Test Suite & Contract Consistency Commands
1. **Contract Check:**
   - Command: `.\.venv\Scripts\python.exe scripts/gen_contracts.py --check`
   - Exit code: `0`
   - Output: `[OK] All 11 schemas are up to date.`
2. **Bytecode Compilation Check:**
   - Command: `.\.venv\Scripts\python.exe -m compileall -q src tests`
   - Exit code: `0` (0 compilation errors)
3. **Dependency Environment Check:**
   - Command: `.\.venv\Scripts\python.exe -m pip check`
   - Exit code: `0`
   - Output: `No broken requirements found.`
4. **Pytest Collection Check:**
   - Command: `.\.venv\Scripts\python.exe -m pytest --collect-only`
   - Exit code: `0`
   - Output: `356 tests collected in 0.81s` (0 collection errors)
5. **Targeted Test Suites Execution:**
   - Command: `.\.venv\Scripts\python.exe -m pytest tests/unit/core/search/ tests/unit/engine/serving/test_nebius.py tests/contract/ tests/unit/core/ tests/live/test_smoke_live.py -v`
   - Exit code: `0`
   - Output summary: `242 passed, 1 skipped in 2.77s`
6. **Git Status & Branch Verification:**
   - Command: `git status`
   - Current branch: `2×2-bounded-search-controller`
   - No untracked source or test files. All modifications scoped to TASK-09 and TASK-10 owned modules.

---

## 2. Logic Chain

1. **R1 Invariant Chain:**
   - From `space.py:12-15` and `36-67`, the cartesian product of $\{1024, 2048\} \times \{16, 64\}$ produces exactly 4 legal, distinct combinations.
   - `candidate_id.py:61-69` guarantees determinism and uniqueness via sorted, normalized JSON hashing.
   - `budget.py:25-27` configures `max_total_runs=6`, `max_search_runs=5`, and `max_verification_runs=1`.
   - In `budget.py:102-119`, after 5 search runs (1 baseline + 4 candidates), `can_execute_search_run()` evaluates to `False`, and any additional candidate execution raises `BudgetExhaustedError`.
   - Therefore, R1 is completely satisfied and verified by `tests/unit/core/search/test_space.py` and `test_budget.py`.

2. **R2 Orchestration & Deterministic Ranking Chain:**
   - `grid.py:179-227` executes the baseline (Run 0), followed by `grid.py:228-295` executing the 4 search candidates via `SingleRunExecutor`.
   - `rank.py:29-32` filters candidates whose verdict is not `FeasibilityVerdict.FEASIBLE`. If no candidates pass hard SLO constraints, `ranked_feasible` is empty, leading to `selected_candidate_id = None`, `selection_rationale = "No candidate among ... tested configurations satisfied all declared hard SLO constraints."`, and `stopping_reason = "space_exhausted"` (`grid.py:308-319`).
   - If feasible candidates exist, `rank.py:49-54` deterministically sorts by scalar metric (minimizing cost/latency or maximizing throughput) and breaks ties by `candidate_id`.
   - `SearchResult` schema uses `extra='forbid'` (`src/slokern/contracts/search.py:21`). `grid.py:334-335` serializes the result to `search_result.json`, which validates against `SearchResult.model_validate_json()`.
   - Therefore, R2 is completely satisfied and verified by `tests/unit/core/search/test_grid.py`.

3. **R3 Serving Adapter & Secret Safety Chain:**
   - `nebius.py:11-13` relies solely on standard library `urllib`, eliminating external network library dependencies.
   - `nebius.py:207-223` inspects candidate settings against `RuntimeCapabilities` and rejects invalid parameters under `strict=True`.
   - `nebius.py:33-60` ensures that all HTTP errors, exception payloads, and log entries pass through `sanitize_secret_message()`, which redacts both raw API keys and Bearer tokens.
   - In `tests/live/test_smoke_live.py:25-31`, missing `NEBIUS_API_KEY` triggers `pytest.skip` per BLK-04 without raising unhandled errors or leaking credentials.
   - Therefore, R3 is completely satisfied and verified by `tests/unit/engine/serving/test_nebius.py` and `tests/live/test_smoke_live.py`.

4. **R4 Test Suite & Contract Consistency Chain:**
   - `scripts/gen_contracts.py --check` confirms that the 11 schema files in `schemas/` perfectly match the Pydantic v2 contract models in `src/slokern/contracts/`.
   - Zero compilation errors (`compileall`) and zero broken dependencies (`pip check`) verify build integrity.
   - Pytest successfully collects 356 tests without collection errors.
   - The targeted test suite across search, serving, contract, core evaluator/metrics, and live probe passes 242 tests cleanly with 1 clean skip (the live Nebius probe).
   - Therefore, R4 is completely satisfied.

---

## 3. Caveats

- **BLK-04 Live Endpoint Access:** Live inference against `https://api.studio.nebius.ai/v1` is skipped during local CI/offline test runs due to the absence of `NEBIUS_API_KEY`. This behavior is the intended, documented design per `ROADMAP.md` Section 6.1 and `docs/deployment.md` Section 3.1. When an active key is exported, `test_smoke_live.py` executes all live verification assertions.
- **Unconstrained Full Test Suite Execution:** Running the full test suite (`pytest tests/`) without path constraints can trigger lengthy execution times on Windows due to multiprocessing subprocess spawning in `tests/unit/engine/loadgen/test_runner.py`. The scoped test execution executed here (`tests/unit/core/search/`, `tests/unit/engine/serving/test_nebius.py`, `tests/contract/`, `tests/unit/core/`, `tests/live/test_smoke_live.py`) targets 100% of the files and contracts affected by TASK-09 and TASK-10.
- **Role Isolation & Boundaries:** Daksh's exclusive routine surface (`tests/contract/test_verification_independence.py`) remains untouched, passing all 16 independence tests without divergence.

---

## 4. Conclusion

The 2×2 Bounded Grid Search Controller (TASK-10), Budget Limiter, and Nebius Serving Adapter (TASK-09) are **100% verified, contract-compliant, and sound**:
- Search space generates exactly 4 distinct legal candidates with canonical normalized IDs.
- Total 6-run budget invariant (5 search runs + 1 verification run) is strictly enforced with `BudgetExhaustedError`.
- Deterministic candidate ranking, zero-feasible fallback, and `search_result.json` contract persistence strictly comply with `SearchResult` (`extra='forbid'`).
- Nebius adapter uses stdlib `urllib` without unapproved dependencies, handles completions/SSE streaming, and redacts secrets on all error paths.
- All 11 schemas are up to date, 356 tests collect with 0 errors, and all 242 targeted unit and contract tests pass with zero regressions.

---

## 5. Verification Method

To independently reproduce the complete verification audit, run the following commands from the repository root:

```powershell
# 1. Verify JSON Schema synchronization (all 11 models)
.\.venv\Scripts\python.exe scripts/gen_contracts.py --check

# 2. Verify clean Python bytecode compilation
.\.venv\Scripts\python.exe -m compileall -q src tests

# 3. Verify environment dependencies
.\.venv\Scripts\python.exe -m pip check

# 4. Verify test collection across the entire repository
.\.venv\Scripts\python.exe -m pytest --collect-only

# 5. Execute targeted test suites for TASK-09 & TASK-10
.\.venv\Scripts\python.exe -m pytest tests/unit/core/search/ tests/unit/engine/serving/test_nebius.py tests/contract/ tests/unit/core/ tests/live/test_smoke_live.py -v

# 6. Check clean skip message for live probe
.\.venv\Scripts\python.exe -m pytest tests/live/test_smoke_live.py -rs

# 7. Verify Git working tree status
git status
```

**Invalidation Conditions:**
- Any modification to `src/slokern/contracts/` without regenerating `schemas/` via `scripts/gen_contracts.py`.
- Any modification to `BudgetLimiter` that allows more than 5 search runs or violates the reserved 1 verification run.
- Introducing unapproved third-party networking packages into `nebius.py`.
