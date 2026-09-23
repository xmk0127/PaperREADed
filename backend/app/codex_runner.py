"""Run the user's local Codex CLI with ChatGPT login and no API-key fallback."""
import asyncio
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import sys
import tempfile
from typing import Dict, List, Optional, Tuple

from pydantic import ValidationError
from .models import AnalysisResult, CodexStatus
from .prompts import build_prompt

MIN_VERSION = (0, 155, 0)
MAX_OUTPUT_BYTES = 8 * 1024 * 1024
STATUS_TIMEOUT = 15
DISABLED_FEATURES = (
    "shell_tool", "unified_exec", "plugins", "hooks", "multi_agent", "multi_agent_v2",
    "browser_use", "browser_use_external", "computer_use", "code_mode", "code_mode_host",
    "skill_search", "view_image", "apps", "enable_mcp_apps", "remote_plugin",
    "image_generation", "in_app_browser", "memories", "workspace_dependencies",
    "skill_mcp_dependency_install", "unbounded_connection_retries",
)


class CodexError(RuntimeError):
    """Safe user-facing error. Never include raw CLI output or credentials."""


def _environment() -> Dict[str, str]:
    allowed = (
        "HOME", "PATH", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "USER", "LOGNAME",
        "CODEX_HOME", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
        "http_proxy", "https_proxy", "all_proxy", "no_proxy", "SSL_CERT_FILE",
        "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE", "NODE_EXTRA_CA_CERTS",
    )
    return {name: os.environ[name] for name in allowed if name in os.environ}


async def _stop_process(process: asyncio.subprocess.Process) -> None:
    # Also kill descendants whose immediate parent has already exited.
    for signum in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(process.pid, signum)
        except ProcessLookupError:
            pass
        except PermissionError:
            if process.returncode is None:
                raise
        if signum == signal.SIGTERM:
            try:
                await asyncio.wait_for(process.wait(), timeout=2)
            except asyncio.TimeoutError:
                pass
    await process.wait()


async def _capture(argv: List[str], *, timeout: float, cwd: Optional[Path] = None,
                   prompt: Optional[str] = None) -> Tuple[int, str, str]:
    try:
        process = await asyncio.create_subprocess_exec(
            *argv, stdin=asyncio.subprocess.PIPE if prompt is not None else asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            env=_environment(), cwd=str(cwd) if cwd else None, start_new_session=True,
        )
    except OSError as error:
        raise CodexError("无法启动 Codex CLI。请检查本机安装与执行权限，并在普通 Terminal 中启动项目。") from error
    total = 0

    async def read(stream: asyncio.StreamReader) -> bytes:
        nonlocal total
        chunks = []
        while True:
            chunk = await stream.read(65536)
            if not chunk:
                return b"".join(chunks)
            total += len(chunk)
            if total > MAX_OUTPUT_BYTES:
                raise CodexError("Codex 输出超过安全大小限制，任务已停止。请缩小分析范围后重试。")
            chunks.append(chunk)

    async def write() -> None:
        if prompt is not None and process.stdin is not None:
            try:
                process.stdin.write(prompt.encode("utf-8"))
                await process.stdin.drain()
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                process.stdin.close()

    pending = [asyncio.create_task(read(process.stdout)), asyncio.create_task(read(process.stderr)),
               asyncio.create_task(write()), asyncio.create_task(process.wait())]
    try:
        output, errors, _, code = await asyncio.wait_for(asyncio.gather(*pending), timeout=timeout)
        return code, output.decode("utf-8", errors="replace"), errors.decode("utf-8", errors="replace")
    except asyncio.TimeoutError as error:
        await _stop_process(process)
        raise CodexError("Codex 运行超时，进程已停止。请检查网络或缩小分析范围；可调整 READER_ANALYSIS_TIMEOUT_SECONDS。") from error
    except BaseException:
        await _stop_process(process)
        raise
    finally:
        for task in pending:
            if not task.done():
                task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)


def _with_architecture(executable: str, architecture: str) -> List[str]:
    command = [executable]
    try:
        with open(executable, "rb") as entry:
            is_node_wrapper = entry.readline(128).strip() == b"#!/usr/bin/env node"
    except OSError:
        is_node_wrapper = False
    # arch on a script only selects its shebang interpreter, not the Node
    # executable later started by /usr/bin/env. Select Node explicitly.
    if is_node_wrapper:
        node = shutil.which("node")
        if node is None:
            raise CodexError("找不到 Node.js，无法运行 npm 安装的 Codex CLI。")
        command.insert(0, node)
    return ["/usr/bin/arch", "-" + architecture] + command


async def _native_command(executable: str) -> List[str]:
    if sys.platform != "darwin":
        return [executable]
    architecture = os.environ.get("READER_CODEX_ARCH", "")
    if architecture in {"arm64", "x86_64"}:
        return _with_architecture(executable, architecture)
    try:
        code, output, _ = await _capture(["/usr/sbin/sysctl", "-n", "hw.optional.arm64"], timeout=3)
    except CodexError as error:
        raise CodexError("无法检测 macOS 原生架构。请在普通 Terminal 中启动项目并检查 Codex 原生依赖。") from error
    if code != 0 or output.strip() not in {"0", "1"}:
        raise CodexError("无法检测 macOS 原生架构。请在普通 Terminal 中检查 sysctl 与 Codex 安装。")
    return _with_architecture(executable, "arm64") if output.strip() == "1" else [executable]


def _failure_message(output: str) -> str:
    lowered = output.lower()
    if "missing optional dependency" in lowered or "cannot find module" in lowered:
        return "Codex CLI 原生依赖不匹配。Apple Silicon 请使用原生 ARM 终端重新安装 Codex。"
    if "operation not permitted" in lowered or "in-process app-server client" in lowered:
        return "当前执行环境阻止 Codex 启动。请在自己的普通 Terminal 中启动项目，不要复制登录凭据。"
    if any(word in lowered for word in ("rate limit", "usage limit", "quota", "429")):
        return "当前 ChatGPT/Codex 配额或速率受限。请等待配额恢复后重试。"
    if any(word in lowered for word in ("unauthorized", "not logged in", "401", "token expired")):
        return "Codex 的 ChatGPT 登录已失效。请在本机终端执行 codex login 并选择 ChatGPT。"
    if any(word in lowered for word in ("connection", "network", "timed out", "dns", "tls")):
        return "Codex 无法连接服务。请检查本机网络、代理或证书配置后重试。"
    return "Codex 执行失败。请在终端检查 codex --version 和 codex login status；要求 0.155.0+ 与 ChatGPT 登录。"


async def codex_status() -> CodexStatus:
    executable = shutil.which("codex")
    if executable is None:
        return CodexStatus(installed=False, authenticated=False, auth_method="none", version="",
                           message="未找到 Codex CLI。请安装 0.155.0+：npm install -g @openai/codex，再执行 codex login。")
    version = ""
    try:
        command = await _native_command(executable)
        code, stdout, stderr = await _capture(command + ["--version"], timeout=STATUS_TIMEOUT)
        match = re.search(r"(?<!\d)(\d+)\.(\d+)\.(\d+)", stdout) if code == 0 else None
        if not match:
            raise CodexError(_failure_message(stderr + stdout))
        version = match.group(0)
        if tuple(int(value) for value in match.groups()) < MIN_VERSION:
            raise CodexError("Codex CLI 版本过旧。请运行 npm install -g @openai/codex，升级到 0.155.0 或更新版本。")
        # Never force auth mode during status checks, which could alter API-key login state.
        code, stdout, stderr = await _capture(command + ["login", "status"], timeout=STATUS_TIMEOUT)
        status = (stdout + "\n" + stderr).lower()
        if code == 0 and "logged in using chatgpt" in status:
            return CodexStatus(installed=True, authenticated=True, auth_method="chatgpt", version=version,
                               message="已通过本机 Codex CLI 登录 ChatGPT，将使用你的 ChatGPT/Codex 配额。")
        if "api key" in status or "api_key" in status:
            return CodexStatus(installed=True, authenticated=False, auth_method="api_key", version=version,
                               message="当前 Codex 使用 API Key。本项目仅接受 ChatGPT 登录，请在终端执行 codex login 并选择 ChatGPT。")
        if "not logged in" in status:
            raise CodexError("Codex 尚未登录。请在本机终端执行 codex login，并选择 ChatGPT 登录。")
        raise CodexError(_failure_message(status))
    except CodexError as error:
        return CodexStatus(installed=True, authenticated=False, auth_method="none", version=version, message=str(error))


def _strict_schema() -> dict:
    schema = AnalysisResult.model_json_schema()

    def visit(value):
        if isinstance(value, dict):
            if value.get("type") == "object":
                value["additionalProperties"] = False
                value["required"] = list(value.get("properties", {}))
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)
    visit(schema)
    return schema


def _analysis_argv(command: List[str], schema_path: Path, runtime: Path) -> List[str]:
    argv = command + ["-a", "never", "exec", "--ignore-user-config", "--ignore-rules", "--ephemeral",
                      "--skip-git-repo-check", "--sandbox", "read-only", "--json", "--color", "never",
                      "--output-schema", str(schema_path)]
    configs = ['forced_login_method="chatgpt"', 'web_search="disabled"', 'model_reasoning_effort="high"',
               "sqlite_home=" + json.dumps(str(runtime)), "project_doc_max_bytes=0", "mcp_servers={}"]
    for config in configs:
        argv += ["-c", config]
    for feature in DISABLED_FEATURES:
        argv += ["--disable", feature]
    argv += ["--enable", "skip_host_skill_discovery"]
    model = os.environ.get("READER_CODEX_MODEL", "").strip()
    if model:
        argv += ["--model", model]
    return argv + ["-"]


def _parse_result(stdout: str) -> AnalysisResult:
    final_message = None
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(event, dict):
            continue
        if event.get("type") == "turn.failed":
            raise CodexError(_failure_message(json.dumps(event, ensure_ascii=False)))
        item = event.get("item")
        if event.get("type") == "item.completed" and isinstance(item, dict) and item.get("type") == "agent_message":
            final_message = item.get("text")
    if not isinstance(final_message, str):
        raise CodexError("Codex 未返回最终分析结果。请检查登录、配额和网络后重试。")
    try:
        return AnalysisResult.model_validate_json(final_message)
    except (ValidationError, ValueError) as error:
        raise CodexError("Codex 返回的分析格式不符合约定，结果未保存。请重试；不会用示例内容替代。") from error


async def run_analysis(pages: List[str], target: str, instructions: str, workdir: Path) -> AnalysisResult:
    if not pages or not any(page.strip() for page in pages):
        raise CodexError("PDF 未提供可读取文本。扫描件需要先在本机进行 OCR，本项目不会发送空白页面分析。")
    if not target.strip():
        raise CodexError("请填写需要分析的定理、命题或引理编号。")
    status = await codex_status()
    if not status.authenticated or status.auth_method != "chatgpt":
        raise CodexError(status.message)
    try:
        timeout = float(os.environ.get("READER_ANALYSIS_TIMEOUT_SECONDS", "1200"))
        if not math.isfinite(timeout) or timeout <= 0:
            raise ValueError
    except ValueError as error:
        raise CodexError("READER_ANALYSIS_TIMEOUT_SECONDS 必须是大于零的秒数。") from error
    command = await _native_command(shutil.which("codex") or "codex")
    workdir.mkdir(parents=True, exist_ok=True)
    runtime = workdir / "codex-runtime"
    runtime.mkdir(parents=True, exist_ok=True)
    # Fresh cwd has no local instructions/config or paper files.
    with tempfile.TemporaryDirectory(prefix="analysis-", dir=str(workdir)) as scratch:
        scratch_path = Path(scratch)
        schema_path = scratch_path / "analysis-schema.json"
        schema_path.write_text(json.dumps(_strict_schema(), ensure_ascii=False), encoding="utf-8")
        code, stdout, stderr = await _capture(
            _analysis_argv(command, schema_path, runtime), timeout=timeout, cwd=scratch_path,
            prompt=build_prompt(pages, target, instructions),
        )
        if code != 0:
            raise CodexError(_failure_message(stderr + stdout))
        return _parse_result(stdout)
