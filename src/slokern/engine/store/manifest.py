"""
Purpose: Manifest model and serialization for reproducible experiment artifact packages.
Owner: Rajdeep
Authority: Aligned with AGENTS.md Section 4, 14 and DEC-0014
"""

import hashlib
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Union


def compute_file_sha256(file_path: Union[str, Path]) -> str:
    """Computes SHA-256 hash digest of a file on disk."""
    p = Path(file_path)
    if not p.is_file():
        raise FileNotFoundError(f"Cannot compute sha256: file '{file_path}' does not exist.")
    hasher = hashlib.sha256()
    with open(p, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def build_campaign_manifest(
    campaign_id: str,
    workload_spec: Dict[str, Any],
    slo_spec: Dict[str, Any],
    candidate_history: List[Dict[str, Any]],
    winning_candidate: Optional[Dict[str, Any]] = None,
    verification_record: Optional[Dict[str, Any]] = None,
    artifact_files: Optional[Dict[str, str]] = None,
    extra_metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Constructs canonical manifest dictionary capturing campaign specification,
    candidate evaluations, verification outcome, and artifact hashes.
    """
    manifest = {
        "manifest_version": "1.0",
        "campaign_id": campaign_id,
        "created_at": time.time(),
        "workload_spec": workload_spec,
        "slo_spec": slo_spec,
        "search_summary": {
            "total_candidates_evaluated": len(candidate_history),
            "winning_candidate_id": winning_candidate.get("candidate_id") if winning_candidate else None,
            "has_feasible_winner": winning_candidate is not None,
        },
        "candidate_history": candidate_history,
        "winning_candidate": winning_candidate,
        "verification_record": verification_record,
        "artifact_hashes": artifact_files or {},
        "metadata": extra_metadata or {},
    }
    return manifest
