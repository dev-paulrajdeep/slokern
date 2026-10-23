# Project: SLOKern TASK-09 & TASK-10 Audit & Verification

## Architecture
- Bounded 2×2 Search Space (`src/slokern/core/search/space.py`)
- Total Experiment & Search Budget Limiter (`src/slokern/core/search/budget.py`)
- Deterministic Grid Search Controller (`src/slokern/core/search/grid.py`)
- Candidate ID Normalization & Ranking Engine (`src/slokern/core/search/candidate_id.py`, `rank.py`)
- Search Contracts & Artifact Validation (`src/slokern/contracts/search.py`)
- OpenAI-compatible Nebius vLLM Serving Adapter (`src/slokern/engine/serving/nebius.py`)
- Offline Preflight Smoke Testing Probe (`tests/live/test_smoke_live.py`)

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | 2×2 Search Space Matrix | Exactly 4 distinct legal candidates across {1024, 2048} x {16, 64} | M1 | Survey R1 |
| 2 | Canonical Candidate IDs | SHA-256 normalized hash of model, runtime, and sorted settings | M1 | Survey R1 |
| 3 | 6-Run Budget Invariant | 1 baseline + 4 search candidates = 5 search runs max; 1 reserved for verification; BudgetExhaustedError on run 6 | M1 | Survey R1 |
| 4 | Grid Search Controller | Run 0 baseline + Runs 1-4 candidate search via SingleRunExecutor | M2 | Survey R2 |
| 5 | Feasibility Filtering & Deterministic Ranking | Infeasible excluded; deterministic ranking by Mode A/B objective with candidate_id tie-breaking | M2 | Survey R2 |
| 6 | Zero-Feasible Graceful Fallback | selected_candidate_id=None, stopping_reason='space_exhausted' | M2 | Survey R2 |
| 7 | SearchResult Schema Validation | Pydantic v2 SearchResult with extra='forbid' written to search_result.json | M2 | Survey R2 |
| 8 | Nebius vLLM Adapter | OpenAI-compatible adapter using standard library urllib without unapproved dependencies | M3 | Survey R3 |
| 9 | Secret Masking & Redaction | NEBIUS_API_KEY and Bearer tokens redacted across all errors/exceptions | M3 | Survey R3 |
| 10 | Offline Live Probe Skipping | test_smoke_live.py skips cleanly with actionable instructions when NEBIUS_API_KEY unset (BLK-04) | M3 | Survey R3 |
| 11 | Contract & Build Consistency | gen_contracts.py confirms 11 schemas up to date; compileall & pip check pass with 0 errors | M4 | Survey R4 |
| 12 | Regression Test Suite Integrity | All 356 tests collected with 0 errors; all targeted suites pass with 0 failures | M4 | Survey R4 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Search Space & Budget Invariant | space.py, candidate_id.py, budget.py | none | DONE |
| M2 | Grid Search Controller & Ranking | grid.py, rank.py, contracts/search.py | M1 | DONE |
| M3 | Nebius Serving Adapter & Security | nebius.py, test_smoke_live.py, docs/deployment.md | none | DONE |
| M4 | Contract & Regression Test Suite | scripts/gen_contracts.py, targeted test suites | M1, M2, M3 | DONE |

## Interface Contracts
### Space & Budget Invariant
- `generate_2x2_candidates(model_name: str, runtime_name: str) -> List[CandidateConfig]`
- `BudgetLimiter.can_execute_search_run() -> bool`
- `BudgetLimiter.record_search_run() -> None` (raises `BudgetExhaustedError`)

### Grid Search & Contracts
- `GridSearchController.run_search() -> SearchResult` (and `.execute()`)
- `SearchResult` schema with `extra="forbid"`, written to `artifacts/experiments/<experiment_id>/search_result.json`

### Serving Adapter & Security
- `NebiusServingAdapter(model_name, api_key, base_url)` implementing `BaseServingAdapter` via standard `urllib`
- `sanitize_secret_message(message: str, secret_key: Optional[str] = None) -> str`

## Code Layout
- `src/slokern/core/search/`: space.py, budget.py, grid.py, candidate_id.py, rank.py
- `src/slokern/contracts/`: search.py, config.py, enums.py, spec.py
- `src/slokern/engine/serving/`: nebius.py, base.py, capabilities.py, fake.py
- `tests/unit/core/search/`: test_space.py, test_budget.py, test_grid.py
- `tests/unit/engine/serving/`: test_nebius.py
- `tests/contract/`: test_schemas.py, test_schema_roundtrip.py, test_verification_independence.py
- `tests/live/`: test_smoke_live.py
