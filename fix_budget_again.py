with open("src/slokern/core/search/budget.py", "r") as f:
    text = f.read()

text = text.replace('f"max_candidates must be >= 1, got {spec.budget.max_candidates}"', 'f"budget.max_candidates must be >= 1, got {spec.budget.max_candidates}"')
text = text.replace('f"verification_policy.repetitions must be >= 1, got {spec.verification_policy.repetitions}"', 'f"budget.verification_policy.repetitions must be >= 1, got {spec.verification_policy.repetitions}"')

with open("src/slokern/core/search/budget.py", "w") as f:
    f.write(text)

with open("tests/unit/core/search/test_budget.py", "r") as f:
    text = f.read()
text = text.replace('match="max_candidates must be >= 1"', 'match="budget.max_candidates must be >= 1"')
text = text.replace('match="repetitions must be >= 1"', 'match="budget.verification_policy.repetitions must be >= 1"')
with open("tests/unit/core/search/test_budget.py", "w") as f:
    f.write(text)
