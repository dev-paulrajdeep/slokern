"""
Purpose: 2x2 Bounded grid search controller and candidate exploration orchestrator.
Owner: Rajdeep (Historical design: Rohan)
Authority: Aligned with AGENTS.md Section 1, 3, 5, 6, and ROADMAP.md TASK-10
"""

from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional, Union, Any, TYPE_CHECKING

from slokern.contracts.config import CandidateConfig
from slokern.contracts.enums import FeasibilityVerdict, RankingObjective
from slokern.contracts.metrics import MetricSet
from slokern.contracts.search import CandidateSummary, SearchResult
from slokern.contracts.spec import ExperimentSpec, SLOSpec, WorkloadSpec
from slokern.core.search.budget import BudgetLimiter
from slokern.core.search.rank import EvaluatedCandidate, rank_candidates
from slokern.core.search.space import generate_2x2_candidates
from slokern.engine.serving.base import BaseServingAdapter

if TYPE_CHECKING:
    from slokern.engine.runner.cancel import CancellationToken
    from slokern.engine.runner.run_executor import SingleRunExecutor, SingleRunResult


def extract_ranking_metric(
    metric_set: Optional[MetricSet],
    objective: RankingObjective
) -> Optional[float]:
    """
    Extracts the scalar ranking metric from a MetricSet according to the declared objective.
    Returns None if metric_set is None or the target metric is unavailable.
    """
    if metric_set is None:
        return None

    if objective == RankingObjective.MAX_THROUGHPUT_UNDER_SLO:
        # Prefer output token throughput; fallback to request throughput
        if metric_set.token_throughput_tps > 0:
            return round(metric_set.token_throughput_tps, 4)
        return round(metric_set.request_throughput_rps, 4)

    elif objective == RankingObjective.GPU_SECONDS_PER_REQUEST:
        # Mode B proxy: mean end-to-end request duration converted to seconds
        if metric_set.e2e_latency_ms and metric_set.e2e_latency_ms.mean is not None:
            return round(metric_set.e2e_latency_ms.mean / 1000.0, 6)
        if metric_set.request_throughput_rps > 0:
            return round(1.0 / metric_set.request_throughput_rps, 6)
        return None

    elif objective == RankingObjective.MONETARY_COST_PER_TOKEN:
        cost = metric_set.metadata.get("cost_per_token")
        if cost is not None:
            return float(cost)
        if metric_set.token_throughput_tps > 0:
            return round(1.0 / metric_set.token_throughput_tps, 6)
        return None

    elif objective == RankingObjective.MONETARY_COST_PER_1K_REQUESTS:
        cost = metric_set.metadata.get("cost_per_1k_requests")
        if cost is not None:
            return float(cost)
        if metric_set.request_throughput_rps > 0:
            return round(1000.0 / metric_set.request_throughput_rps, 6)
        return None

    return None


class GridSearchController:
    """
    Orchestrates the 2x2 bounded parameter grid search campaign:
    1. Executes Run 0: baseline candidate configuration.
    2. Generates the 4 canonical grid candidates across the 2x2 space:
       max_num_batched_tokens in {1024, 2048} x max_num_seqs in {16, 64}.
    3. Executes Runs 1-4: each candidate benchmarked via SingleRunExecutor.
    4. Evaluates feasibility, ranks candidates deterministically under the declared objective.
    5. Selects the winning feasible candidate and persists canonical SearchResult contract.
    Uses the default budget allocation to stop search after 5 runs. The injected
    BudgetLimiter is configurable; its invariant is not currently strict for every
    accepted constructor configuration (see BLK-15). This controller does not run
    the independent verification reserved by the default sixth-run allocation.
    """

    def __init__(
        self,
        single_run_executor: Optional["SingleRunExecutor"] = None,
        artifacts_root: Union[str, Path] = "artifacts",
        default_objective: RankingObjective = RankingObjective.GPU_SECONDS_PER_REQUEST,
        isolate_process: bool = False,
    ) -> None:
        self.artifacts_root = Path(artifacts_root)
        self.default_objective = default_objective
        if single_run_executor is None:
            from slokern.engine.runner.run_executor import SingleRunExecutor
            self.single_run_executor = SingleRunExecutor(
                artifacts_root=self.artifacts_root,
                isolate_process=isolate_process,
            )
        else:
            self.single_run_executor = single_run_executor

    def execute(
        self,
        baseline_config: CandidateConfig,
        workload: Optional[WorkloadSpec] = None,
        slo: Optional[SLOSpec] = None,
        experiment_id: str = "exp-default",
        experiment_spec: Optional[ExperimentSpec] = None,
        ranking_objective: Optional[RankingObjective] = None,
        serving_adapter: Optional[BaseServingAdapter] = None,
        cancellation_token: Optional[CancellationToken] = None,
        budget_limiter: Optional[BudgetLimiter] = None,
        output_dir: Optional[Union[str, Path]] = None,
        seed: Optional[int] = 42,
        stream: bool = True,
        prompts: Optional[Union[List[str], str]] = None,
        strict_config: bool = True,
    ) -> SearchResult:
        """
        Executes the bounded 2x2 grid search campaign.

        Args:
            baseline_config: Configuration for Run 0 baseline.
            workload: Workload profile (can be omitted if experiment_spec provided).
            slo: Hard SLO constraints (can be omitted if experiment_spec provided).
            experiment_id: Unique experiment session identifier.
            experiment_spec: Optional complete ExperimentSpec root document.
            ranking_objective: Declared optimization objective for candidate ranking.
            serving_adapter: Serving adapter to use for inference benchmark runs.
            cancellation_token: Optional token for cooperative cancellation.
            budget_limiter: Optional budget tracker (defaults to standard 6-run budget).
            output_dir: Custom output directory for search_result.json.
            seed: Arrival generation seed.
            stream: Whether to stream generation tokens.
            prompts: Benchmark prompts.
            strict_config: Whether to reject unsupported runtime settings.

        Returns:
            SearchResult canonical contract model.
        """
        # 1. Resolve specs and parameters
        resolved_experiment_id = (
            experiment_spec.experiment_id if experiment_spec else experiment_id
        )
        resolved_workload = (
            experiment_spec.workload if experiment_spec else workload
        )
        resolved_slo = (
            experiment_spec.slo if experiment_spec else slo
        )

        if resolved_workload is None or resolved_slo is None:
            raise ValueError(
                "Both workload (WorkloadSpec) and slo (SLOSpec) must be provided "
                "directly or via experiment_spec."
            )

        objective = ranking_objective or self.default_objective
        budget = budget_limiter or BudgetLimiter(
            max_total_runs=6,
            max_search_runs=5,
            max_verification_runs=1,
        )

        resolved_output_dir = (
            Path(output_dir)
            if output_dir
            else self.artifacts_root / "experiments" / resolved_experiment_id
        )
        resolved_output_dir.mkdir(parents=True, exist_ok=True)

        tested_candidates: List[str] = []
        candidate_summaries: Dict[str, CandidateSummary] = {}
        evaluated_candidates: List[EvaluatedCandidate] = []
        run_results: List[SingleRunResult] = []

        is_cancelled = False

        # 2. Run 0: Baseline execution
        if cancellation_token and cancellation_token.is_cancelled:
            is_cancelled = True
        elif budget.can_execute_search_run():
            baseline_run_id = f"run-00-baseline-{baseline_config.candidate_id[:6]}"
            budget.record_search_run()

            baseline_res = self.single_run_executor.execute(
                candidate_config=baseline_config,
                workload=resolved_workload,
                slo=resolved_slo,
                experiment_id=resolved_experiment_id,
                run_id=baseline_run_id,
                is_verification_run=False,
                adapter=serving_adapter,
                cancellation_token=cancellation_token,
                seed=seed,
                stream=stream,
                prompts=prompts,
                raise_on_failure=False,
            )
            run_results.append(baseline_res)
            tested_candidates.append(baseline_config.candidate_id)

            verdict = (
                baseline_res.feasibility_result.overall_verdict
                if baseline_res.feasibility_result
                else FeasibilityVerdict.INCONCLUSIVE
            )
            metric_val = extract_ranking_metric(baseline_res.metric_set, objective)

            candidate_summaries[baseline_config.candidate_id] = CandidateSummary(
                verdict=verdict,
                ranking_metric=metric_val,
            )

            if baseline_res.metric_set is not None:
                evaluated_candidates.append(
                    EvaluatedCandidate(
                        candidate_id=baseline_config.candidate_id,
                        verdict=verdict,
                        ranking_metric=metric_val,
                        metric_set=baseline_res.metric_set,
                    )
                )

            if cancellation_token and cancellation_token.is_cancelled:
                is_cancelled = True

        # 3. Generate 4 Search Candidates across 2x2 grid
        grid_candidates = generate_2x2_candidates(
            model_name=baseline_config.model_name,
            runtime_name=baseline_config.runtime_name,
        )

        all_grid_completed = True

        # 4. Runs 1-4: Candidate Search
        for idx, candidate in enumerate(grid_candidates, start=1):
            if is_cancelled or (cancellation_token and cancellation_token.is_cancelled):
                is_cancelled = True
                all_grid_completed = False
                break

            if not budget.can_execute_search_run():
                all_grid_completed = False
                break

            run_id = f"run-{idx:02d}-cand-{candidate.candidate_id[:6]}"
            budget.record_search_run()

            run_res = self.single_run_executor.execute(
                candidate_config=candidate,
                workload=resolved_workload,
                slo=resolved_slo,
                experiment_id=resolved_experiment_id,
                run_id=run_id,
                is_verification_run=False,
                adapter=serving_adapter,
                cancellation_token=cancellation_token,
                seed=seed,
                stream=stream,
                prompts=prompts,
                raise_on_failure=False,
            )
            run_results.append(run_res)

            if candidate.candidate_id not in tested_candidates:
                tested_candidates.append(candidate.candidate_id)

            verdict = (
                run_res.feasibility_result.overall_verdict
                if run_res.feasibility_result
                else FeasibilityVerdict.INCONCLUSIVE
            )
            metric_val = extract_ranking_metric(run_res.metric_set, objective)

            candidate_summaries[candidate.candidate_id] = CandidateSummary(
                verdict=verdict,
                ranking_metric=metric_val,
            )

            if run_res.metric_set is not None:
                evaluated_candidates.append(
                    EvaluatedCandidate(
                        candidate_id=candidate.candidate_id,
                        verdict=verdict,
                        ranking_metric=metric_val,
                        metric_set=run_res.metric_set,
                    )
                )

            if cancellation_token and cancellation_token.is_cancelled:
                is_cancelled = True
                all_grid_completed = False
                break

        # 5. Filter and Rank Feasible Candidates
        ranked_feasible = rank_candidates(evaluated_candidates, objective)

        # 6. Select Winner and Justify
        if ranked_feasible:
            winner = ranked_feasible[0]
            selected_candidate_id = winner.candidate_id
            selection_rationale = (
                f"Selected candidate '{selected_candidate_id}' as top-ranked feasible "
                f"configuration under objective '{objective.value}' with "
                f"ranking metric {winner.ranking_metric}."
            )
        else:
            selected_candidate_id = None
            selection_rationale = (
                f"No candidate among {len(tested_candidates)} tested configurations "
                f"satisfied all declared hard SLO constraints."
            )

        # 7. Determine Canonical Stopping Reason
        stopping_reason = budget.get_stopping_reason(
            space_exhausted=all_grid_completed,
            cancelled=is_cancelled,
        )

        # 8. Build Canonical SearchResult
        result = SearchResult(
            experiment_id=resolved_experiment_id,
            baseline_candidate_id=baseline_config.candidate_id,
            tested_candidates=tested_candidates,
            candidate_summaries=candidate_summaries,
            ranking_objective=objective,
            selected_candidate_id=selected_candidate_id,
            selection_rationale=selection_rationale,
            stopping_reason=stopping_reason,
        )

        # 9. Persist search_result.json to disk atomically
        result_path = resolved_output_dir / "search_result.json"
        result_path.write_text(result.model_dump_json(indent=2), encoding="utf-8")

        return result
