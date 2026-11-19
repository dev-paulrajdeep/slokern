# Research Paper Outline

# SLOKern: Evidence-Driven, SLO-Aware Optimization and Independent Verification of LLM Inference Serving Configurations

> **Working Title:** *SLOKern: Evidence-Driven, SLO-Aware Optimization and Independent Verification of LLM Inference Serving Configurations*  
> **Document ID:** `DOC-M5-RESEARCH-PAPER-OUTLINE`  
> **Milestone:** Milestone M5 — Master Deliverables Synthesis  
> **Author:** Worker M5 (Release Synthesis Lead & Research Author)  
> **Target Venue:** Systems for Machine Learning (MLSys, OSDI, EuroSys, or ACM SIGMETRICS)  
> **Target Audience:** Systems researchers, LLM serving engineers, and cloud infrastructure architects  
> **Authoritative Experimental Evidence:** Campaign `cmp-8a020d00` (NVIDIA GeForce RTX 5060 Laptop GPU, 8,151 MiB GDDR7)  
> **Standards Compliance:** AGENTS.md (§ 1, 4, 5, 7, 10, 13, 14, 15), Epistemic Discipline Rules  
> **Date:** 2026-11-19  

---

## 1. Abstract

### Scope Statement
Provides an executive condensation of the research problem, system paradigm, empirical results, and verification findings. Summarizes how modern LLM inference systems suffer from heuristic over-provisioning and explains SLOKern's core principle: replacing theoretical guesswork with bounded empirical search and independent verification. Concludes with key findings from campaign `cmp-8a020d00`, highlighting a 2× throughput result (48 vs 24 tok/s, driven by accommodating the requested 128-token generation workload versus the baseline's 64-token fallback under constant concurrency $C=2$ without queue saturation) within strict latency ceilings and sub-2% verification drift under immediate rerun.

### Key Evidence Cross-References
- `docs/benchmark-integrity-report.md` § 1–6 (Master recalculation tables and physical proofs)
- `docs/independent-decision-audit.md` § 1, 4, 5 (Decision determinism and verification record)
- `docs/research-evidence-assessment.md` § Executive Summary, Tables A–D
- `artifacts/experiments/cmp-8a020d00/report.json` and `report.md`

### Explicit Limitations & Caveats
- Must explicitly state that findings are derived from a dedicated local serving environment ($C \in \{1, 2\}$, $T_{\max} \in \{32, 128\}$) on a single physical GPU host.
- Must state upfront that active measurement sample counts ($N = 3$ per candidate) represent descriptive ground truth and exploratory evidence, not generalized population distributions.
- Must qualify that the 2× throughput difference reflects a higher per-request token generation budget (`max_tokens: 128` vs `64`) under constant concurrency $C=2$ and stable decode speeds (ITL ~16.85–19.29 ms), rather than a controlled increase in hardware serving efficiency.

---

## 2. Introduction

### Scope Statement
Introduces the rapid proliferation of autoregressive Large Language Models in production services and the critical dependency of customer-facing applications on tight Service-Level Objectives (SLOs). Outlines the fundamental challenge of serving configuration selection: operators face high-dimensional hyperparameter spaces (concurrency limits, KV cache utilization, sequence lengths, batch sizes) with non-linear latency-throughput tradeoffs that cannot be modeled accurately by static analytical formulas. Articulates the SLOKern thesis: *Do not guess the optimal configuration. Find it experimentally in a declared, bounded search space, evaluate it with deterministic rules, and independently verify it under strict drift tolerances.*

### Key Evidence Cross-References
- `docs/architecture.md` § 1 (Core Engineering Principle and Tenets)
- `docs/research-evidence-assessment.md` § Executive Summary & Section 10
- `AGENTS.md` § 1 (Mission and non-negotiable principles)

### Explicit Limitations & Caveats
- Focus is strictly on runtime configuration optimization under fixed model weights and precision; architectural model alterations, fine-tuning, and speculative decoding techniques are outside scope.
- Acknowledges that bounded optimization discovers the best configuration *within the declared search envelope and environment*, explicitly disclaiming global optimality across untested parameter spaces.

---

## 3. Problem Formulation

### Scope Statement
Formulates the constrained optimization problem of LLM serving mathematically. Defines the input tuple consisting of an immutable model $\mathcal{M}$, serving engine $\mathcal{E}$, hardware platform $\mathcal{H}$, workload traffic profile $\mathcal{W}(\lambda, \text{schedule})$, and hard SLO vector $\mathbf{S} = \{(\text{metric}_k, \tau_k, \odot_k)\}$. Formulates the objective function: maximize throughput (or minimize cost) subject to all hard constraints being satisfied and telemetry passing strict validity requirements. Distinguishes hard SLO compliance from soft utility functions.

### Key Evidence Cross-References
- `src/slokern/contracts/spec.py` (`WorkloadSpec`, `SLOSpec`, `SLOConstraint`, `ExperimentBudget`)
- `docs/independent-decision-audit.md` § 2.1 (Mathematical formulation of comparison operators)
- `docs/research-evidence-assessment.md` § 2 (Table B: Workload & Declared Hard SLOs)

### Explicit Limitations & Caveats
- Treats the optimization envelope as stationary during measurement; non-stationary traffic regimes (flash crowds, diurnal shifts) must be decomposed into piecewise stationary workloads.
- The cost model formulation is constrained to resource proxy metrics (GPU-seconds per request or token throughput) when authoritative real-time billing APIs are not attached.

---

## 4. Research Question and Hypotheses

### Scope Statement
States the primary research question: *Can a lightweight, bounded search controller governed by deterministic feasibility evaluation and independent verification discover and reliably confirm superior LLM serving configurations compared to vendor defaults without risking queue saturation or false-positive passes?* Defines four testable hypotheses (H1–H4) and explicitly maps each to empirical findings.

### Hypotheses & Evidence Mapping

| Hypothesis Identifier & Formal Statement | Empirical Verdict & Classification | Authoritative Evidence Reference | Epistemic Limitations & Caveats |
|---|---|---|---|
| **H1: Deterministic Feasibility Prevents Invalid Evidence from Winning**<br>*Deterministic multi-tier evaluation ensures that candidates suffering client queue saturation or metric deficits are disqualified, even when raw throughput appears attractive.* | **DEMONSTRATED** | `docs/benchmark-integrity-report.md` § 4;<br>`docs/independent-decision-audit.md` § 2, 4;<br>`cmp-8a020d00/search_result.json` | Proven by the automated disqualification of candidate `fe984b310e35`: despite producing 48.0 tok/s, client queue lag ($3962.30\text{ ms}$) triggered contamination (`GENERATOR_SATURATED`), forcing verdict `INCONCLUSIVE`. Evaluator disqualified candidate `b2e1f07e45ad` due to throughput breach ($12.0 < 15.0\text{ tok/s}$). |
| **H2: Bounded Search Discovers Feasible Configurations Accommodating Workload Budgets**<br>*An empirical 2×2 search space can discover a configuration that accommodates a declared workload budget while fully satisfying all declared hard SLOs.* | **SUPPORTED WITH LIMITATIONS** | `docs/benchmark-integrity-report.md` § 6;<br>`cmp-8a020d00/search_result.json`;<br>`runs/run-04-cand-95db01/metrics.json` | Candidate `95db015e9de9` delivered 48.0 tok/s ($384\text{ tok} / 8.0\text{s}$) under its requested 128-token budget compared to 24.0 tok/s ($192\text{ tok} / 8.0\text{s}$) for the baseline using fallback 64 tokens, while meeting TTFT p95 ($2095.22\text{ ms} \le 3000.0\text{ ms}$) and ITL p95 ($19.29\text{ ms} \le 30.0\text{ ms}$). *Limitation:* The $2\times$ throughput reflects accommodating a larger per-request token generation workload budget under constant concurrency $C=2$ and stable decode speeds, not an engine-level serving-efficiency speedup. Demonstrated for a single model and hardware configuration. |
| **H3: Independent Verification Mitigates the Risk of Accepting Transient Search Outliers**<br>*Rerunning the selected candidate configuration under a fresh run ID and evaluating multi-metric drift ensures performance stability and catches environmental regression.* | **SUPPORTED WITH LIMITATIONS** | `docs/independent-decision-audit.md` § 5;<br>`cmp-8a020d00/verification_record.json`;<br>`runs/run-verify-69a57759/metrics.json` | Verified candidate reproduced performance with negligible drift under immediate execution rerun: TTFT p95 drifted $-0.99\%$, ITL p95 drifted $-1.57\%$, token throughput exhibited $0.00\%$ drift ($48.00\text{ tok/s}$ exact parity), and error rate remained $0.0000$, well within $\le \pm 15\%$ tolerance. *Limitation:* Rerun was executed immediately ($\Delta t \approx 2.9\text{ ms}$) on the same GPU, confirming immediate execution stability but not thermal normalization or statistical independence. Long-term multi-hour drift was not evaluated. |
| **H4: Request-Level Granular JSONL Telemetry Improves Serving Auditability and Root-Cause Diagnosis**<br>*Preserving unaggregated request event timestamps and inter-token intervals allows exact mathematical recalculation and transparent diagnosis of client-server queuing dynamics.* | **DEMONSTRATED** | `docs/benchmark-integrity-report.md` § 1, 2, 6;<br>`cmp-8a020d00/runs/*/raw_measurements.jsonl` | 24 of 24 physical records enabled exact first-principles recalculation of all metrics to 10 decimal places. Enabled precise forensic discovery of client semaphore queue backlog under concurrency=1, distinguishing queue lag from server-side slowdown. |

### Explicit Limitations & Caveats
- All hypothesis evaluations are strictly grounded in the physical artifacts of campaign `cmp-8a020d00`.
- Hypotheses H2 and H3 are classified as "Supported with limitations" rather than "Demonstrated across all regimes" to respect experimental boundaries.

---

## 5. Related Work

### Scope Statement
Surveys the literature across three primary areas: (1) LLM serving runtimes and batching mechanisms (vLLM, Orca, FasterTransformer, TensorRT-LLM, LightLLM); (2) black-box auto-tuning and configuration search in cloud systems (Bayesian optimization, hyperband, grid search); and (3) benchmarking methodologies and measurement integrity in distributed systems. Contrasts SLOKern's deterministic, evidence-backed verification approach against systems that rely on synthetic load simulations, unverified vendor metrics, or heuristic rules of thumb.

### Key Evidence Cross-References
- `docs/architecture.md` § 2 (Process isolation and dual-backend architecture)
- `docs/research-evidence-assessment.md` § 10 (Section 4: Related Work)
- Relevant academic literature: Orca (OSDI '22), vLLM (SOSP '23), Splitwise (ISCA '24), DistServe (OSDI '24)

### Explicit Limitations & Caveats
- SLOKern does not propose a new internal scheduling algorithm or GPU kernel; it provides an external, black-box optimization, evaluation, and verification harness that treats serving engines as target systems.

---

## 6. System Architecture

### Scope Statement
Presents the modular monolith design of SLOKern and its separation into presentation, control plane, experiment execution worker, and storage boundaries. Details how the load generator is isolated in a dedicated subprocess to eliminate timing interference and event-loop contention with the dashboard and API. Describes the contract architecture governed by immutable Pydantic v2 schemas (`extra="forbid"`) and strict port decoupling (Port 8000 for serving engine, Port 8001 for control plane API, Port 5173 for frontend UI).

### Key Evidence Cross-References
- `src/slokern/` package layout (`contracts/`, `core/`, `engine/`, `api/`, `cli/`)
- `docs/architecture.md` § 2 (Mermaid system architecture and boundary diagrams)
- `docs/installer-verification-audit.md` § 3 (Strict port decoupling architecture)
- `tests/contract/` (156 schema validation tests)

### Explicit Limitations & Caveats
- The modular monolith architecture is optimized for single-node local and cloud GPU environments; distributed multi-node coordinator topologies are not implemented in the current release.

---

## 7. Workload and Serving Model

### Scope Statement
Details the formal workload arrival model and the serving adapter interface. Specifies the constant open-loop arrival schedule where request slot timestamps are generated deterministically ($t_{\text{sched}}^{(i)} = t_0 + i \times \Delta t$). Details the parameter read-back mechanism in `applied_config.json`, which distinguishes requested parameters from effective runtime parameters and tracks parameter status (`applied`, `default_fallback`, `ignored`). Describes the serving adapter boundary supporting vLLM, Ollama, and simulated engines.

### Key Evidence Cross-References
- `src/slokern/engine/loadgen/arrival.py` (`ArrivalSchedule`, `ArrivalSlot`)
- `src/slokern/engine/serving/vllm.py` (`VLLMServingAdapter`)
- `artifacts/experiments/cmp-8a020d00/runs/*/applied_config.json`
- `docs/benchmark-integrity-report.md` § 3.1

### Explicit Limitations & Caveats
- Workload model in authoritative campaign `cmp-8a020d00` used a constant inter-arrival rate ($\lambda = 0.4\text{ req/s}$); Poisson and bursty distributions are implemented in code but were not evaluated in the primary GPU campaign.
- Input prompts were fixed deterministic fixtures (11 tokens); prompt length variance was not evaluated.

---

## 8. Measurement Methodology

### Scope Statement
Rigourously documents the data collection lifecycle for every request event. Defines the four physical timestamps recorded per request: $t_{\text{scheduled}}$, $t_{\text{sent}}$, $t_{\text{first\_token}}$, and $t_{\text{completed}}$. Establishes the causal monotonicity invariant ($t_{\text{scheduled}} \le t_{\text{sent}} \le t_{\text{first\_token}} \le t_{\text{completed}}$). Details the SSE streaming parser, TTFT latching on the first content-bearing token, and the recording of inter-token latency arrays ($itl_k$). Explains how warm-up samples are isolated and how client queue lag is measured.

### Key Evidence Cross-References
- `src/slokern/contracts/evidence.py` (`RawRequestMeasurement`)
- `docs/benchmark-integrity-report.md` § 1, 2, 5 (Causal invariants and SSE streaming state machine)
- `tests/contract/test_fixtures_validate.py` (Causal monotonicity tests)

### Explicit Limitations & Caveats
- Timestamps rely on the host system clock (Python `time.time()` with microsecond resolution); distributed clock synchronization (e.g., PTP) was not required since client and server ran on the same host interface.
- First token latching includes client-side network stack traversal and JSON parsing overhead ($\approx 0.1–0.5\text{ ms}$).

---

## 9. Metric Definitions

### Scope Statement
Provides formal mathematical definitions for all primary and derived metrics. Defines Time to First Token (TTFT), Inter-Token Latency (ITL), End-to-End Latency (E2E), Request Throughput (RPS), and Token Throughput (TPS). Formulates the continuous linear interpolation method used for percentile extraction ($p50, p90, p95, p99$). Explains the sample exclusion policy, including warm-up sample filtering and non-finite value handling.

### Key Evidence Cross-References
- `src/slokern/core/metrics/` (`percentiles.py`, `latency.py`, `throughput.py`, `validity.py`, `aggregate.py`)
- `docs/benchmark-integrity-report.md` § 6.1 (Continuous linear interpolation formulas)
- `docs/research-evidence-assessment.md` § 2 (Deterministic percentile formulas)

### Explicit Limitations & Caveats
- Highlights the mathematical properties of continuous linear interpolation on small sample sets ($N = 3$), showing that $p95$ evaluates to $v_1 + 0.90 \times (v_2 - v_1)$, which interpolates between the median and maximum.
- Acknowledges that percentiles computed from $N = 3$ samples are descriptive statistics of the small batch, not asymptotic estimators of tail behavior.

---

## 10. Deterministic Feasibility Policy

### Scope Statement
Presents the formal logic and reason code taxonomy of the feasibility evaluator. Details the ternary boolean evaluation function `evaluate_constraint(v, \tau, \odot)` operating under strict standard IEEE-754 binary floating-point relational comparisons (`<=`, `<`, `>=`, `>`) without heuristic pre-rounding or epsilon margins. Documents the three-tier precedence hierarchy: Tier 1 (Execution Status), Tier 2 (Evidence Validity), and Tier 3 (Hard SLO Constraints). Formalizes the four state domains ($\mathcal{D}_{\text{exec}}, \mathcal{D}_{\text{evid}}, \mathcal{D}_{\text{feas}}, \mathcal{D}_{\text{verif}}$) and provides mathematical proofs of their orthogonality.

### Key Evidence Cross-References
- `src/slokern/core/evaluator/evaluate.py`
- `src/slokern/contracts/enums.py` (`ExecutionStatus`, `EvidenceValidity`, `FeasibilityVerdict`, `VerificationState`, `ReasonCode`)
- `docs/independent-decision-audit.md` § 2, 3 (Boundary proofs and state matrices)

### Explicit Limitations & Caveats
- Feasibility evaluation is strictly binary (pass/fail) per constraint; soft penalty functions, fuzzy logic, and utility trade-offs are deliberately excluded to prevent subjective bias.
- An empty or missing metric deterministically forces `INCONCLUSIVE`, preventing false passes on unmeasured metrics.

---

## 11. Bounded Search Procedure

### Scope Statement
Describes the bounded grid search procedure and candidate generation pipeline. Explains canonical candidate identification using recursive data normalization and SHA-256 hashing. Details the 2×2 grid space explored in campaign `cmp-8a020d00`: concurrency $C \in \{1, 2\}$ and maximum output tokens $T_{\max} \in \{32, 128\}$. Documents the budget limiter enforcing a strict 6-run cap (1 baseline + 4 candidates + 1 verification run). Describes the candidate ranking logic under objective `max_throughput_under_slo` and deterministic tie-breaking.

### Key Evidence Cross-References
- `src/slokern/core/search/` (`candidate_id.py`, `space.py`, `grid.py`, `rank.py`, `budget.py`)
- `artifacts/experiments/cmp-8a020d00/search_result.json`
- `docs/independent-decision-audit.md` § 4

### Explicit Limitations & Caveats
- Search space was intentionally bounded to 4 candidates to operate within realistic compute budgets; broader grids ($3 \times 3$, $4 \times 4$) or continuous search are architectural extensions.
- Stopping reason in campaign `cmp-8a020d00` was `space_exhausted` (all 4 grid candidates evaluated); early stopping conditions were not triggered.

---

## 12. Independent Verification

### Scope Statement
Details the independent verification protocol engineered to eliminate transient benchmarking artifacts and lucky search outcomes. Formulates the four verification invariants: fresh run ID generation, temporal non-overlap, multi-metric drift calculation, and automated drift gating. Documents the declared drift thresholds ($\le +15\%$ for TTFT p95 and ITL p95, $\ge -15\%$ for token throughput, and $\le +0.01$ for error rate). Explains how verification results are compiled into an immutable `VerificationRecord`.

### Key Evidence Cross-References
- `src/slokern/core/verification/` (`protocol.py`, `compare.py`)
- `src/slokern/contracts/verification.py` (`VerificationRecord`, `DriftAnalysis`, `MetricDriftComparison`)
- `artifacts/experiments/cmp-8a020d00/verification_record.json`
- `docs/independent-decision-audit.md` § 5

### Explicit Limitations & Caveats
- Verification protocol in this campaign executed a single rerun ($R = 1$); multiple repetitions ($R \ge 3$) would provide tighter confidence bounds on drift.
- Verification was executed immediately following the search run ($\Delta t = +2.9\text{ ms}$) on the same GPU; this confirms immediate operational reproducibility under near-identical conditions, but does not evaluate thermal normalization or statistical independence from the search run. Multi-hour thermal throttling or system memory fragmentation was not evaluated.

---

## 13. Experimental Environment

### Scope Statement
Presents a complete, publication-grade specification of the physical hardware, operating system, network stack, and serving runtime used in the authoritative benchmark. Documents the NVIDIA GeForce RTX 5060 Laptop GPU (8,151 MiB GDDR7, Blackwell Mobile Architecture, Driver 621.24 / 572.16, CUDA 12.8). Details the serving runtime: vLLM 0.34.0 (package `0.6.3+cu124`) hosting `slokern-qwen3-1.7b` (`Qwen/Qwen3-1.7B`, native BF16 unquantized) with FlashAttention-2 and eager execution under a strict localhost loopback interface.

### Key Evidence Cross-References
- `docs/research-evidence-assessment.md` § 1 (Table A: System Hardware & Serving Runtime Specification)
- `artifacts/experiments/cmp-8a020d00/report.json` lines 74–90
- `artifacts/experiments/cmp-8a020d00/runs/*/applied_config.json`

### Explicit Limitations & Caveats
- Experiments were conducted on a single GPU laptop workstation; server-grade accelerator architectures (H100, A100) with higher memory bandwidth and multi-GPU tensor parallelism were not evaluated.
- Host operated under Windows 11 with WSL2 Ubuntu 24.04 passthrough; native bare-metal Linux may exhibit marginally lower virtualization latency.

---

## 14. Results

### Scope Statement
Presents the primary empirical results of campaign `cmp-8a020d00`. Compares the 5 search candidates and the verification run across all primary dimensions (TTFT, ITL, TPS, dispatch lag, validity status, and feasibility verdict). Details the performance of winning candidate `95db015e9de9` ($C=2, T_{\max}=128$), which achieved $48.00\text{ tok/s}$ ($384\text{ tok} / 8.0\text{s}$) under its requested 128-token budget compared to $24.00\text{ tok/s}$ ($192\text{ tok} / 8.0\text{s}$) for the baseline using fallback 64 tokens, while maintaining compliant TTFT p95 ($2095.22\text{ ms} \le 3000.0\text{ ms}$) and ITL p95 ($19.29\text{ ms} \le 30.0\text{ ms}$). Details the immediate verification rerun `run-verify-69a57759` confirming exact throughput parity ($48.00\text{ tok/s}$) and latency drift under $1.6\%$.

### Key Evidence Cross-References
- `docs/research-evidence-assessment.md` § 3, 4 (Table C: Candidate Results, Table D: Verification Analysis)
- `docs/benchmark-integrity-report.md` § 6.2, 6.3 (Step-by-step mathematical derivations)
- `artifacts/experiments/cmp-8a020d00/report.json` and `report.md`

### Explicit Limitations & Caveats
- Results reflect a constant workload rate of 0.4 RPS; results cannot be extrapolated to saturated load regimes near engine capacity without further testing.
- The 2× throughput difference was driven by accommodating the requested 128-token generation workload budget under concurrency $C=2$ versus the baseline's fallback 64-token budget, rather than a controlled increase in engine serving efficiency (decode ITL remained stable at ~16.85–19.29 ms).

---

## 15. Statistical and Measurement Analysis

### Scope Statement
Provides a transparent, publication-grade statistical assessment of the empirical dataset. Emphasizes strict scientific discipline: because campaign `cmp-8a020d00` evaluated $N = 3$ active samples per run, the results are explicitly classified as Tier 1 (Descriptive Ground Truth) or Tier 2 (Exploratory Findings). Details why parametric significance testing (e.g., Student's t-test, ANOVA) and confidence interval calculations are mathematically inappropriate for $N = 3$. Demonstrates that observable differences (48 vs 24 tok/s, drift $< 2\%$) are genuine physical measurements, while acknowledging the lack of asymptotic statistical generalization.

### Key Evidence Cross-References
- `docs/research-evidence-assessment.md` § 8 (Table F: Epistemological Classification of Research Claims)
- `docs/final-20-test-report.md` § 1.3, 7.2 (Statistical Limitations)
- Standard statistical methodologies: Student (1908), Efron & Tibshirani (Bootstrap, 1993)

### Explicit Limitations & Caveats
- **Mandatory Epistemic Invariant:** Enforces the rule that **claims of statistical significance require sample sizes determined via formal power analysis ($\alpha = 0.05, 1 - \beta \ge 0.80$, MDE) and non-parametric bootstrap estimation**, noting that rule-of-thumb heuristics like $N \ge 30$ are inadequate for heavy-tailed tail percentiles (p95/p99) which typically demand hundreds of requests per regime.
- Zero claims of statistical significance or confidence interval bounds are made in this section.
- Observable performance gains are reported as descriptive facts of the physical experiment, not as statistically generalized population inferences.

---

## 16. Failure Analysis

### Scope Statement
Conducts a deep-dive forensic analysis of the two candidate configurations that failed to achieve feasibility in campaign `cmp-8a020d00`. Details the mechanism of client-side semaphore queue saturation under concurrency $C = 1$ in `run-01` and `run-02`, where generation times exceeded the 2.5s inter-arrival interval, compounding queue delay to $184.60\text{ ms}$ and $3962.30\text{ ms}$ and triggering automated contamination disqualification. Details the failure of candidate `run-03` ($C=2, T_{\max}=32$), which completed with uncorrupted telemetry but was deterministically marked `INFEASIBLE` due to a throughput deficit ($12.00\text{ tok/s} < 15.0\text{ tok/s}$).

### Key Evidence Cross-References
- `docs/benchmark-integrity-report.md` § 4 (Generator Saturation & Dispatch Skew Auditing)
- `docs/independent-decision-audit.md` § 4.4 (Disqualification Case Studies)
- `artifacts/experiments/cmp-8a020d00/runs/run-01-cand-096180/feasibility.json`
- `artifacts/experiments/cmp-8a020d00/runs/run-02-cand-fe984b/feasibility.json`
- `artifacts/experiments/cmp-8a020d00/runs/run-03-cand-b2e1f0/feasibility.json`

### Explicit Limitations & Caveats
- Demonstrates that client queue saturation is an artifact of the relationship between request duration and the declared arrival rate under $C=1$; it is a client loadgen constraint, not an engine crash.
- Emphasizes that without saturation detection, candidate `fe984b310e35` would have falsely won on throughput (48 tok/s), proving the necessity of validity gating.

---

## 17. Threats to Validity

### Scope Statement
Analyzes potential threats to experimental validity across four standard dimensions: construct validity, internal validity, external validity, and reliability. Analyzes construct validity: whether TTFT and ITL accurately capture user-perceived interactive latency. Analyzes internal validity: potential confounding factors such as GPU thermal throttling, host operating system background threads, and WSL2 virtualization overhead. Analyzes external validity: applicability to different model families, quantization levels, and GPU architectures. Analyzes reliability: repeatability across distinct runs and test environments.

### Key Evidence Cross-References
- `docs/benchmark-integrity-report.md` § 2 (Timestamp monotonicity and causal provenance)
- `docs/independent-decision-audit.md` § 5 (Verification run independence)
- `docs/research-evidence-assessment.md` § 9 (Figures 1–5: Architecture and Verification Drift Visualizations)

### Explicit Limitations & Caveats
- Thermal throttling on laptop form-factor GPUs can induce non-stationary latency over extended runs; in `cmp-8a020d00`, total campaign duration was 97.6s, minimizing thermal accumulation. However, because the verification rerun executed 2.9 ms after the search run on the same GPU, it verifies operational reproducibility under near-identical conditions rather than long-term thermal normalization or statistical independence.
- Background process interference was minimized by running dedicated single-tenant tests, but Windows background OS services cannot be completely eliminated.

---

## 18. Limitations

### Scope Statement
Provides a candid, comprehensive disclosure of the structural and scope limitations of the SLOKern prototype and the presented evaluation. Discusses: (1) small sample size ($N = 3$ active requests per run); (2) bounded 2×2 search grid; (3) single hardware accelerator host; (4) single model architecture (`slokern-qwen3-1.7b`); (5) short experiment duration (9.0s per run); and (6) constant open-loop arrival schedule. Explains how each limitation was chosen to ensure feasibility for an authoritative release gate while outlining paths for removal.

### Key Evidence Cross-References
- `docs/final-20-test-report.md` § 7.2 (Explicit Statistical Limitations)
- `docs/research-evidence-assessment.md` § 8 (Table F)
- `AGENTS.md` § 1, 10

### Explicit Limitations & Caveats
- This section serves as the formal boundary disclosure, ensuring peer reviewers that the authors do not overclaim the scope or universality of the empirical results.

---

## 19. Reproducibility

### Scope Statement
Establishes an exhaustive reproducibility protocol enabling independent researchers to verify all claims, recompute all metrics, and validate all schemas. Catalogs all 35 campaign artifacts in `cmp-8a020d00` with their 64-character SHA-256 checksums and Pydantic v2 schemas. Provides concrete PowerShell and Bash reproduction commands to run the contract test suite (156 tests), unit test suite (602 tests), installer test suite (86 tests), and mock integration test suite (10 tests). Notes that all raw JSONL telemetry files are frozen in the repository.

### Key Evidence Cross-References
- `docs/release-evidence-index.md` § 3, 6 (Master Cryptographic Inventory & Reproduction Guide)
- `docs/final-20-test-report.md` § 9 (Concrete Reproduction Instructions)
- `scripts/doctor.py` and `scripts/setup.ps1`

### Explicit Limitations & Caveats
- End-to-end live inference reproduction requires an NVIDIA GPU with $\ge 8\text{ GB}$ VRAM and a running vLLM daemon.
- All non-live tests (contracts, evaluators, search controller, rankers, mock pipelines, report generators) run 100% reproducibly in zero-GPU mode on standard CPU environments.

---

## 20. Conclusion and Future Work

### Scope Statement
Summarizes the key contributions of the paper: introducing SLOKern as an evidence-driven, SLO-aware inference optimization and verification framework; establishing deterministic feasibility rules that eliminate false-positive passes from contaminated telemetry; and proving the efficacy of independent verification under strict drift tolerances. Outlines high-impact avenues for future work: expanding search budgets to higher-dimensional spaces ($C \times T_{\max} \times \text{KV-cache-util} \times \text{batch-size}$), supporting Bayesian optimization under deterministic feasibility constraints, expanding sample counts ($N \ge 30$) for statistical generalization, and porting to multi-node datacenter clusters.

### Key Evidence Cross-References
- `docs/final-20-test-report.md` § 10 (Final Recommendation & Release Sign-Off)
- `docs/research-evidence-assessment.md` § 10 (Section 10: Conclusion & Future Work)
- `ROADMAP.md` (Future milestones)

### Explicit Limitations & Caveats
- Concludes by reiterating the core engineering ethos: automated inference optimization must remain grounded in verifiable physical telemetry, deterministic decision boundaries, and disciplined empirical claims.
