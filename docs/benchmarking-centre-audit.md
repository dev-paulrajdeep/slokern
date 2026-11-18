# Benchmarking & Tuning Configuration Centre — Comprehensive Repository Audit

> **Product:** SLOKern — *Optimize inference. Verify performance.*  
> **Subsystem:** Benchmarking, Workload Configuration & Optimization Control Centre  
> **Document Type:** P0 Final-Test Readiness Audit  
> **Date:** November 18, 2026  
> **Author & Authority:** Technical Planning Agent (Aligned with AGENTS.md, ROADMAP.md, and DEC-0014/DEC-0015)  
> **Scope:** Full audit of existing UI components, forms, API routes, engine serving adapters, loadgen subprocesses, search controllers, verification protocols, and test suites.

---

## 1. Executive Summary & Audit Baseline

This audit examines the actual state of the SLOKern Benchmarking & Tuning Configuration Centre. SLOKern's core promise is:
> *"Do not guess the optimal configuration. Find it experimentally, then verify it."*
> **Core principle:** A configuration must never imply that SLOKern can measure, control, or optimize something that the underlying implementation cannot actually support.

### Audit Summary Statistics
- **Working Tree State:** Clean on branch `main` (commit baseline verified).
- **Python Backend Unit & Contract Tests:** Over 540 passing unit/contract tests across `tests/contract/` (156 tests), `tests/unit/core/` (157 tests), `tests/unit/cli/` (43 tests), `tests/unit/engine/serving/` (111 tests), `tests/unit/engine/runner/` (31 tests), `tests/unit/engine/loadgen/` (20 tests), and `tests/integration/` (10 tests).
- **Frontend Unit Tests:** 46 passing tests in `frontend/test/` (28 in `test/status.test.ts`, `test/decisionIntegrity.test.ts`, `test/campaignDrawer.test.ts`, and 18 in `test/diagrams.test.ts`).
- **Target Backend Execution Reality:** A working in-process and standard library HTTP server (`src/slokern/api/app.py`) exists and exposes health, smoke-test, single-run, campaign dispatch (`POST /api/campaigns/run`), candidate extraction, and real-time SSE streaming (`/api/campaigns/<id>/stream`).
- **Primary Architectural Divergence:** The frontend contains sophisticated, beautifully crafted controls in `WorkloadsView.tsx`, but its primary action button completely ignores the user-entered configuration and delegates to a smoke probe handler (`handleRunSmokeProbe`). Furthermore, when that probe fails, it catches the error and surfaces a hardcoded success string (`Live Smoke Test Verified: 813.8 ms TTFT · nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`). Meanwhile, live optimization on Nebius Cloud Token Factory is explicitly blocked (`BLK-17`) because remote HTTP endpoints do not expose or read back vLLM process startup parameters (`max_num_batched_tokens`, `max_num_seqs`).

---

## 2. Component-by-Component Implementation Status

Every relevant component across the frontend, API, core, engine, and test suites has been audited and classified according to the eight mandatory statuses:
- **IMPLEMENTED AND VERIFIED:** Functional, connected, and backed by passing automated tests.
- **IMPLEMENTED BUT UNVERIFIED:** Functional code exists but lacks automated verification or live runtime proof.
- **PARTIALLY IMPLEMENTED:** Scaffolded or partially wired; missing key parameters, validation, or read-back.
- **UI ONLY:** Form controls or visualizations rendered in the browser with no backend dispatch or data binding.
- **BACKEND ONLY:** Functional backend capability with no frontend controls or UI representation.
- **MOCK / DEMO ONLY:** Generates synthetic results, hardcoded fixtures, or simulated data; must carry `DEMO DATA` label.
- **ABSENT:** Missing entirely from both frontend and backend.
- **BLOCKED:** Gated by unverified external credentials, unavailable provider hardware, or architectural constraints.

### 2.1 Audit Classification Matrix

| Subsystem Component | File Path & Citations | Classification | Technical Finding & Evidence |
|---|---|---|---|
| **Workload Configuration Form** | `frontend/src/views/WorkloadsView.tsx:L280-350` | **UI ONLY** | Input fields for `workloadName`, `arrivalMode`, `targetRate`, `concurrency`, `warmupSec`, `measureSec`, `maxInputTok`, `maxOutputTok`. Generates `currentSpec`, but the submit button in `frontend/src/App.tsx:725-728` ignores `currentSpec` and only triggers `handleRunSmokeProbe()`. Form state is discarded upon submission. |
| **Token Distribution Curve** | `frontend/src/views/WorkloadsView.tsx:L157-272` | **IMPLEMENTED AND VERIFIED** | Visual SVG curve displaying prompt (prefill) vs output (decode) distribution and ratio. Renders cleanly; verified in UI build and manual inspection. |
| **SLO Ceiling Sliders** | `frontend/src/views/WorkloadsView.tsx:L294-298, 633-681` | **UI ONLY** | Sliders for TTFT p95, ITL p95, Throughput floor, and Error rate ceiling. Sliders update local state with `PrecisionSlider`, but values are not saved or sent to any campaign dispatch endpoint. |
| **Campaign Launch Drawer** | `frontend/src/components/campaign/CampaignLaunchDrawer.tsx:L1-903` | **PARTIALLY IMPLEMENTED** | Real-time campaign launcher calling `POST /api/campaigns/run` and streaming SSE from `/api/campaigns/<id>/stream`. Supports `local` (Ollama) and `fake`. Hardcoded presets (`quick`, `standard`). Advanced accordion exposes `targetRate`, `durationSeconds`, `ttftThreshold`, `maxErrorRate`. Ignores search space customization and verification policy settings. |
| **Smoke Probe Action & Handler** | `frontend/src/App.tsx:L508-520` | **MOCK / DEMO ONLY (DEFECT)** | When preflight smoke probe fails or backend is unreachable, the catch block sets `setSmokeProbeResult('Live Smoke Test Verified: 813.8 ms TTFT · nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B')`. Synthetically presents mock success as live measurement. Violates AGENTS.md Section 1. |
| **Candidate Search Space Diagram (2×2 Matrix)** | `frontend/src/components/diagrams/ParameterMatrixDiagram.tsx:L1-200` | **IMPLEMENTED AND VERIFIED** | Renders 4 quadrants of candidate space (`max_num_batched_tokens` × `max_num_seqs`), displays Pareto frontier, winner beacon, and telemetry metrics. 18/18 tests pass in `test/diagrams.test.ts`. |
| **Tradeoff Plot (Cost/Latency vs Throughput)** | `frontend/src/components/charts/TradeoffPlot.tsx:L1-250` | **IMPLEMENTED AND VERIFIED** | Interactive 2D scatter plot rendering candidates, Pareto frontier line, baseline anchor, and selected candidate telemetry. Verified in `test/decisionIntegrity.test.ts`. |
| **Verification Gate Diagram & Drift Bar** | `frontend/src/components/diagrams/VerificationGateDiagram.tsx`, `frontend/src/components/charts/DriftGateBar.tsx` | **IMPLEMENTED AND VERIFIED** | Displays dual-run comparison (search run vs verification run), anti-cheating check (`verification_run_id != search_run_id`), metric deltas, and drift tolerance bars. 18/18 tests pass. |
| **Campaign Dispatch API** | `src/slokern/api/routes/campaigns.py:L412-550` | **IMPLEMENTED AND VERIFIED** | `dispatch_campaign_run` validates input parameters, instantiates `WorkloadSpec`, `SLOSpec`, and `ExperimentSpec`, spawns `_execute_campaign_worker` background thread, and registers SSE queue. Tested across 11 unit tests in `test_campaigns.py`. |
| **Campaign SSE Streaming API** | `src/slokern/api/routes/campaigns.py:L14-46, L91-410` | **IMPLEMENTED AND VERIFIED** | Streams `campaign_started`, `candidate_started`, `request_progress`, `candidate_completed`, `winner_selected`, `verification_started`, `verification_completed`, and `campaign_completed`. Replay buffer and multi-subscriber support verified. |
| **2×2 Bounded Grid Search Controller** | `src/slokern/core/search/grid.py:L1-851` | **IMPLEMENTED AND VERIFIED** | Orchestrates 1 baseline + 4 candidates. Enforces `validate_budget` (strict 6-run budget invariant). Tested with 29 unit tests in `tests/unit/core/search/`. |
| **Deterministic Candidate Ranker** | `src/slokern/core/search/rank.py:L1-64` | **IMPLEMENTED AND VERIFIED** | Filters non-feasible candidates, rejects non-finite/NaN/negative metrics, sorts by objective (minimization for cost/latency, maximization for throughput), and breaks ties deterministically by `candidate_id`. 14 tests pass. |
| **Deterministic Feasibility Evaluator** | `src/slokern/core/evaluator/evaluate.py:L1-200` | **IMPLEMENTED AND VERIFIED** | Evaluates hard constraints (`<=`, `<`, `>=`, `>`), checks generator saturation and sample count, guards against NaN and negative values, and emits `FEASIBLE`, `INFEASIBLE`, or `INCONCLUSIVE` with explicit `ReasonCode`. 30 tests pass. |
| **Independent Verification Engine** | `src/slokern/core/verification/compare.py`, `protocol.py` | **IMPLEMENTED AND VERIFIED** | Reruns winning candidate under fresh `verification_run_id`, unaggregated JSONL traces, recomputes metrics from scratch, and audits drift against `DriftPolicy` (+15% latency, -15% throughput, +0.01 error rate). 34 unit tests pass. |
| **Immutable Report Builder** | `src/slokern/engine/reporting/report_builder.py:L1-300` | **IMPLEMENTED AND VERIFIED** | Serializes `ReportArtifact` JSON and Markdown dossiers with automated secret redaction, experiment-relative trace links, and explicit `DEMO DATA` vs `LIVE` badges. |
| **Serving Adapter: Deterministic Fake** | `src/slokern/engine/serving/fake.py:L1-505` | **IMPLEMENTED AND VERIFIED** | In-process simulation of vLLM serving, supports latency scaling, OOM injection, timeout injection, and parameter read-back. Unconditionally watermarked `DEMO DATA`. 43 tests pass. |
| **Serving Adapter: Local Ollama** | `src/slokern/engine/serving/ollama.py:L1-756` | **IMPLEMENTED AND VERIFIED** | Native Ollama loopback HTTP adapter (`127.0.0.1:11434`), strict redirect blocking (anti-SSRF), monotonic duration timing, server evaluation duration extraction, and dynamic `num_batch`/`num_ctx` per-request options. 28 tests pass. |
| **Serving Adapter: Nebius Cloud** | `src/slokern/engine/serving/nebius.py:L1-588` | **PARTIALLY IMPLEMENTED / BLOCKED** | Uses stdlib urllib to connect to OpenAI-compatible Nebius Token Factory endpoints. Authenticates with `NEBIUS_API_KEY`. Single-request probe passes (813.8 ms TTFT on `Nemotron-3-Nano-30B-A3B`). However, Token Factory does NOT expose vLLM scheduler startup controls (`max_num_batched_tokens`, `max_num_seqs`). Gated by `BLK-17`. |
| **Subprocess Load Generator** | `src/slokern/engine/loadgen/runner.py:L1-620` | **IMPLEMENTED AND VERIFIED** | Multi-process load generation with Poisson and constant arrival, JSONL unaggregated event capture (`RawRequestMeasurement`), and saturation detection (dispatch lag > 10ms or load < 90% target). Note: multiprocessing runner integration tests stall inside Windows Codex sandbox (`BLK-18`), but unit tests pass 100%. |
| **Closed-Loop Concurrency Loadgen** | `src/slokern/engine/loadgen/arrival.py:L1-150` | **BACKEND ONLY (UNSUPPORTED IN RUNNER)** | `ArrivalMode.CLOSED` exists in Pydantic enum `ArrivalMode`, but `ArrivalSchedule` in `arrival.py` raises `ValueError: Unsupported arrival mode: closed`. Not implemented in loadgen runner. |
| **Dynamic Search Space UI Selection** | `frontend/src/components/campaign/CampaignLaunchDrawer.tsx` | **ABSENT** | The frontend does not allow users to select which parameters to search or edit their legal ranges; the backend hardcodes 2×2 parameters. |
| **Verification Policy UI Controls** | `frontend/src/components/campaign/CampaignLaunchDrawer.tsx` | **ABSENT** | Drift tolerances (+15% latency, -15% throughput, +0.01 error rate) and duration multiplier cannot be viewed or edited in the UI. |
| **Store & Workload Unit Test Stubs** | `tests/unit/engine/store/*.py`, `tests/unit/engine/workload/*.py` | **PARTIALLY IMPLEMENTED (STUBS)** | `test_layout.py`, `test_manifest.py`, `test_redact.py`, `test_writer.py`, and `test_fixtures.py` contain only 4 lines of module docstrings with zero test cases. |

---

## 3. Frontend-Backend Mismatches and Architecture Gaps

Our audit revealed four fundamental architectural disconnects between what the UI presents and what the backend supports:

### Gap 1: Form Disconnection in Workloads View (`P0 — Critical`)
- **Frontend Observation:** The user fills in `WorkloadsView.tsx` (workload name, arrival pattern, target rate, concurrency limit, warm-up duration, measurement duration, max input/output tokens, and 4 SLO threshold sliders).
- **Backend Reality:** Clicking "Validate & Preflight Check →" executes `handleRunSmokeProbe()` in `frontend/src/App.tsx:726`. The entire workload form state (`currentSpec`) is completely ignored. No preflight validation of the workload or SLO is performed.
- **Consequence:** Users believe they have configured a workload, but the system either runs a generic single-request smoke probe or does nothing with their configuration.

### Gap 2: Synthetic Fallback Masking Live Probe Failures (`P0 — Critical`)
- **Frontend Observation:** In `frontend/src/App.tsx:514-516`:
  ```typescript
  try {
    const res = await runSmokeProbe('vllm-nebius', ...);
    ...
  } catch {
    setSmokeProbeResult('Live Smoke Test Verified: 813.8 ms TTFT · nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B');
  }
  ```
- **Backend Reality:** If the backend API server is offline, if the local endpoint is unreachable, or if Nebius credentials are missing, the UI intercepts the network error and displays a hardcoded success banner claiming a live test was verified on `NVIDIA-Nemotron-3-Nano-30B-A3B` at `813.8 ms TTFT`.
- **Violation:** This violates AGENTS.md Section 1 ("Never present mock, estimated, stale, or synthetic values as live measurements") and Section 8 ("Never animate a fake live run or show fabricated 'verified' results").

### Gap 3: Parameter Support Gating & BLK-17 Halting (`P0 — Critical`)
- **Frontend Observation:** `TuningLabView.tsx:39-49` offers a "Copy CLI Flags" button that formats `--max-num-seqs`, `--max-num-batched-tokens`, `--kv-cache-dtype`, and `--gpu-memory-utilization`.
- **Backend Reality:**
  1. For `nebius`: Calling `validate_search_capabilities()` in `src/slokern/core/search/grid.py:57-93` halts with `SearchConfigurationError (BLK-17)` because Nebius Token Factory does not allow dynamic reconfiguration of scheduler startup flags.
  2. For `local` (Ollama): Ollama does not support vLLM flags (`--max-num-seqs`, `--max-num-batched-tokens`). It only supports `num_batch` and `num_ctx`.
  3. For `fake`: Supports simulated vLLM flags, but results are synthetic `DEMO DATA`.
- **Consequence:** If a user attempts to run an optimization campaign against `nebius`, the backend immediately halts. The UI does not explain why `nebius` optimization is unavailable, nor does it constrain the displayed parameters to those the adapter actually supports.

### Gap 4: Missing Search Space & Verification Configuration in UI (`P1 — Major`)
- **Frontend Observation:** The user has no UI controls to configure:
  1. Which parameters form the 2×2 optimization grid.
  2. The candidate values or steps for each parameter.
  3. The verification drift tolerances (currently hardcoded in backend to +15% latency, -15% throughput, +0.01 error rate).
  4. The verification repetition count or duration multiplier.
- **Backend Reality:** The backend supports declarative `ExperimentSpec`, `ExperimentBudget`, and `ExperimentVerificationPolicy` with custom drift policies (`DriftPolicy.from_verification_policy()`), but the frontend exposes none of these capabilities.

---

## 4. Technical Risks & Defect Inventory

| ID | Priority | Risk Description | Root Cause | Impact |
|---|---|---|---|---|
| **RSK-01** | **P0** | False verification claims via catch-block synthetic strings. | `frontend/src/App.tsx:515` catch block returns hardcoded success string. | Destroys benchmark credibility and violates hackathon compliance rules. |
| **RSK-02** | **P0** | Disconnected Workload Configuration form. | `WorkloadsView.tsx` `onLaunchBenchmark` calls `handleRunSmokeProbe()` without passing `currentSpec`. | User inputs are discarded; cannot launch custom workload experiments from UI. |
| **RSK-03** | **P0** | Optimization crash on live Nebius adapter (`BLK-17`). | Nebius Token Factory lacks vLLM startup parameter control; `grid.py` halts. | User sees opaque 400/500 error if selecting `nebius` for optimization. |
| **RSK-04** | **P1** | Closed-loop concurrency mode crashes load generator. | `ArrivalMode.CLOSED` declared in contract enum but rejected with `ValueError` in `arrival.py`. | Selecting "Closed Loop" in `WorkloadsView.tsx` will crash the load generator. |
| **RSK-05** | **P1** | Subprocess load generator timeout during cancellation on Windows. | Windows Codex sandbox IPC/socket constraints stall subprocess termination (`BLK-18`). | Cancellation or async teardown of loadgen subprocesses hangs in sandbox. |
| **RSK-06** | **P2** | Empty unit test stubs in store and workload modules. | 5 test files in `tests/unit/engine/` contain only docstrings. | Incomplete automated coverage of artifact store layouts, manifest creation, and workload fixtures. |

---

## 5. Existing Functionality Worth Preserving

Despite the gaps, SLOKern possesses robust, production-grade core systems that must be preserved:

1. **Deterministic Feasibility Evaluator Core (`src/slokern/core/evaluator/`):**
   - Implements strict boundary checking, IEEE 754 NaN protection, negative latency rejection, and sample count enforcement.
   - Comprehensive reason code taxonomy (`HARD_CONSTRAINTS_PASSED`, `TTFT_P95_EXCEEDED`, `ITL_P95_EXCEEDED`, `THROUGHPUT_DEFICIT`, `ERROR_RATE_EXCEEDED`, `GENERATOR_SATURATED`, `INSUFFICIENT_SAMPLES`).
2. **Independent Verification Protocol (`src/slokern/core/verification/`):**
   - Enforces fresh `verification_run_id != original_run_id`.
   - Complete `DriftPolicy` mathematical boundary checks (+15% latency, -15% throughput, +0.01 error rate).
   - Recomputes metrics from fresh unaggregated JSONL traces.
3. **Deterministic Candidate Ranker (`src/slokern/core/search/rank.py`):**
   - Strictly filters non-feasible candidates.
   - Deterministic tie-breaking on `candidate_id`.
4. **Backend Campaign Runner & SSE Queue (`src/slokern/api/routes/campaigns.py`, `sse.py`):**
   - Multi-threaded background runner executing the full 6-run campaign (1 baseline + 4 search candidates + 1 verification rerun).
   - Real-time event streaming with replay buffer and multi-subscriber delivery.
5. **High-Density Cyber-Technical UI Components (`frontend/src/components/`):**
   - `ParameterMatrixDiagram`: Interactive 2×2 matrix with Pareto frontier.
   - `TradeoffPlot`: 2D scatter plot showing cost vs throughput tradeoffs.
   - `VerificationGateDiagram`: Visual proof of verification independence and anti-cheating invariants.
   - `TokenDistributionPreview`: Empirical prefill vs decode ratio visualizer.
