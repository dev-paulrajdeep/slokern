"""
Purpose: Artifact directory layout and path rules.
Owner: Rajdeep
Authority: Aligned with AGENTS.md Section 4, 14 and DEC-0014
"""

from pathlib import Path
from typing import Union


def get_campaign_dir(base_dir: Union[str, Path], campaign_id: str) -> Path:
    """Returns canonical campaign artifact directory."""
    return Path(base_dir) / "runs" / campaign_id


def get_run_trace_path(base_dir: Union[str, Path], campaign_id: str, run_id: str) -> Path:
    """Returns canonical file path for an individual search run's raw JSONL trace."""
    return get_campaign_dir(base_dir, campaign_id) / f"{run_id}.jsonl"


def get_verification_trace_path(base_dir: Union[str, Path], campaign_id: str, verification_run_id: str) -> Path:
    """Returns canonical file path for an independent verification run's raw JSONL trace."""
    return get_campaign_dir(base_dir, campaign_id) / f"verification_{verification_run_id}.jsonl"


def get_manifest_path(base_dir: Union[str, Path], campaign_id: str) -> Path:
    """Returns canonical file path for the campaign manifest JSON."""
    return get_campaign_dir(base_dir, campaign_id) / "manifest.json"


def get_report_path(base_dir: Union[str, Path], campaign_id: str) -> Path:
    """Returns canonical file path for the human-readable summary report."""
    return get_campaign_dir(base_dir, campaign_id) / "report.md"
