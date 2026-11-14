"""
Purpose: Command-line interface package.
Owner: Rajdeep
"""

# Deferred import: importing slokern.cli.main eagerly here caused a
# RuntimeWarning when running `python -m slokern.cli.main` because Python
# would first execute __init__.py (importing main), then attempt to execute
# main.py again as __main__.  Public API is accessible via slokern.cli.main.
__all__ = ["main"]


def __getattr__(name: str) -> object:
    if name == "main":
        from slokern.cli.main import main as _main  # noqa: PLC0415
        return _main
    raise AttributeError(f"module 'slokern.cli' has no attribute {name!r}")
