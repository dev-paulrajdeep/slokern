import math
from typing import List, Optional
from dataclasses import dataclass

# flake8: noqa: E501,F401,F811,E402,E302,E305,W293

from slokern.contracts.enums import FeasibilityVerdict, RankingObjective
from slokern.contracts.metrics import MetricSet


@dataclass
class EvaluatedCandidate:
    candidate_id: str
    verdict: FeasibilityVerdict
    ranking_metric: Optional[float]
    metric_set: MetricSet


def rank_candidates(
    evaluated_candidates: List[EvaluatedCandidate], objective: RankingObjective
) -> List[EvaluatedCandidate]:
    """
    Filters feasible candidates, removes those with invalid objective evidence,
    and ranks them according to the given objective.
    Tie-breaking: if metric values are equal, sort by candidate_id to be deterministic.
    """
    eligible_candidates = []

    for c in evaluated_candidates:
        if c.verdict != FeasibilityVerdict.FEASIBLE:
            continue

        # Check if ranking_metric is valid (not None, NaN, Inf, and is numeric)
        val = c.ranking_metric
        if val is None or not isinstance(val, (int, float)) or not math.isfinite(val):
            # Objective ineligible
            continue

        eligible_candidates.append(c)

    if not eligible_candidates:
        return []

    # Determine sorting direction.
    minimize = objective in [
        RankingObjective.MONETARY_COST_PER_TOKEN,
        RankingObjective.MONETARY_COST_PER_1K_REQUESTS,
        RankingObjective.GPU_SECONDS_PER_REQUEST,
    ]

    eligible_candidates.sort(
        key=lambda c: (
            c.ranking_metric if minimize else -c.ranking_metric,
            c.candidate_id,
        )
    )

    return eligible_candidates
