# Original User Request

## 2026-10-22T08:10:29Z

This is a single self-contained fix; keep it small and focused. Implement the subprocess-isolated load generator (`SUB-06`, TASK-06) for SLOKern to produce open-loop traffic arrivals, execute requests in an isolated subprocess avoiding GIL/GC noise, stream microsecond traces to JSONL adhering to `RawRequestMeasurement`, and detect client-side scheduler saturation.

Working directory: /home/caelum/DevArena/projects/slokern
Integrity mode: development

## Requirements

### R1. Arrival Schedule Generation
- Implement `ArrivalSchedule` in `src/slokern/engine/loadgen/arrival.py` supporting `ArrivalMode.CONSTANT` ($\Delta t = 1/\lambda$) and `ArrivalMode.POISSON` ($\Delta t \sim \text{Exp}(\lambda)$) with reproducible PRNG seeding.
- Yield timestamped slots across warmup and active measurement durations with accurate `is_warmup` partition flags.
- Export public interfaces cleanly from `src/slokern/engine/loadgen/__init__.py`.

### R2. Crash-Resilient JSONL Measurement Recorder
- Implement `JSONLRecorder` in `src/slokern/engine/loadgen/recorder.py` streaming unaggregated request-level microsecond events directly to `.jsonl` files.
- Strictly validate each event against the Pydantic v2 `RawRequestMeasurement` schema and flush to disk after every write.
- Track running counters and dispatch delay statistics across active and warmup requests.

### R3. Subprocess-Isolated Dispatch Runner
- Implement `LoadGeneratorRunner` in `src/slokern/engine/loadgen/runner.py` executing the dispatch loop inside an isolated Python process spawned via `multiprocessing.get_context("spawn")`.
- Implement asynchronous dispatch respecting `concurrency_limit` and microsecond timing.
- Capture microsecond timestamps (`scheduled_at`, `sent_at`, `first_token_at`, `completed_at`) and verify strict timestamp monotonicity: `scheduled_at <= sent_at <= first_token_at <= completed_at`.
- Support streaming (`astream_generate`) for TTFT/ITL recording as well as standard generation against `BaseServingAdapter` / `FakeServingAdapter`.

### R4. Client Scheduler & Queue Saturation Monitoring
- Calculate `offered_load_rps`, `achieved_load_rps`, `mean_dispatch_lag_ms`, and `max_dispatch_lag_ms`.
- Flag `generator_saturated = True` whenever `mean_dispatch_skew_ms > 10.0` or `offered_load_rps < 0.90 * target_offered_rate`.

## Verification Resources & Infrastructure
- Virtual Environment: `.venv/bin/pytest`
- Serving Adapter Fixtures: `src/slokern/engine/serving/fake.py` (`FakeServingAdapter`)
- Contracts: `src/slokern/contracts/measurements.py` (`RawRequestMeasurement`) and `src/slokern/contracts/workload.py` (`WorkloadSpec`, `ArrivalMode`)

## Acceptance Criteria

### Automated Test Suite
- [ ] Unit tests in `tests/unit/engine/loadgen/test_arrival.py` pass with 100% success (covering constant/Poisson arrival rates, seed reproducibility, warmup tagging).
- [ ] Unit tests in `tests/unit/engine/loadgen/test_recorder.py` pass with 100% success (covering schema validation, immediate disk flushing, file persistence, running stats).
- [ ] Unit tests in `tests/unit/engine/loadgen/test_runner.py` pass with 100% success (covering subprocess dispatch against `FakeServingAdapter`, concurrency limits, and error handling).
- [ ] Full project test suite (`.venv/bin/pytest tests/`) passes with zero regressions.

### Trace & Saturation Validation
- [ ] All records in the generated `.jsonl` trace strictly validate against `RawRequestMeasurement.model_validate_json()`.
- [ ] Monotonicity invariant holds across all recorded measurements: `scheduled_at <= sent_at <= first_token_at <= completed_at`.
- [ ] Saturation condition (`generator_saturated = True`) triggers as expected when artificial dispatch latency is injected.


## 2026-10-22T21:58:19Z

Conduct a comprehensive, independent end-to-end audit and verification of SLOKern's 2×2 Bounded Grid Search Controller (TASK-10), Budget Limiter, and Nebius Serving Adapter (TASK-09), asserting contract validity, strict 6-run budget invariant enforcement, deterministic candidate ranking, secret redaction, and full regression test suite integrity.

Working directory: `c:\Users\paulr\OneDrive\DevArena\slokern`  
Integrity mode: development

## Requirements

### R1. Audit 2×2 Search Space & Budget Limiter (`SUB-04` / `SUB-08`)
- Verify that `src/slokern/core/search/space.py` generates exactly 4 legal, distinct candidates across the declared 2×2 matrix (`max_num_batched_tokens` $\in \{1024, 2048\}$ × `max_num_seqs` $\in \{16, 64\}$) with canonical normalized candidate IDs.
- Verify that `src/slokern/core/search/budget.py` strictly enforces the 6-run total budget invariant: 1 baseline run + 4 search candidate runs = 5 runs executed during search, strictly reserving 1 run for independent verification (`TASK-11`). Reject any attempt to exceed 5 search runs with `BudgetExhaustedError`.

### R2. Audit Grid Search Controller & Deterministic Ranking (`SUB-04`)
- Verify that `src/slokern/core/search/grid.py` orchestrates baseline execution (Run 0), generates candidates, executes each candidate via `SingleRunExecutor`, collects results, and filters non-feasible candidates (`verdict != FEASIBLE`).
- Verify ranking deterministically selects the winning candidate according to the declared `ranking_objective` (Mode B proxy or Mode A cost), breaking ties deterministically by candidate ID.
- Verify `SearchResult` artifact persistence (`artifacts/experiments/<experiment_id>/search_result.json`) strictly validates against the canonical Pydantic schema in `src/slokern/contracts/search.py`.
- Verify graceful zero-feasible handling: emits `selected_candidate_id = None` and `stopping_reason = 'space_exhausted'`.

### R3. Audit Nebius Serving Adapter & Preflight Probe (`SUB-05`)
- Verify that `src/slokern/engine/serving/nebius.py` implements the OpenAI-compatible vLLM serving adapter using standard library `urllib` without introducing unapproved dependencies.
- Verify secret masking: all errors, logs, and exception strings redact `NEBIUS_API_KEY` and bearer tokens (`docs/deployment.md` Section 4).
- Verify that `tests/live/test_smoke_live.py` executes against live Nebius endpoint if `NEBIUS_API_KEY` is present, or skips cleanly with an actionable message if unset (`BLK-04` offline limitation).

### R4. Test Suite Execution & Contract Consistency
- Verify that all unit and contract tests in `tests/unit/core/search/`, `tests/unit/engine/serving/test_nebius.py`, `tests/contract/`, and `tests/unit/core/` pass cleanly.
- Verify that `python scripts/gen_contracts.py --check` reports `[OK] All 11 schemas are up to date.`
- Verify that `python -m compileall -q src tests` and `python -m pip check` report zero errors.

## Acceptance Criteria

### Budget & Space Integrity
- [ ] `generate_2x2_candidates()` produces exactly 4 unique `CandidateConfig` objects with valid `candidate_id`s matching `generate_candidate_id()`.
- [ ] `BudgetLimiter.can_execute_search_run()` returns `False` after 5 runs (1 baseline + 4 candidates); `record_search_run()` raises `BudgetExhaustedError` on run 6.

### Search Controller & Ranking Integrity
- [ ] `GridSearchController.run_search()` completes 5 runs using `FakeServingAdapter` and writes valid `search_result.json`.
- [ ] Feasible candidate with best objective metric is selected as winner; infeasible candidates are never selected.
- [ ] Emitted `SearchResult` validates 100% against `slokern.contracts.search.SearchResult` with `extra='forbid'`.

### Serving & Security Integrity
- [ ] `NebiusServingAdapter` accurately validates capabilities, handles completions and SSE token streams, and redacts secrets on HTTP errors.
- [ ] `test_smoke_live.py` skips cleanly without error when `NEBIUS_API_KEY` is unset.

### Regression & Build Integrity
- [ ] All 356 tests collected by pytest with 0 collection errors.
- [ ] All non-live deterministic tests pass with 0 failures.
- [ ] `python scripts/gen_contracts.py --check` passes with exit code 0.
- [ ] Working tree status clean on git branch `2×2-bounded-search-controller`.
