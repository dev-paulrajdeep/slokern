# Project: SLOKern Branch Reconciliation & End-to-End Verification

## Architecture
- Bounded 2×2 Search Space Matrix (`src/slokern/core/search/space.py`)
- Total Experiment Budget & Preflight Validator (`src/slokern/core/search/budget.py`)
- Deterministic Grid Search Controller (`src/slokern/core/search/grid.py`)
- Candidate ID Normalization & Strict Ranking Engine (`src/slokern/core/search/candidate_id.py`, `rank.py`)
- Serving Adapters: Production `NebiusServingAdapter` and Synthetic `FakeServingAdapter` (`src/slokern/engine/serving/`)
- Single Run Executor & Load Generator Runner (`src/slokern/engine/runner/`, `src/slokern/engine/loadgen/`)
- Independent Verification Runner (`src/slokern/core/verification/`)
- Report Generator & Artifact Publisher (`src/slokern/engine/reporting/`)

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Budget Preflight & Runtime Invariant | `validate_budget` preflight + 6-run `BudgetLimiter` runtime enforcement | M1 | Survey R1 |
| 2 | Strict Candidate Ranking & Tie-Breaking | Exclude None/NaN/Inf/bool/string/negative; sort feasible by objective; tie-break by candidate_id | M1 | Survey R1 |
| 3 | Dual Entrypoint Grid Search Controller | Support `run(spec)` and `execute(...)` using `BudgetLimiter` | M1 | Survey R1 |
| 4 | Serving Adapters & Circular Import Decoupling | Production `NebiusServingAdapter` + `NebiusCloudAdapter` alias + `FakeServingAdapter` deferred candidate ID import | M1 | Survey R1 |
| 5 | Honest Documentation Synchronization | Sync `README.md`, `ROADMAP.md`, `docs/implementation-status.md`, `docs/ownership.md` with true sprint status | M2 | Survey R1 |
| 6 | Contract Generation Parity Check | `scripts/gen_contracts.py --check` confirms 11 schemas match Pydantic models | M3 | Survey R2 |
| 7 | Deterministic Test Suite Integrity | `pytest tests/contract tests/unit tests/live` passes 100% without regression | M3 | Survey R2 |
| 8 | Daksh Verification Independence Contract | `tests/contract/test_verification_independence.py` passes 16/16 without scope violations | M3 | Survey R2 |
| 9 | 2×2 Grid Search E2E Execution | Execute 5 runs (Run 0 baseline + Runs 1-4 candidates) with FakeServingAdapter labeled DEMO DATA | M4 | Survey R3 |
| 10 | Independent Verification Execution | Run 6 executed with fresh verification run ID, drift calculation, and feasibility overrule check | M4 | Survey R3 |
| 11 | Evidence-Backed Report Generation | `report.json` (validating ReportArtifact) and readable `report.md` with DEMO DATA labels | M4 | Survey R3 |
| 12 | Multi-Agent Audit & Review Gate | 2 Reviewers APPROVE, 2 Challengers APPROVE, 1 Forensic Auditor CLEAN | M5 | Survey R1-R3 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Code Reconciliation & Subsystem Invariants | `budget.py`, `rank.py`, `grid.py`, `fake.py`, `nebius.py`, test files | none | DONE |
| M2 | Documentation Synchronization & Honesty | `README.md`, `ROADMAP.md`, `docs/implementation-status.md`, `docs/ownership.md` | none | DONE |
| M3 | Contract Generation & Test Suite Verification | `gen_contracts.py --check`, `pytest tests/contract tests/unit` | M1, M2 | IN_PROGRESS |
| M4 | E2E Pipeline & Verification Execution | 2x2 grid search, independent verification, reporting, schema validation | M3 | PLANNED |
| M5 | Multi-Agent Audit & Review Gate | Reviewers, Challengers, Forensic Auditor, final handoff | M4 | PLANNED |

## Interface Contracts
### Budget Invariants (`budget.py`)
- `validate_budget(spec: ExperimentSpec) -> None` (raises `BudgetValidationError`)
- `BudgetLimiter(max_total_runs=6, max_search_runs=5, max_verification_runs=1)`
- `record_search_run() -> None` (raises `BudgetExhaustedError` on run 6)
- `record_verification_run() -> None` (raises `BudgetExhaustedError`)

### Candidate Ranking (`rank.py`)
- `rank_candidates(evaluated_candidates: List[EvaluatedCandidate], objective: RankingObjective) -> List[EvaluatedCandidate]`
- Rejects non-feasible, None, NaN, inf, boolean, string, negative values
- Deterministic secondary sort by `candidate_id`

### Serving Adapters (`fake.py`, `nebius.py`)
- Deferred import `generate_candidate_id` in `apply_config()`
- `NebiusCloudAdapter = NebiusServingAdapter`
- All outputs and metadata strictly labeled `DEMO DATA`

## Code Layout
- `src/slokern/core/search/`: space.py, budget.py, grid.py, candidate_id.py, rank.py
- `src/slokern/engine/serving/`: base.py, capabilities.py, fake.py, nebius.py
- `src/slokern/contracts/`: 11 Pydantic v2 schemas in `spec.py`, `search.py`, `config.py`, `evidence.py`, `metrics.py`, `feasibility.py`, `run.py`, `verification.py`, `report.py`, `workload.py`, `enums.py`
- `tests/unit/core/search/`: test_space.py, test_budget.py, test_grid.py
- `tests/unit/core/`: test_ranker_validation.py, test_grid_search_fake_adapter.py
- `tests/unit/engine/serving/`: test_nebius.py, test_fake.py
- `tests/contract/`: test_schemas.py, test_schema_roundtrip.py, test_verification_independence.py
- `artifacts/experiments/<experiment_id>/`: search_result.json, run-xx/, verification/, report.json, report.md
