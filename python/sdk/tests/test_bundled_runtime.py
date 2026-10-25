"""Keyless boot tests for the production exe and development node carrier.

Each carrier skips independently when absent. The dummy API key only satisfies
adapter loading; initialize and shutdown do not call a model.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from codefusion import CodeFusion, HarnessClient, HarnessConfig
from codefusion.errors import TransportClosedError
from codefusion_runtime import resolve_bundled_launch_args

_MODES = ("exe", "node")
_REPO_ROOT = Path(__file__).parents[3]
_MINIMAL_CONFIG = _REPO_ROOT / "examples" / "jsonrpc-agent" / "minimal.cordis.yml"

# The config must include the JSON-RPC serving plugin.
_CORDIS_YML = """\
- id: sdk-jsonrpc-server
  name: '@origin-ai/cf-sdk-jsonrpc-server'
- id: agent-core
  name: '@origin-ai/cf-agent-spine-demo'
  config:
    workspaceContext: false
- id: sessions
  name: '@origin-ai/cf-session-persistence-jsonl'
  config:
    root: './sessions'
- id: session-checkpoints
  name: '@origin-ai/cf-session-checkpoint-policy'
- id: subprocess
  name: '@origin-ai/cf-subprocess-local'
- id: bash
  name: '@origin-ai/cf-bash-local'
  config:
    cwd: '.'
- id: todo
  name: '@origin-ai/cf-tool-todo'
  config:
    allowParallelInProgress: true
"""


def _launch_args(mode: str) -> tuple[str, ...]:
    try:
        return resolve_bundled_launch_args(mode)
    except FileNotFoundError as exc:
        pytest.skip(f"bundled {mode}-mode runtime unavailable on this machine: {exc}")


def _client(tmp_path: Path, launch_args: tuple[str, ...]) -> HarnessClient:
    return HarnessClient(
        HarnessConfig(
            launch_args_override=launch_args,
            cwd=str(tmp_path),
            env={
                "CF_CORDIS_CONFIG": "./cordis.yml",
                "CF_SESSION_ROOT": str(tmp_path / "sessions"),
                "CF_CWD": str(tmp_path),
                # The lazily mounted adapter requires a key even without a model call.
                "DEEPSEEK_API_KEY": "sk-dummy-for-boot",
                "DEEPSEEK_BASE_URL": "http://127.0.0.1:9",
            },
            request_timeout_seconds=120,
        )
    )


@pytest.mark.parametrize("mode", _MODES)
def test_bundled_runtime_boots_a_cordis_config(tmp_path: Path, mode: str) -> None:
    launch_args = _launch_args(mode)
    (tmp_path / "cordis.yml").write_text(_CORDIS_YML)

    with _client(tmp_path, launch_args) as client:
        init = client.initialize(provider="deepseek-official", cwd=str(tmp_path), model="deepseek-v4-pro")

    assert init.serverInfo is not None
    assert init.serverInfo.name == "cf-sdk-runtime"


@pytest.mark.parametrize("mode", _MODES)
def test_python_sdk_boots_minimal_jsonrpc_config(tmp_path: Path, mode: str) -> None:
    launch_args = _launch_args(mode)
    model = "minimal-environment-model"
    harness = CodeFusion(
        model=model,
        cwd=str(tmp_path),
        session_root=str(tmp_path / "sessions"),
        cordis=str(_MINIMAL_CONFIG),
        env={
            "CF_MODEL": model,
            "CF_CONTEXT_WINDOW": "1000000",
            "CF_SYSTEM_PROMPT": "You are the Python SDK minimal boot test agent.",
        },
        api_key="sk-dummy-for-boot",
        base_url="http://127.0.0.1:9",
        launch_args_override=launch_args,
        request_timeout_seconds=120,
    )

    with harness:
        pass


@pytest.mark.parametrize("mode", _MODES)
def test_bundled_runtime_surfaces_unbundled_plugin_failure(tmp_path: Path, mode: str) -> None:
    launch_args = _launch_args(mode)
    (tmp_path / "cordis.yml").write_text(
        "- id: missing\n  name: '@origin-ai/cf-does-not-exist'\n"
    )

    client = _client(tmp_path, launch_args)
    client.start()
    try:
        with pytest.raises((TransportClosedError, TimeoutError)) as excinfo:
            client.initialize(provider="deepseek-official", cwd=str(tmp_path), model="deepseek-v4-pro")
    finally:
        client.close()

    assert "@origin-ai/cf-does-not-exist" in str(excinfo.value)


@pytest.mark.parametrize("mode", _MODES)
@pytest.mark.parametrize("ambient_config", [None, ""], ids=["unset", "empty-counts-as-absent"])
def test_zero_config_run_injects_bundled_default_cordis_config(
    tmp_path: Path, mode: str, ambient_config: str | None, monkeypatch: pytest.MonkeyPatch
) -> None:
    _launch_args(mode)  # skip early when this carrier is unavailable
    monkeypatch.setenv("CF_RUNTIME_MODE", mode)
    if ambient_config is None:
        monkeypatch.delenv("CF_CORDIS_CONFIG", raising=False)
    else:
        monkeypatch.setenv("CF_CORDIS_CONFIG", ambient_config)

    harness = CodeFusion(
        model="deepseek-v4-pro",
        cwd=str(tmp_path),
        session_root=str(tmp_path / "sessions"),
        api_key="sk-dummy-for-boot",
        base_url="http://127.0.0.1:9",
        request_timeout_seconds=120,
    )
    with harness:
        pass
