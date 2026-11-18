"""
Purpose: Loads and validates versioned workload prompt fixtures.
Owner: Rajdeep (Historical design: Adriraj)
Authority: Aligned with AGENTS.md Section 4, 10, 13
"""

import json
from pathlib import Path
from typing import List, Optional, Union

from slokern.contracts.spec import WorkloadSpec


def get_fixtures_workload_dir() -> Path:
    """Returns canonical directory path for workload fixtures."""
    return Path(__file__).resolve().parents[4] / "fixtures" / "workloads"


def list_workload_fixtures(dir_path: Optional[Union[str, Path]] = None) -> List[Path]:
    """Returns list of JSON workload fixture paths."""
    base_dir = Path(dir_path) if dir_path else get_fixtures_workload_dir()
    if not base_dir.is_dir():
        return []
    return sorted(list(base_dir.glob("*.json")))


def load_workload_spec_from_file(file_path: Union[str, Path]) -> WorkloadSpec:
    """Loads and validates a WorkloadSpec from a JSON file."""
    path = Path(file_path)
    if not path.is_file():
        raise FileNotFoundError(f"Workload fixture file does not exist: {file_path}")

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    return WorkloadSpec.model_validate(data)
