# SLOKern Master Release Evidence Index & Cryptographic Inventory

> **Document ID:** `DOC-M4-RELEASE-EVIDENCE-INDEX`  
> **Milestone:** Milestone M4 — Research Evidence Package & Master Release Evidence Index  
> **Author:** Worker M4 (Research and Documentation Author)  
> **Repository:** `slokern` — *Optimize inference. Verify performance.*  
> **Authoritative Campaign:** `cmp-8a020d00`  
> **Repository Commit SHA:** `56348ecc7d3bf2a43cd40f186286a12dbc21bdd4` (Branch: `main`)  
> **Hardware Host:** Physical NVIDIA GeForce RTX 5060 Laptop GPU (8,151 MiB GDDR7)  
> **Audit Standards:** AGENTS.md (§ 1, 3, 4, 5, 7, 8, 10, 13, 14, 15, 16), ORIGINAL_REQUEST.md (§ R1–R5, Acceptance Criteria), PROJECT.md, SCOPE.md  
> **Release Authority:** Rajdeep (Sole Technical Owner & Final Release Authority)  
> **Audit Integrity:** 100% Cryptographically Verified, Zero Synthetic / Fabricated Substitutions  

---

## 1. Executive Summary & Verification Protocol

This document serves as the master cryptographic inventory and cross-reference index for the complete SLOKern release package, satisfying Requirement R5 (Test 20) of the release specification.

Every technical claim, feasibility decision, and performance metric published for SLOKern is anchored directly in immutable physical artifacts stored on disk. This index catalogs:
1. **The 35 Campaign Artifacts in `cmp-8a020d00`:** Full 64-character SHA-256 checksums, exact byte sizes, Pydantic v2 schema roles, and semantic purposes across all 5 campaign-level dossiers and 6 run directories.
2. **The 5 UI Acceptance Screenshots:** Full cryptographic verification of 1920×1080 resolution evidence captures for campaign `cmp-8a020d00`.
3. **Historical Baseline Screenshots:** Preservation audit confirming all 10 historical baseline screenshots remain 100% untouched.
4. **Git Tree State & Provenance:** Cryptographic commit hash, branch identity, and working tree invariance audit.
5. **Master Deliverables Matrix:** 1-to-1 traceability crosswalk linking all 6 core release documents to Requirements R1–R5 and Tests 01–20.
6. **Automated Verification Procedures:** Concrete PowerShell test commands to independently re-verify checksums, schemas, and drift tolerances.

---

## 2. Git Commit History & Repository Integrity

Direct inspection via Git CLI commands (`git rev-parse HEAD`, `git branch --show-current`, `git status --short`) establishes the repository baseline:

| Property | Value / Status | Verification Command & Provenance |
|---|---|---|
| **Current HEAD Commit SHA** | **`56348ecc7d3bf2a43cd40f186286a12dbc21bdd4`** (short: `56348ec`) | `git rev-parse HEAD` |
| **Active Branch** | **`main`** | `git branch --show-current` |
| **Commit Timestamp** | `2026-11-19 04:36:46 +0530` | `git log -1 --format="%ci"` |
| **Commit Subject** | *Implement turnkey bootstrap, tracked service lifecycle, and diagnostic architecture* | `git log -1 --format="%s"` |
| **Repository Invariance** | **PRESERVED** — Zero commits, resets, reverts, stashes, cleans, or destructive ops | AGENTS.md § 1, ORIGINAL_REQUEST.md |
| **Tracked Changes Policy** | Solely authorized release documentation authoring under `docs/` | Dispatched scope boundaries |

### Recent Git Commit Log
- `56348ec` (2026-11-19): *Implement turnkey bootstrap, tracked service lifecycle, and diagnostic architecture*
- `9cba986` (2026-11-19): *Add integration and unit tests for VLLMServingAdapter and workload fixtures*
- `73b4f58` (2026-11-17): *feat(frontend): comprehensive UI overhaul, architectural diagrams, and visual craft invariants*
- `e47554c` (2026-11-14): *fix(api): Handle SSE queue timeouts with keep-alives and graceful server shutdown*
- `0655ca4` (2026-11-14): *fix(api,frontend): Fix model_name propagation, SSE event drop, late subscriber replay, and infeasible timeline state*

---

## 3. Cryptographic Inventory: Campaign `cmp-8a020d00` (35 Physical Artifacts)

The authoritative campaign `cmp-8a020d00` contains exactly 35 physical files on disk: 5 top-level campaign dossiers and 6 run subdirectories containing 5 files each. All files are strictly validated against immutable Pydantic v2 schemas (`extra="forbid"`).

| # | Artifact Relative Path | Size (Bytes) | SHA-256 Cryptographic Checksum (Hex 64) | Pydantic Schema / Type | Role & Semantic Purpose |
|---|---|---|---|---|---|
| **1** | `artifacts/experiments/cmp-8a020d00/experiment_spec.json` | 1,583 | `71C62A397D3F0E7A1791C18C2F194828EAE9A8358B03FDCDA407E995CB31DFA5` | `ExperimentSpec` | Campaign specification: workload `vllm-live-acceptance`, 4 hard SLO constraints, 2×2 search space, 5-candidate budget, verification policy. |
| **2** | `artifacts/experiments/cmp-8a020d00/search_result.json` | 1,036 | `B8C2515B3C48C4164C4FD575A9DD7450CF2BB5BC13393D40F10DE0B509249482` | `SearchResult` | Deterministic search output: 5 tested candidates, baseline `e52525257b48`, winner `95db015e9de9`, objective `max_throughput_under_slo`, stopping reason `space_exhausted`. |
| **3** | `artifacts/experiments/cmp-8a020d00/verification_record.json` | 8,699 | `D2B8A4AFA4739EE73A75E6B6A78BCE87EF972E9FAE5929D53CBFF61FA7E7522B` | `VerificationRecord` | Independent verification certificate `verif-c70ecef3`: compares `run-04-cand-95db01` to `run-verify-69a57759`, drift channels ($\le 1.57\%$), verdict `VERIFIED`. |
| **4** | `artifacts/experiments/cmp-8a020d00/report.json` | 14,428 | `861BE0BE19810A561D2E9A8ABECCAE424888E490CCEA42F9BD2D6E8573902864` | `ReportArtifact` | Machine-readable audit dossier: full specification, baseline metrics, candidate rankings, verification drift analysis, secret redaction metadata. |
| **5** | `artifacts/experiments/cmp-8a020d00/report.md` | 3,449 | `B591A5E68D2ABA77D9DCE136C4707C68126B536458DE5029524354D96DF8B7B7` | Markdown Dossier | Human-readable audit report: executive summary, candidate rankings, verification audit, limitations, and `LIVE` classification badge. |
| **6** | `artifacts/experiments/cmp-8a020d00/runs/run-00-baseline-e52525/applied_config.json` | 1,189 | `1790EEE4AB37C9239CEE448D2AA3E1DE78AA7E076298954058B003B42D71C8FA` | `AppliedConfig` | Runtime read-back: baseline candidate `e52525257b48`, concurrency: 2, max_tokens: 64, environment fingerprint (RTX 5060, vLLM 0.34.0). |
| **7** | `artifacts/experiments/cmp-8a020d00/runs/run-00-baseline-e52525/feasibility.json` | 1,220 | `26B0090BF756AAA07C6774C45A89A0140430A5C4A7A39CE3631DCC11EA6B8DAF` | `FeasibilityVerdict` | Evaluator decision: `FEASIBLE`, validity `VALID`, all 4 constraints passed (`HARD_CONSTRAINTS_PASSED`). |
| **8** | `artifacts/experiments/cmp-8a020d00/runs/run-00-baseline-e52525/metrics.json` | 1,209 | `2C6484D47C021033B41CE499BC37D8EE2AF1CA126AB5F660B6B37BBF6332A95B` | `RunMetrics` | Derived metrics: TTFT p95: 2104.58 ms, ITL p95: 16.85 ms, TPS: 24.0 tok/s, error rate: 0.0, sample count: 3 active measured. |
| **9** | `artifacts/experiments/cmp-8a020d00/runs/run-00-baseline-e52525/raw_measurements.jsonl` | 3,127 | `9A403E03953645B95CAF7D4D7AFEAABBD20D3B09D359893C5001E99D67E97C6E` | `RawRequestMeasurement` | Telemetry trace: 4 requests (1 warm-up isolated, 3 active measured), causal monotonic timestamps, zero failed requests. |
| **10** | `artifacts/experiments/cmp-8a020d00/runs/run-00-baseline-e52525/run_record.json` | 430 | `6E921B0FE99AC21F09E9AD033133614B2DDA74FEDBF8176E72C6C86F2051561A` | `RunRecord` | Lifecycle record: status `COMPLETED`, start/end timestamps, duration 8.62s. |
| **11** | `artifacts/experiments/cmp-8a020d00/runs/run-01-cand-096180/applied_config.json` | 1,211 | `DC6981489D0546EB0CD85A81AD5C5D1DAAEA9616869E5D6BE218D77B427A13FC` | `AppliedConfig` | Runtime read-back: candidate `09618034778e`, concurrency: 1, max_tokens: 32. |
| **12** | `artifacts/experiments/cmp-8a020d00/runs/run-01-cand-096180/feasibility.json` | 1,237 | `0DF96CC0F38815A96789A6D5D2DAA67958A1A8E5772BA35C7C495ED473BBE7EE` | `FeasibilityVerdict` | Evaluator decision: `INCONCLUSIVE`, validity `CONTAMINATED`, reason `GENERATOR_SATURATED` (dispatch lag > 10ms). |
| **13** | `artifacts/experiments/cmp-8a020d00/runs/run-01-cand-096180/metrics.json` | 1,206 | `8E6840B1459B6751489B36E8CA8762A5C999B6965B8899BEB4A898C62B3E4F8D` | `RunMetrics` | Derived metrics: TTFT p95: 2084.24 ms, ITL p95: 19.21 ms, TPS: 12.0 tok/s, generator_saturated: true. |
| **14** | `artifacts/experiments/cmp-8a020d00/runs/run-01-cand-096180/raw_measurements.jsonl` | 2,204 | `9D01C76C7DC021F13E85557B029BA0CC73CB62264BDC5B210673FA3881EB1E20` | `RawRequestMeasurement` | Telemetry trace: 4 requests (1 warm-up, 3 active measured), saturation lag documented. |
| **15** | `artifacts/experiments/cmp-8a020d00/runs/run-01-cand-096180/run_record.json` | 422 | `2E7D4B8247D7036F84E3EF12C7EB4481D51136486555216963B90809E44D0E26` | `RunRecord` | Lifecycle record: status `COMPLETED`, duration 8.44s. |
| **16** | `artifacts/experiments/cmp-8a020d00/runs/run-02-cand-fe984b/applied_config.json` | 1,213 | `96DC5AB8283D45C1D55A801061832B9C9538B7DCB247290AAC900CEC6AD8AB44` | `AppliedConfig` | Runtime read-back: candidate `fe984b310e35`, concurrency: 1, max_tokens: 128. |
| **17** | `artifacts/experiments/cmp-8a020d00/runs/run-02-cand-fe984b/feasibility.json` | 1,236 | `2DA36686ED0F623FED3E91D1BF8CB042CDBF218CE5E45F435E35965D4A7A02C0` | `FeasibilityVerdict` | Evaluator decision: `INCONCLUSIVE`, validity `CONTAMINATED`, reason `GENERATOR_SATURATED`. |
| **18** | `artifacts/experiments/cmp-8a020d00/runs/run-02-cand-fe984b/metrics.json` | 1,202 | `73D85112BC4BA1A0C034EDABBE9198CD28B8C3EA6303B28C6708A14C3881EF8E` | `RunMetrics` | Derived metrics: TTFT p95: 2094.95 ms, ITL p95: 19.30 ms, TPS: 48.0 tok/s. |
| **19** | `artifacts/experiments/cmp-8a020d00/runs/run-02-cand-fe984b/raw_measurements.jsonl` | 4,846 | `4465CB0104CFFB916FE7C9EFF6F5FA10F7EBD98045D8CEBCEA89DCA13028E0B2` | `RawRequestMeasurement` | Telemetry trace: 4 requests (1 warm-up, 3 active measured). |
| **20** | `artifacts/experiments/cmp-8a020d00/runs/run-02-cand-fe984b/run_record.json` | 422 | `23D7D5FF1EDD9ADDDB19904CAD687F32DB679303120DEDD4C0F7CDD56B369CED` | `RunRecord` | Lifecycle record: status `COMPLETED`, duration 8.52s. |
| **21** | `artifacts/experiments/cmp-8a020d00/runs/run-03-cand-b2e1f0/applied_config.json` | 1,211 | `CA93F8553612261C07F808B22A251647EBDB175B008048A5B3B6C8003CA85B9A` | `AppliedConfig` | Runtime read-back: candidate `b2e1f07e45ad`, concurrency: 2, max_tokens: 32. |
| **22** | `artifacts/experiments/cmp-8a020d00/runs/run-03-cand-b2e1f0/feasibility.json` | 1,234 | `E3C68272F9783E11012B23C0A0BEB5965C7E464F21D3D9A166B77E70528307DE` | `FeasibilityVerdict` | Evaluator decision: `INFEASIBLE`, validity `VALID`, breach reason `THROUGHPUT_DEFICIT` (12.0 tok/s < 15.0 threshold). |
| **23** | `artifacts/experiments/cmp-8a020d00/runs/run-03-cand-b2e1f0/metrics.json` | 1,208 | `78E406A85A99392C77A929027925F1A97B8B1B0349D5BDE1D00AE0D4CC8A2600` | `RunMetrics` | Derived metrics: TTFT p95: 2072.38 ms, ITL p95: 18.02 ms, TPS: 12.0 tok/s, error rate: 0.0. |
| **24** | `artifacts/experiments/cmp-8a020d00/runs/run-03-cand-b2e1f0/raw_measurements.jsonl` | 2,209 | `00FA518079C4F6CFF560FC69E0848ED10352CF08EAF3C53708FE00AD02D3984A` | `RawRequestMeasurement` | Telemetry trace: 4 requests (1 warm-up, 3 active measured). |
| **25** | `artifacts/experiments/cmp-8a020d00/runs/run-03-cand-b2e1f0/run_record.json` | 422 | `5AF2C0A5445F45300A9A0AEA512C757235010023BA25DE7EC0F3AFDE7825AC20` | `RunRecord` | Lifecycle record: status `COMPLETED`, duration 8.44s. |
| **26** | `artifacts/experiments/cmp-8a020d00/runs/run-04-cand-95db01/applied_config.json` | 1,213 | `F7C54EC33261589746AA323E4366717E2826D6D94FFD0B801AC28EE0577B7E06` | `AppliedConfig` | Runtime read-back: winner candidate `95db015e9de9`, concurrency: 2, max_tokens: 128. |
| **27** | `artifacts/experiments/cmp-8a020d00/runs/run-04-cand-95db01/feasibility.json` | 1,215 | `5ED805542821FA7EA5312A254595728B62D639AC5834323902CA6949FF79E6F8` | `FeasibilityVerdict` | Evaluator decision: `FEASIBLE`, validity `VALID`, reason `HARD_CONSTRAINTS_PASSED` (Winner candidate). |
| **28** | `artifacts/experiments/cmp-8a020d00/runs/run-04-cand-95db01/metrics.json` | 1,201 | `36BBC3DF2064DAAF19EC0488613E44A57B2C3878314EAD329F9ED5A4E20BC21C` | `RunMetrics` | Derived metrics: TTFT p95: 2095.22 ms, ITL p95: 19.29 ms, TPS: 48.0 tok/s, error rate: 0.0. Highest throughput among feasible candidates! |
| **29** | `artifacts/experiments/cmp-8a020d00/runs/run-04-cand-95db01/raw_measurements.jsonl` | 4,844 | `D1B727C7FAD83BB60567125F85A079CD204B0A58C86F15DBE65B45465E9CEC28` | `RawRequestMeasurement` | Telemetry trace: 4 requests (1 warm-up, 3 active measured), 128 output tokens per request. |
| **30** | `artifacts/experiments/cmp-8a020d00/runs/run-04-cand-95db01/run_record.json` | 422 | `4C263FD557EDA4047EBF865A4DD6D2626B3F53F6502B69773909A3A5DF2733BF` | `RunRecord` | Lifecycle record: status `COMPLETED`, duration 8.51s. |
| **31** | `artifacts/experiments/cmp-8a020d00/runs/run-verify-69a57759/applied_config.json` | 1,213 | `F7C54EC33261589746AA323E4366717E2826D6D94FFD0B801AC28EE0577B7E06` | `AppliedConfig` | Runtime read-back: fresh verification run of winner `95db015e9de9`, concurrency: 2, max_tokens: 128 (identical applied settings hash). |
| **32** | `artifacts/experiments/cmp-8a020d00/runs/run-verify-69a57759/feasibility.json` | 1,216 | `773E1610D146D43C344659355D431FF8C1AD6AB066AEBA51155662C6EA1A8A7F` | `FeasibilityVerdict` | Evaluator decision: `FEASIBLE`, validity `VALID`, reason `HARD_CONSTRAINTS_PASSED`. |
| **33** | `artifacts/experiments/cmp-8a020d00/runs/run-verify-69a57759/metrics.json` | 1,204 | `E1431557626572D7BC4633B46E8C238426694A0CDB1B09319163288C0A045B25` | `RunMetrics` | Verification metrics: TTFT p95: 2074.45 ms, ITL p95: 18.99 ms, TPS: 48.0 tok/s, error rate: 0.0. Drift vs run-04: TTFT -0.99%, ITL -1.57%, TPS 0.0%. |
| **34** | `artifacts/experiments/cmp-8a020d00/runs/run-verify-69a57759/raw_measurements.jsonl` | 4,867 | `7F44BB67943CC2449FFBE94E6535144B0DF00CAE7E34B7A953E8289E00E70B68` | `RawRequestMeasurement` | Fresh verification telemetry: 4 distinct requests, distinct request IDs and timestamps (fresh execution, NOT reused search data). |
| **35** | `artifacts/experiments/cmp-8a020d00/runs/run-verify-69a57759/run_record.json` | 423 | `ACCD2F90ED22A0E924285854B97A6F1F43E098F5E3E8F5ACF8366833A9DBF0BC` | `RunRecord` | Lifecycle record: status `COMPLETED`, distinct run ID `run-verify-69a57759`, duration 8.52s. |

---

## 4. UI Acceptance Screenshots Inventory

Captured during the REM-04 UI Acceptance validation under campaign `cmp-8a020d00`, these 5 high-resolution (1920×1080) PNG screenshots prove interface consistency and accurate DEMO DATA labelling across the SLOKern Technical Command Center dashboard.

Location: `artifacts/screenshots/ui-acceptance-cmp-8a020d00/`

| # | Screenshot Filename | Dimensions | Size (Bytes) | SHA-256 Cryptographic Checksum (Hex 64) | Rendered View & Primary Evidence Displayed |
|---|---|---|---|---|---|
| **01** | `01-tuning-lab-winner-95db01.png` | 1920×1080 | 190,159 | `B9F5AB4751A270A0C828CC9EAE60337D9ED14F4DA9DD1E1390A79F8BF2F14C57` | **TuningLabView:** Displays 2×2 parameter matrix; winner `95db015e9de9` positioned in top-right quadrant ($C=2, T_{\max}=128$) with `★ WINNER` tag, 48.0 tok/s, 2.10s TTFT p95; inspector panel confirms reason `HARD_CONSTRAINTS_PASSED`. |
| **02** | `02-experiments-history-6runs.png` | 1920×1080 | 173,530 | `5E60097825BB3EA3E8B78082990BBBB8E231B24EED9C6C4CA5F32E1A081E4419` | **ExperimentsView:** Campaign `cmp-8a020d00` selected; scrubber active on `run-04-cand-95db01`; SlideOverDrawer displays candidate identity `95db015e9de9`, offered/achieved load `0.4 / 0.4 rps`, validity `VALID`, feasibility `Feasible`, verification `Verified`. |
| **03** | `03-verification-view-verified.png` | 1920×1080 | 266,137 | `FCF182CD0F088017BA551B186C57A0FD5760FB30DB7FE399259B57CC85A9ED2B` | **VerificationView:** Displays air-gap boundary `SEAL INTACT` linking `run-04-cand-95db01` to `run-verify-69a57759`; drift channels show TTFT p95 ($2095.2\text{ ms} \to 2074.4\text{ ms}, \text{PASS}$), ITL p95 ($19.3\text{ ms} \to 19.0\text{ ms}, \text{PASS}$), throughput ($48.0\text{ tok/s}, \text{PASS}$). |
| **04** | `04-reports-view-cmp-8a020d00.png` | 1920×1080 | 122,424 | `B44DACA1CC18993F6947F13FC43386817C4B974DB23CBA3B68C5E062632E9E1E` | **ReportsView:** Displays report `rep-9724082d` with `cmp-8a020d00 (LIVE)` badge; confirms `INDEPENDENT VERIFICATION PASSED`, winner `95db015e9de9`, baseline `e52525257b48`, and full Markdown dossier. |
| **05** | `05-workloads-view.png` | 1920×1080 | 142,693 | `99F9B8714A59AA94B656E58CAD2F0F3D9F3F94DC654A8F9C4E89358523C938E0` | **WorkloadsView:** Displays workload specification sliders (0.4 RPS arrival rate, 1.0s/8.0s windows, TTFT 3000ms ceiling, ITL 30ms ceiling, TPS 15 floor); `● DEMO DATA` badge prominently displayed on preset controls when not polling live server. |

### Historical Baseline Screenshots Preservation
All 10 historical baseline screenshots located in `artifacts/screenshots/ui-acceptance/` remain 100% untouched and preserved for historical auditability:
- `01-workloads-configured.png` (141,421 bytes, SHA-256: `A2D53903E28FA3EC...`)
- `02-preflight-probe-toast.png` (141,048 bytes, SHA-256: `11A63F37F551CA7E...`)
- `03-campaign-drawer-envelope.png` (207,166 bytes, SHA-256: `FA5F7E16720A40F5...`)
- `04-campaign-progress-live.png` (210,442 bytes, SHA-256: `4EBF2C163105E58E...`)
- `05-campaign-verification-stage.png` (243,367 bytes, SHA-256: `232C9773E6C4D382...`)
- `06-campaign-verification-reveal.png` (212,713 bytes, SHA-256: `B04CE4CE6A962BF1...`)
- `07-tuning-lab-winner.png` (186,893 bytes, SHA-256: `1EAA5C62C91D19B3...`)
- `08-experiments-view.png` (114,168 bytes, SHA-256: `303C1A3382B2F229...`)
- `09-verification-view.png` (265,433 bytes, SHA-256: `BDB6AA7D1797B987...`)
- `10-reports-view.png` (133,708 bytes, SHA-256: `B9561E96A39FF0CC...`)

---

## 5. Master Release Documentation Deliverables Mapping

Requirement R5 establishes 6 core release documents. This section cross-references each document against its owning milestone, accountable lead, and the 20-test validation matrix:

| Document ID | Deliverable File Path | Milestone & Lead | Primary Scope & Contents | Status |
|---|---|---|---|---|
| **D1** | `docs/final-release-audit.md` | M5 — Rajdeep (Sole Lead) | Master Certification: G0–G9 gate evaluations, remediation register (REM-01 to REM-04), solo execution model, final GO recommendation. | **PUBLISHED** |
| **D2** | `docs/final-20-test-report.md` | M5 — Rajdeep (Sole Lead) | Comprehensive 20-test matrix report: explicit status (PASS/FAIL/BLOCKED/SKIPPED/NOT RUN), evidence traces for Tests 01–20 (20 PASS, 0 BLOCKED, 0 FAIL). | **PUBLISHED** |
| **D3** | `docs/benchmark-integrity-report.md` | M1 — Adriraj (Auditor) | Benchmark integrity: Tests 04–07, 19, raw JSONL telemetry audit, causal timestamps, warm-up isolation, saturation analysis. | **PUBLISHED** |
| **D4** | `docs/independent-decision-audit.md` | M2 — Daksh (Auditor) | Decision correctness: Tests 08, 09, 12, 13, boundary condition proofs, state domain separation, candidate ranking, verification drift. | **PUBLISHED** |
| **D5** | `docs/research-evidence-assessment.md` | M4 — Research Auditor | Research evidence package: Tables A–F, Figures 1–5, 10-section paper outline, claims epistemology. | **PUBLISHED** |
| **D6** | `docs/release-evidence-index.md` | M4 — Research Auditor | Master Release Evidence Index: cryptographic inventory of all 35 campaign artifacts, 5 UI screenshots, git state, deliverable crosswalk. | **PUBLISHED** |

### Traceability Crosswalk: Requirements R1–R5 & Tests 01–20

| Requirement Category | Test Identifier & Title | Milestone | Primary Evidentiary Deliverable | Test Execution Command & Artifact Path | Recorded Status |
|---|---|---|---|---|---|
| **R1 (Architecture & Contracts)** | **Test 01:** Modular Monolith Architecture Conformance | M3 | `docs/final-release-audit.md` | Static code inspection: modular separation across `src/slokern/`, zero new dependencies | **PASS** |
| **R1 (Architecture & Contracts)** | **Test 02:** Git Working Tree State & Safety Invariant | M3 | `docs/final-release-audit.md` | `git status --short`, zero unapproved git modifications | **PASS** |
| **R1 (Architecture & Contracts)** | **Test 03:** Pydantic v2 Contract Schema Validation | M3 | `docs/final-release-audit.md` | `.venv\Scripts\pytest.exe tests/contract/test_fixtures_validate.py` (8 passed) | **PASS** |
| **R1 (Architecture & Contracts)** | **Test 10:** 2×2 Search Parameter Space Boundedness | M3 | `docs/final-release-audit.md` | `experiment_spec.json`, `tests/unit/core/search/test_grid.py` | **PASS** |
| **R1 (Architecture & Contracts)** | **Test 11:** Six-Run Campaign Budget Enforcement | M3 | `docs/final-release-audit.md` | `search_result.json` (`stopping_reason: space_exhausted`), 6 runs | **PASS** |
| **R2 (Measurement & Provenance)** | **Test 04:** Physical Raw JSONL Telemetry Validation | M1 | `docs/benchmark-integrity-report.md` | `.venv\Scripts\pytest.exe tests/contract/test_fixtures_validate.py` (8 passed) | **PASS** |
| **R2 (Measurement & Provenance)** | **Test 05:** Causal Monotonic Timestamps Audit | M1 | `docs/benchmark-integrity-report.md` | `test_conditional_timestamp_monotonicity` (sched $\le$ sent $\le$ first $\le$ comp) | **PASS** |
| **R2 (Measurement & Provenance)** | **Test 06:** Warm-Up Request Isolation Invariant | M1 | `docs/benchmark-integrity-report.md` | 1 warmup isolated, 3 active in `metrics.json` across all 6 runs | **PASS** |
| **R2 (Measurement & Provenance)** | **Test 07:** Generator Saturation & Dispatch Skew Detection | M1 | `docs/benchmark-integrity-report.md` | Run-01 & Run-02 queue lag (>10ms) $\to$ `CONTAMINATED` / `INCONCLUSIVE` | **PASS** |
| **R2 (Measurement & Provenance)** | **Test 19:** Qwen3 Reasoning Accounting & Token Parsing | M1 | `docs/benchmark-integrity-report.md` | SSE streaming `<think>` token parser; 128 tok/req correctly accounted | **PASS** |
| **R3 (Deterministic Decision)** | **Test 08:** Feasibility Evaluator Boundary Tests | M2 | `docs/independent-decision-audit.md` | `.venv\Scripts\pytest.exe tests/contract/test_verification_independence.py` | **PASS** |
| **R3 (Deterministic Decision)** | **Test 09:** State Domain Separation Invariants | M2 | `docs/independent-decision-audit.md` | Execution != Evidence != Feasibility != Verification state schemas | **PASS** |
| **R3 (Deterministic Decision)** | **Test 12:** Objective Candidate Selection & Tie-Breaking | M2 | `docs/independent-decision-audit.md` | Winner `95db015e9de9` selected (48 TPS > 24 TPS baseline); deterministic ID | **PASS** |
| **R3 (Deterministic Decision)** | **Test 13:** Independent Verification Rerun & Drift Analysis | M2 | `docs/independent-decision-audit.md` | Fresh run `run-verify-69a57759`, TTFT -0.99%, ITL -1.57%, TPS 0.0% ($\le 15\%$) | **PASS** |
| **R4 (Interface & Operations)** | **Test 14:** Live vLLM Serving Pipeline End-to-End Execution | M3/M5 | `docs/final-20-test-report.md` | `.venv\Scripts\python.exe -m pytest tests/integration/test_vllm_live.py -v -s` (4/4 passed in 25.60s, exit code 0) | **PASS** |
| **R4 (Interface & Operations)** | **Test 15:** Cross-Platform Setup Scripts Safety Validation | M3 | `docs/final-release-audit.md` | `setup.ps1`, `setup.sh`, `doctor.py` non-destructive checks | **PASS** |
| **R4 (Interface & Operations)** | **Test 16:** Cross-Interface Consistency (CLI, API, UI, Report) | M3 | `docs/final-release-audit.md` | Consistent candidate `95db015e9de9`, 48 tok/s, 2095ms TTFT across all layers | **PASS** |
| **R4 (Interface & Operations)** | **Test 17:** Unmistakable DEMO DATA Labelling | M3 | `docs/final-release-audit.md` | `DEMO DATA` banners on fake adapter/offline runs; `LIVE` badge on cmp-8a | **PASS** |
| **R4 (Interface & Operations)** | **Test 18:** Automated Secret Scanner & Zero Leaks | M3 | `docs/final-release-audit.md` | `python scripts/scan_secrets.py`: 3,537 files scanned, 0 leaks detected | **PASS** |
| **R5 (Research & Release)** | **Test 20:** Research Evidence Package & Master Release Docs | M4 & M5 | `docs/research-evidence-assessment.md`, `docs/release-evidence-index.md` | Tables A–F, Figures 1–5, Paper Outline, Defect Log, 6 Release Docs | **PASS** |

---

## 6. Verification Commands & Independent Reproducibility

To independently reproduce the cryptographic hashes and automated validations indexed in this report:

1. **Verify Cryptographic Checksums of all 35 Campaign Artifacts:**
   ```powershell
   Get-ChildItem -Path "artifacts/experiments/cmp-8a020d00" -Recurse -File | 
     Get-FileHash -Algorithm SHA256 | 
     Format-Table -Property Path, Hash -AutoSize
   ```
   *Expected Outcome:* Hashes must match the exact 64-character hex strings in Section 3.

2. **Verify Cryptographic Checksums of UI Acceptance Screenshots:**
   ```powershell
   Get-ChildItem -Path "artifacts/screenshots/ui-acceptance-cmp-8a020d00" -File | 
     Get-FileHash -Algorithm SHA256 | 
     Format-Table -Property Path, Hash -AutoSize
   ```
   *Expected Outcome:* Hashes must match the exact 64-character hex strings in Section 4.

3. **Execute Contract Schema Validation Test Suite:**
   ```powershell
   .venv\Scripts\pytest.exe tests/contract/test_fixtures_validate.py -v
   ```
   *Expected Outcome:* 8 of 8 contract tests PASS in $< 0.5\text{ s}$.

4. **Execute Independent Verification and Decision Correctness Test Suite:**
   ```powershell
   .venv\Scripts\pytest.exe tests/contract/test_verification_independence.py -v
   ```
   *Expected Outcome:* 17 of 17 contract tests PASS in $< 0.5\text{ s}$.

5. **Verify Clean Git Working Tree State:**
   ```powershell
   git rev-parse HEAD
   git status --short
   ```
   *Expected Outcome:* HEAD commit is `56348ecc7d3bf2a43cd40f186286a12dbc21bdd4`, branch is `main`, zero destructive modifications.
