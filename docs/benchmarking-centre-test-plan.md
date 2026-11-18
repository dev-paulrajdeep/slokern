# Benchmarking & Tuning Configuration Centre — Test & Acceptance Plan

> **Product:** SLOKern — *Optimize inference. Verify performance.*  
> **Subsystem:** Benchmarking, Workload Configuration & Optimization Control Centre  
> **Document Type:** Test Strategy, Matrix & Acceptance Criteria  
> **Status:** APPROVED PLANNING SPECIFICATION (Execution Mode: PLANNING ONLY)  
> **Date:** November 18, 2026  
> **Authority:** Aligned with AGENTS.md Section 10, ROADMAP.md, and DEC-0014

---

## 1. Testing Philosophy & Non-Negotiable Standards

In SLOKern, automated tests prove systems behavior, not merely line execution.
1. **Prioritize Deterministic Tests:** Unit and contract tests must execute deterministically without live cloud dependencies or unpredictable network timing.
2. **Never Claim Tests Passed Unless Actually Run:** Reports distinguish between `passed`, `failed`, `skipped`, `not run`, and `blocked by environment`.
3. **Strict Fixture Integrity:** Test against hand-calculated golden fixtures (`fixtures/metrics_golden/`).
4. **Anti-Aliasing Verification:** Automated tests must assert that verification runs generate distinct run IDs and independent raw traces.

---

## 2. Comprehensive Test Matrix

### 2.1 Configuration & Schema Tests

| Test ID | Test Target | Input Condition | Expected Behavior | Automated Test Location |
|---|---|---|---|---|
| **CFG-01** | `WorkloadSpec` valid | Correct arrival mode, positive rates, integer tokens | Successful serialization, Pydantic validation passes | `tests/contract/test_schemas.py::test_workload_spec_valid` |
| **CFG-02** | `WorkloadSpec` invalid mode | `arrival_mode = 'invalid_mode'` | ValidationError raised, rejected | `tests/contract/test_schemas.py::test_workload_spec_invalid_mode` |
| **CFG-03** | `WorkloadSpec` extra fields | Unknown field `{"unexpected_key": 123}` | Rejected with `extra='forbid'` error | `tests/contract/test_schema_roundtrip.py::test_nested_extra_field_rejected_in_experiment_spec` |
| **CFG-04** | `SLOSpec` valid | Constraints with explicit units, threshold, operator | Successful validation | `tests/contract/test_schemas.py::test_slo_spec_valid` |
| **CFG-05** | `SLOSpec` missing threshold | Threshold is `None` or missing | Pydantic ValidationError raised | `tests/contract/test_schemas.py` |
| **CFG-06** | `ExperimentBudget` limits | `max_candidates = 0`, `max_wallclock_seconds = -1` | `validate_budget()` raises `BudgetValidationError` | `tests/unit/core/search/test_budget.py::test_validate_budget_rejects_invalid_limits` |
| **CFG-07** | Parameter Type Coercion | `{"tensor_parallel_size": 1.0}` vs `1` | `generate_candidate_id()` canonicalizes to int, producing identical hash | `tests/unit/core/test_ranker.py::test_candidate_id_float_int_equivalence` |

---

### 2.2 Search Space & Budget Enforcement Tests

| Test ID | Test Target | Input Condition | Expected Behavior | Automated Test Location |
|---|---|---|---|---|
| **SRC-01** | 2×2 Matrix Dimensions | `generate_2x2_candidates()` | Exactly 4 candidates generated with expected discrete settings | `tests/unit/core/search/test_space.py::test_generate_2x2_candidates_count_and_types` |
| **SRC-02** | Candidate Hashing Order Invariance | Key ordering reversed in settings dict | Same SHA-256 candidate ID emitted | `tests/unit/core/test_ranker.py::test_generate_candidate_id_deterministic` |
| **SRC-03** | 6-Run Budget Invariant | `BudgetLimiter` progression | Exactly 5 search runs allowed; 6th run reserved for verification | `tests/unit/core/search/test_budget.py::test_budget_limiter_search_run_progression` |
| **SRC-04** | Search Space Exhaustion | All 4 grid candidates + 1 baseline evaluated | Search controller finishes with `stopping_reason = 'space_exhausted'` | `tests/unit/core/search/test_grid.py::test_grid_search_full_2x2_execution` |
| **SRC-05** | No Feasible Candidates | All 5 search runs violate hard SLOs | No candidate awarded winner status; rationale explains 0/5 passed | `tests/unit/core/search/test_grid.py::test_grid_search_zero_feasible_candidates` |
| **SRC-06** | Deterministic Tie-Breaking | Two feasible candidates with identical throughput | Lexicographically earlier `candidate_id` selected as winner | `tests/unit/core/test_ranker.py::test_rank_candidates_tie_breaking` |
| **SRC-07** | Filter Non-Finite Metrics | Candidate metric is `NaN`, `Inf`, or negative | Candidate excluded from ranking | `tests/unit/core/test_ranker_validation.py::test_rank_candidates_filters_missing_and_non_finite_metrics` |
| **SRC-08** | BLK-17 Preflight Gating | Search parameters requested on fixed Nebius endpoint | `validate_search_capabilities()` raises `SearchConfigurationError` citing BLK-17 | `tests/unit/core/search/test_grid.py::test_grid_search_halts_on_unverified_capabilities` |

---

### 2.3 Benchmark Protocol & Load Generator Tests

| Test ID | Test Target | Input Condition | Expected Behavior | Automated Test Location |
|---|---|---|---|---|
| **LOD-01** | Poisson Inter-Arrivals | Target offered rate $\lambda = 10\text{ req/s}$ | Inter-arrival times conform to exponential distribution | `tests/unit/engine/loadgen/test_arrival.py` |
| **LOD-02** | Constant Rate Cadence | Target offered rate $\lambda = 5\text{ req/s}$ | Dispatch interval equals $200\text{ ms} \pm 2\text{ ms}$ | `tests/unit/engine/loadgen/test_arrival.py` |
| **LOD-03** | Warm-Up Request Tagging | Warmup duration = 5s, measurement = 10s | Requests in first 5s tagged `is_warmup = true` in JSONL | `tests/unit/engine/loadgen/test_recorder.py` |
| **LOD-04** | Warm-Up Metrics Exclusion | JSONL trace with 10 warmup + 20 active rows | `calculate_metrics()` computes statistics strictly from the 20 active rows | `tests/unit/core/metrics/test_aggregate.py::test_calculate_metrics_warmup_strictly_excluded` |
| **LOD-05** | Client Saturation (Lag) | Injected dispatch skew $> 10\text{ ms}$ | `generator_saturated = True`, `EvidenceValidity.CONTAMINATED` | `tests/unit/core/metrics/test_validity.py::test_saturation_high_dispatch_lag` |
| **LOD-06** | Client Saturation (Rate Drop) | Delivered offered load $< 90\%$ of target rate | `generator_saturated = True`, `EvidenceValidity.CONTAMINATED` | `tests/unit/core/metrics/test_validity.py::test_saturation_rate_undersupply` |
| **LOD-07** | Error Request Handling | Adapter returns HTTP 500 / 502 | `is_valid = False`, `error_type` captured, increments `failed_request_count` | `tests/unit/core/metrics/test_aggregate.py::test_calculate_metrics_with_failed_requests_fixture` |

---

### 2.4 Metrics Engine Core Tests

| Test ID | Test Target | Input Condition | Expected Behavior | Automated Test Location |
|---|---|---|---|---|
| **MET-01** | TTFT Calculation | Valid completed streaming request | `first_token_at - sent_at` in milliseconds | `tests/unit/core/metrics/test_latency.py::test_extract_ttft_observations` |
| **MET-02** | Chunk-Gap ITL Averaging | Multi-chunk streaming completion | Per-request average of chunk intervals | `tests/unit/core/metrics/test_latency.py::test_extract_itl_observations_direct_list` |
| **MET-03** | Linear Percentiles | 11-element sorted test vector | Matches hand-calculated linear interpolation golden fixtures | `tests/unit/core/metrics/test_percentiles.py::test_percentiles_eleven_elements_golden_fixture` |
| **MET-04** | Token Throughput | Active duration 10s, total 500 output tokens | Output token throughput $= 50.0\text{ tok/s}$ | `tests/unit/core/metrics/test_throughput.py::test_calculate_throughputs_rates_and_loads` |
| **MET-05** | Error Rate Calculation | 5 failed requests out of 50 total offered | Error rate $= 0.10$ ($10\%$) | `tests/unit/core/metrics/test_throughput.py::test_calculate_throughputs_rates_and_loads` |
| **MET-06** | Golden Fixture Replay | `fixtures/metrics_golden/` traces | Derived `MetricSet` exactly matches committed JSON fixtures | `tests/contract/test_fixtures_validate.py::test_golden_fixture_percentiles_basic` |

---

### 2.5 Feasibility Evaluator Tests

| Test ID | Test Target | Input Condition | Expected Behavior | Automated Test Location |
|---|---|---|---|---|
| **EVL-01** | Hard Constraint Pass | Measured TTFT p95 $= 199.9\text{ ms} \le 200.0\text{ ms}$ | `overall_verdict = FEASIBLE`, `passed = True` | `tests/unit/core/test_evaluator.py` |
| **EVL-02** | Hard Constraint Breach | Measured TTFT p95 $= 200.1\text{ ms} > 200.0\text{ ms}$ | `overall_verdict = INFEASIBLE`, `reason_code = TTFT_P95_EXCEEDED` | `tests/unit/core/test_evaluator.py` |
| **EVL-03** | Boundary Equality | Measured TTFT p95 $= 200.0\text{ ms} \le 200.0\text{ ms}$ | `overall_verdict = FEASIBLE` (inclusive boundary) | `tests/contract/test_verification_independence.py::test_hard_slo_boundary_less_than_or_equal` |
| **EVL-04** | Missing Metric Value | Required metric `itl_ms.p95 = None` | `overall_verdict = INCONCLUSIVE`, `reason = MISSING_REQUIRED_METRIC` | `tests/contract/test_verification_independence.py::test_missing_required_metrics_inconclusive` |
| **EVL-05** | Corrupted NaN Latency | Measured TTFT p95 $= \text{float('nan')}$ | Guard catches NaN; returns `INCONCLUSIVE` (`CORRUPTED_MEASUREMENT`) | `tests/contract/test_verification_independence.py::test_nan_or_negative_metric_invalid_inconclusive` |
| **EVL-06** | Negative Latency Guard | Measured TTFT p95 $= -10.0\text{ ms}$ | Guard catches negative latency; returns `INCONCLUSIVE` | `tests/contract/test_verification_independence.py::test_nan_or_negative_metric_invalid_inconclusive` |
| **EVL-07** | Contaminated Trace Precedence | Client saturated AND latency constraint failed | `INCONCLUSIVE` takes precedence over `INFEASIBLE` | `tests/contract/test_verification_independence.py::test_inconclusive_takes_precedence_over_infeasible` |
| **EVL-08** | Sample Starvation | Valid samples $10 < \text{min\_sample\_count } 30$ | `overall_verdict = INCONCLUSIVE`, `reason = INSUFFICIENT_SAMPLES` | `tests/contract/test_verification_independence.py::test_insufficient_sample_count_inconclusive` |

---

### 2.6 Independent Verification & Anti-Aliasing Tests

| Test ID | Test Target | Input Condition | Expected Behavior | Automated Test Location |
|---|---|---|---|---|
| **VRF-01** | Distinct Verification Run ID | Execution of Run 6 | Asserts `verification_run_id != original_run_id` | `tests/contract/test_verification_independence.py::test_verification_run_id_distinct_from_search_run_id` |
| **VRF-02** | Run ID Recycling Rejection | Attempt to reuse original search run ID for verification | Raised exception; execution rejected | `tests/contract/test_verification_independence.py::test_verification_run_id_recycling_rejected` |
| **VRF-03** | Drift Tolerance Evaluation | Verification latency $+10\%$ vs original search | Passes drift check (within $+15.0\%$ tolerance) | `tests/unit/core/verification/test_compare.py::test_compare_measurement_variability_tolerated` |
| **VRF-04** | Drift Tolerance Breach | Verification latency $+16\%$ vs original search | Fails drift check; `verification_verdict = VERIFICATION_FAILED` | `tests/unit/core/verification/test_compare.py::test_compare_threshold_drift_failure` |
| **VRF-05** | Infeasible Verification Overrules Search | Search run passed, but verification run breached SLO | Overruled: `verification_verdict = VERIFICATION_FAILED` | `tests/contract/test_verification_independence.py::test_infeasible_verification_rerun_overrules_search_feasible` |
| **VRF-06** | Full Campaign End-to-End | 6-run campaign on Fake adapter | 5 search runs + 1 verification run execute; persists `verification_record.json` | `tests/unit/core/verification/test_verification_campaign.py::test_verify_search_campaign_end_to_end_success` |

---

### 2.7 Frontend UI & Command Centre Tests

| Test ID | Test Target | Input Condition | Expected Behavior | Automated Test Location |
|---|---|---|---|---|
| **UI-01** | Workload Preset Properties | Click `quick` vs `standard` preset | Updates target rate, duration, and concurrency correctly | `frontend/test/campaignDrawer.test.ts::verifies workload preset definitions` |
| **UI-02** | Dual-Mode Target Selection | Select `local` vs `fake` target | Updates default model string and TTFT threshold ceiling | `frontend/test/campaignDrawer.test.ts::verifies dual-mode configuration targets` |
| **UI-03** | 6-Run Timeline Reducer | SSE events `candidate_started`, `candidate_completed` | Accurately updates active progress, completed reqs, and verdicts | `frontend/test/campaignDrawer.test.ts::verifies full SSE stream lifecycle updates` |
| **UI-04** | All Infeasible Candidates | All 5 search runs fail SLO | Reducer transitions to completed with no winner selected | `frontend/test/campaignDrawer.test.ts::verifies timeline transition when all candidates are infeasible` |
| **UI-05** | Anti-Aliasing UI Guard | Search run ID == Verification run ID passed to diagram | Flags security breach / anti-cheating violation | `frontend/test/status.test.ts::Test 4: Equal search and verification run IDs rejected` |
| **UI-06** | Drift Tolerance Formatting | Latency drift $+12.4\%$ vs $+18.2\%$ | Formats within tolerance pill vs out-of-tolerance danger pill | `frontend/test/status.test.ts::Test 6: Drift exceeds declared tolerance rejected` |
| **UI-07** | Pareto Frontier Identification | Array of 4 evaluated candidates | Accurately identifies non-dominated empirical frontier points | `frontend/test/status.test.ts::Test 10: Pareto frontier identifies non-dominated empirical configurations` |
| **UI-08** | Keyboard Shortcuts Disabling | Focus on `<input>` or modifier key active | Keyboard shortcuts HUD / switching disabled | `frontend/test/decisionIntegrity.test.ts::verifies keyboard shortcuts suppress single-key actions` |
| **UI-09** | Diagnostic Error Boundary | Child component throws render exception | Catches error; displays clinical `EXECUTION_RENDER_ERROR` | `frontend/src/components/common/ErrorBoundary.tsx` |

---

### 2.8 Live vLLM Serving & Integration Tests

| Test ID | Test Target | Input Condition | Expected Behavior | Automated Test Location |
|---|---|---|---|---|
| **VLM-01** | vLLM Preflight Discovery | `GET http://localhost:8000/health` & `/v1/models` | HTTP 200, model `slokern-qwen3-1.7b` discovered with context $\ge 4096$ | `tests/unit/engine/serving/test_vllm.py::test_vllm_preflight_discovery` |
| **VLM-02** | vLLM Non-Streaming Completion | POST `/v1/chat/completions` with `stream=False` | Returns complete JSON response with prompt and completion token counts | `tests/unit/engine/serving/test_vllm.py::test_vllm_non_streaming_completion` |
| **VLM-03** | Monotonic TTFT Extraction | Streaming SSE chunks arrival | TTFT extracted from first non-empty content chunk; zero negative latencies | `tests/unit/engine/serving/test_vllm.py::test_vllm_streaming_ttft_extraction` |
| **VLM-04** | Inter-Chunk ITL Extraction | Sequence of streaming token chunks | Computes chunk arrival deltas; verifies mean ITL calculation | `tests/unit/engine/serving/test_vllm.py::test_vllm_streaming_itl_extraction` |
| **VLM-05** | Reasoning Token Accounting | Prompt triggers `<think>` block in Qwen3 | Reasoning tokens counted towards decoded output token count | `tests/unit/engine/serving/test_vllm.py::test_vllm_reasoning_tokens_counted` |
| **VLM-06** | Prometheus Scraper Parsing | Scrape `http://localhost:8000/metrics` | Successfully extracts `vllm:time_to_first_token_seconds`, active requests gauge | `tests/unit/engine/serving/test_vllm.py::test_vllm_prometheus_metrics_scraping` |
| **VLM-07** | Client vs Server TTFT Cross-Check | 10 sequential live requests on local vLLM | Client TTFT matches server histogram bucket within $\pm 25\text{ ms}$ | `tests/integration/test_vllm_live.py::test_vllm_live_ttft_cross_check` |
| **VLM-08** | Concurrency Contention (1 vs 2) | Run 2 concurrent requests on `--max-num-seqs 2` | Both requests complete without OOM or scheduler queue abort | `tests/integration/test_vllm_live.py::test_vllm_live_concurrency_envelope` |

---

## 3. Preflight & Live Environment Acceptance Matrix

| Check ID | Verification Gate | Execution Command | Required Pass Outcome | Blocking Dependency |
|---|---|---|---|---|
| **GAT-01** | Python Contract Schemas | `python -m pytest tests/contract/ -q` | 156/156 passed in $< 3.0\text{s}$ | None |
| **GAT-02** | Core Optimization Engines | `python -m pytest tests/unit/core/ -q` | 157/157 passed in $< 7.0\text{s}$ | None |
| **GAT-03** | Serving & API Unit Suites | `python -m pytest tests/unit/engine/serving/ tests/unit/api/test_app.py -q` | 127/127 passed in $< 5.0\text{s}$ | None |
| **GAT-04** | Frontend Contract & Model Suite | `npm test --prefix frontend` | 28/28 passed in $< 0.5\text{s}$ | None |
| **GAT-05** | Frontend Diagrams & Invariants | `cd frontend; node --experimental-strip-types --test test/diagrams.test.ts` | 18/18 passed in $< 0.5\text{s}$ | None |
| **GAT-06** | Local Ollama Preflight | Single request probe to `http://127.0.0.1:11434/api/tags` | HTTP 200, model `qwen3:4b-instruct-2507-q4_K_M` confirmed | Local Ollama service |
| **GAT-07** | Nebius Token Factory Probe | Single request probe to `https://api.tokenfactory.nebius.com/v1/models` | HTTP 200, `Nemotron-3-Nano-30B-A3B` confirmed in catalog | `NEBIUS_API_KEY` |
| **GAT-08** | Offline Campaign E2E | `slokern optimize --adapter fake --verify` | 6 runs complete; emits `report.md` labeled `DEMO DATA` | None |
| **GAT-09** | Local vLLM Live Preflight | `python -c "import urllib.request; resp=urllib.request.urlopen('http://localhost:8000/health'); print(resp.getcode())"` | HTTP 200 OK returned from local vLLM on RTX 5060 | Local vLLM service (`:8000`) |
| **GAT-10** | Local vLLM Stage 0-2 Ladder | Execution of Stage 0, 1, 2 from `docs/local-benchmark-protocol.md` | 10 live requests complete, TTFT client-Prometheus reconciled within 25ms | Local vLLM service (`:8000`) |

---

## 4. Final Definition of Done (DoD)

The Configuration Centre is accepted as **Final-Test Ready** if and only if:
1. **Zero Disconnected Forms:** Every form field in `WorkloadsView.tsx` serializes into a canonical `WorkloadSpec` or `SLOSpec` sent to backend execution.
2. **Zero Catch-Block Fabrications:** Catch blocks in `frontend/src/App.tsx` display real network/API error messages; no synthetic success strings exist.
3. **Transparent BLK-17 Disclosures:** The UI disables unavailable optimizer knobs for Nebius Token Factory and Local Ollama, explaining why process startup flags are gated.
4. **Observable 6-Run Budget:** The campaign runner strictly enforces 5 search runs + 1 verification run with live SSE progress bars and request counts.
5. **Authentic Independent Verification:** Verification runs under a fresh `verification_run_id` with separate JSONL traces and explicit drift deltas.
6. **Clean Test Suite:** All unit, contract, and frontend test suites pass 100% with zero regressions.
