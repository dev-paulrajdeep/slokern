with open("src/slokern/core/search/grid.py", "r") as f:
    text = f.read()

text = text.replace('        validate_budget(spec)\n        if spec.budget.max_cost_limit is not None:\n            raise BudgetValidationError(\n                "budget.max_cost_limit cannot be enforced without an authoritative "\n                "pricing source; no runs were started"\n            )\n        if ranking_objective != RankingObjective.MAX_THROUGHPUT_UNDER_SLO:\n            raise SearchConfigurationError(\n                "Only MAX_THROUGHPUT_UNDER_SLO is currently supported; monetary "\n                "pricing and GPU allocation are not verified"\n            )', '        if spec.budget.max_wallclock_seconds < 1:\n            raise BudgetValidationError("budget.max_wallclock_seconds must be >= 1")\n        validate_budget(spec)\n        if spec.budget.max_cost_limit is not None:\n            raise BudgetValidationError(\n                "budget.max_cost_limit cannot be enforced without an authoritative "\n                "pricing source; no runs were started"\n            )\n        if ranking_objective != RankingObjective.MAX_THROUGHPUT_UNDER_SLO:\n            raise SearchConfigurationError(\n                "Only MAX_THROUGHPUT_UNDER_SLO is currently supported; monetary "\n                "pricing and GPU allocation are not verified"\n            )')

with open("src/slokern/core/search/grid.py", "w") as f:
    f.write(text)

with open("src/slokern/core/search/budget.py", "r") as f:
    text = f.read()

text = text.replace('    if spec.budget.max_candidates < 1:', '    if spec.budget.max_wallclock_seconds < 1:\n        raise BudgetValidationError(f"budget.max_wallclock_seconds must be >= 1, got {spec.budget.max_wallclock_seconds}")\n    if spec.budget.max_candidates < 1:')

with open("src/slokern/core/search/budget.py", "w") as f:
    f.write(text)
