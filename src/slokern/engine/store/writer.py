"""
Purpose: Safe artifact writers (JSONL traces, manifest, reports) with directory creation and secret redaction.
Owner: Rajdeep
Authority: Aligned with AGENTS.md Section 4, 12, 14 and DEC-0014
"""

import json
from pathlib import Path
from typing import Any, Dict, List, Union

from slokern.engine.store.redact import sanitize_secret_message


def write_jsonl_trace(
    file_path: Union[str, Path],
    records: List[Dict[str, Any]],
    secret_key: str = None,
) -> Path:
    """
    Writes raw measurement records to a line-delimited JSONL file.
    Ensures parent directories exist and redacts any secret tokens.
    """
    path = Path(file_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    with open(path, "w", encoding="utf-8") as f:
        for record in records:
            serialized = json.dumps(record, default=str)
            serialized = sanitize_secret_message(serialized, secret_key=secret_key)
            f.write(serialized + "\n")
    return path


def write_manifest(file_path: Union[str, Path], manifest_data: Dict[str, Any]) -> Path:
    """Writes campaign manifest JSON with indentation."""
    path = Path(file_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    with open(path, "w", encoding="utf-8") as f:
        json.dump(manifest_data, f, indent=2, default=str)
    return path


def write_report(file_path: Union[str, Path], markdown_content: str) -> Path:
    """Writes human-readable Markdown summary report."""
    path = Path(file_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    with open(path, "w", encoding="utf-8") as f:
        f.write(markdown_content)
    return path
