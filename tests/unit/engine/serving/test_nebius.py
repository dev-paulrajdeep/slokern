import pytest
from slokern.contracts.config import CandidateConfig
from slokern.engine.serving.nebius import NebiusCloudAdapter

# flake8: noqa: E501,F401,F811,E402,E302,E305,W293
from slokern.engine.serving.base import ConfigurationError


def test_nebius_adapter_rejects_engine_settings():
    adapter = NebiusCloudAdapter("meta-llama/Meta-Llama-3-8B-Instruct", "nebius")
    config = CandidateConfig(
        candidate_id="c1",
        model_name="meta-llama/Meta-Llama-3-8B-Instruct",
        runtime_name="nebius",
        requested_settings={"tensor_parallel_size": 2},
        effective_settings={},
        parameter_status={},
        environment_fingerprint={},
    )

    with pytest.raises(
        ConfigurationError, match="unsupported=\\['tensor_parallel_size'\\]"
    ):
        adapter.apply_config(config)


def test_nebius_adapter_accepts_client_settings():
    adapter = NebiusCloudAdapter("meta-llama/Meta-Llama-3-8B-Instruct", "nebius")
    config = CandidateConfig(
        candidate_id="c1",
        model_name="meta-llama/Meta-Llama-3-8B-Instruct",
        runtime_name="nebius",
        requested_settings={"max_tokens": 100},
        effective_settings={},
        parameter_status={},
        environment_fingerprint={},
    )

    applied = adapter.apply_config(config)
    assert applied.effective_settings["max_tokens"] == 100
