#!/usr/bin/env python3
"""Local-only project launcher; Python 3.9+, no third-party bootstrap dependency."""

import argparse
from contextlib import contextmanager
from dataclasses import dataclass
from functools import lru_cache
import os
from pathlib import Path
import platform
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
from typing import Dict, List, Optional, Sequence, Tuple
from urllib.error import URLError
from urllib.request import ProxyHandler, Request, build_opener


ROOT = Path(__file__).resolve().parents[1]
FRONTEND_PORT = 3100
BACKEND_PORT = 8100
NODE_MIN = (24, 15, 0)
CODEX_MIN = (0, 155, 0)
LOCAL_HOST = "127.0.0.1"


class ProjectError(RuntimeError):
    pass


@dataclass
class Check:
    name: str
    ok: bool
    message: str
    required: bool = True


def version_tuple(value: str) -> Optional[Tuple[int, int, int]]:
    match = re.search(r"(?<!\d)(\d+)\.(\d+)\.(\d+)", value)
    return tuple(int(part) for part in match.groups()) if match else None


def executable(name: str) -> Optional[str]:
    return shutil.which(name)


@lru_cache(maxsize=1)
def native_node_prefix() -> List[str]:
    # A Rosetta Python can otherwise start universal Node as x64 even though
    # npm installed arm64-only Codex/Next optional dependencies in this shell.
    if sys.platform != "darwin":
        return []
    try:
        hardware = subprocess.run(
            ["/usr/sbin/sysctl", "-n", "hw.optional.arm64"],
            capture_output=True, text=True, timeout=3, check=False,
        )
        if hardware.returncode == 0 and hardware.stdout.strip() == "1":
            return ["/usr/bin/arch", "-arm64"]
    except (OSError, subprocess.TimeoutExpired):
        pass
    return []


def native_command(command: Sequence[str]) -> List[str]:
    parts = list(command)
    if parts and Path(parts[0]).name in {"node", "npm", "codex"}:
        prefix = native_node_prefix()
        if prefix and Path(parts[0]).name != "node":
            try:
                with open(parts[0], "rb") as entry:
                    wrapper = entry.readline(128).strip() == b"#!/usr/bin/env node"
            except OSError:
                wrapper = False
            if wrapper:
                parts.insert(0, executable("node") or "node")
        return prefix + parts
    return parts


def capture(command: Sequence[str], cwd: Path = ROOT) -> Tuple[int, str]:
    """Only used for version/login status and import checks, never credentials."""
    try:
        result = subprocess.run(
            native_command(command), cwd=str(cwd), capture_output=True, text=True,
            timeout=15, check=False,
        )
        return result.returncode, result.stdout + "\n" + result.stderr
    except (OSError, subprocess.TimeoutExpired):
        return 1, "命令无法执行或检查超时"


def codex_failure_hint(output: str) -> str:
    lowered = output.lower()
    if "missing optional dependency" in lowered:
        return "CLI 原生依赖不匹配；Apple Silicon 请用原生 ARM 终端，否则重新安装 Codex"
    if "operation not permitted" in lowered or "in-process app-server client" in lowered:
        return "当前执行环境可能受限；请在自己的普通 Terminal 中检查，不要复制登录凭据"
    return "请在本机终端执行 codex login，并选择 ChatGPT；项目不接受 API Key"


def environment_checks(include_codex: bool = True) -> List[Check]:
    checks = [
        Check("系统", os.name == "posix", "支持 macOS / Linux；Windows 请使用 WSL"),
        Check("Python", sys.version_info >= (3, 9),
              "当前 %s；要求 3.9+" % sys.version.split()[0]),
    ]
    node = executable("node")
    code, output = capture([node, "--version"]) if node else (1, "")
    version = version_tuple(output) if code == 0 else None
    checks.append(Check("Node.js", code == 0 and version is not None and NODE_MIN <= version < (25, 0, 0),
                        "当前 %s；要求 24.15+ 且 <25，推荐 Node.js 24.19.0" %
                        (".".join(map(str, version)) if version else "未安装 / 无法读取")))
    npm = executable("npm")
    code, _ = capture([npm, "--version"]) if npm else (1, "")
    checks.append(Check("npm", code == 0, "可用" if code == 0 else "未安装 / 无法运行"))
    if include_codex:
        codex = executable("codex")
        code, output = capture([codex, "--version"]) if codex else (1, "")
        version = version_tuple(output) if code == 0 else None
        compatible = code == 0 and version is not None and version >= CODEX_MIN
        checks.append(Check("Codex CLI", compatible,
                            "当前 %s；要求 0.155.0+，安装：npm install -g @openai/codex" %
                            (".".join(map(str, version)) if version else
                             ("未安装" if not codex else codex_failure_hint(output)))))
        code, status = capture([codex, "login", "status"]) if codex else (1, "")
        chatgpt = code == 0 and "logged in using chatgpt" in status.lower()
        checks.append(Check("ChatGPT 登录", chatgpt,
                            "已通过本机 Codex 登录" if chatgpt else
                            codex_failure_hint(status),
                            required=False))
    return checks


def dependency_checks(root: Path = ROOT) -> List[Check]:
    python = root / "backend/.venv/bin/python"
    installed = python.is_file()
    code, _ = capture(
        [str(python), "-c", "import fastapi, uvicorn, pypdf, multipart, fontTools"], root,
    ) if installed else (1, "")
    return [
        Check("前端依赖", (root / "frontend/node_modules/next/dist/bin/next").is_file(),
              "缺少依赖时运行 python3 scripts/project.py setup"),
        Check("后端依赖", code == 0,
              "缺少依赖时运行 python3 scripts/project.py setup"),
    ]


def show_checks(checks: Sequence[Check]) -> None:
    for check in checks:
        label = "通过" if check.ok else ("失败" if check.required else "提示")
        print("[%s] %s：%s" % (label, check.name, check.message), flush=True)


def require_checks(checks: Sequence[Check]) -> None:
    show_checks(checks)
    if any(not check.ok and check.required for check in checks):
        raise ProjectError("环境尚未准备好。请按上述提示修复后重试。")


def ensure_ports_available(ports: Sequence[int]) -> None:
    """Bind-check without killing or reusing an unrelated server."""
    held = []
    try:
        for port in ports:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            held.append(sock)
            # A recently stopped server can leave TIME_WAIT connections. Match
            # uvicorn/Next reuse semantics while still rejecting live listeners.
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind((LOCAL_HOST, port))
            except OSError as error:
                raise ProjectError(
                    "本机端口 %s 不可用：%s。请先在原终端停止占用它的服务；本脚本不会替你结束其他进程。"
                    % (port, error.strerror or "被占用")
                ) from error
    finally:
        for sock in held:
            sock.close()


def spawn(command: Sequence[str], cwd: Path, env: Optional[Dict[str, str]] = None) -> subprocess.Popen:
    return subprocess.Popen(native_command(command), cwd=str(cwd), env=env, start_new_session=True)


def signal_group(process: subprocess.Popen, signum: int) -> None:
    try:
        os.killpg(process.pid, signum)
    except ProcessLookupError:
        pass
    except PermissionError:
        # Some restricted macOS hosts report EPERM for an already-reaped group.
        # Do not retry a denied signal; keep errors for a still-running child.
        if process.poll() is None:
            raise


def stop_processes(processes: Sequence[subprocess.Popen], grace: float = 5.0) -> None:
    # Signal process groups even when the immediate npm/uvicorn process exited:
    # its still-running descendants must not leave the port occupied.
    for process in processes:
        signal_group(process, signal.SIGTERM)
    deadline = time.monotonic() + grace
    for process in processes:
        try:
            process.wait(timeout=max(0.01, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            pass
    for process in processes:
        signal_group(process, signal.SIGKILL)
    for process in processes:
        process.wait()


@contextmanager
def interrupt_handling():
    def interrupt(_signum, _frame):
        raise KeyboardInterrupt

    saved = {sig: signal.signal(sig, interrupt) for sig in
             (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)}
    try:
        yield
    finally:
        for sig, handler in saved.items():
            signal.signal(sig, handler)


def run_command(command: Sequence[str], cwd: Path, env: Optional[Dict[str, str]] = None) -> None:
    process = spawn(command, cwd, env)
    try:
        code = process.wait()
        if code != 0:
            raise ProjectError("命令执行失败（退出码 %s）：%s" % (code, " ".join(command)))
    finally:
        stop_processes([process])


def setup(root: Path = ROOT) -> None:
    require_checks(environment_checks(include_codex=False))
    print("安装锁定的前端依赖……", flush=True)
    run_command([executable("npm") or "npm", "ci"], root / "frontend")
    python = root / "backend/.venv/bin/python"
    if not python.is_file():
        print("创建项目 Python 虚拟环境……", flush=True)
        run_command([sys.executable, "-m", "venv", str(root / "backend/.venv")], root)
    print("安装锁定的后端、构建与测试依赖……", flush=True)
    run_command([str(python), "-m", "pip", "install", "--no-deps", "-r", "requirements.lock"], root / "backend")
    run_command([str(python), "-m", "pip", "install", "--no-deps", "--no-build-isolation", "-e", ".[dev]"], root / "backend")
    run_command([str(python), "-m", "pip", "check"], root / "backend")
    print("准备完成。尚未安装 Codex 时运行 npm install -g @openai/codex；"
          "然后执行 codex login，再运行 python3 scripts/project.py start。", flush=True)


def doctor(root: Path = ROOT) -> int:
    print("正在检查本机环境（不会启动 AI）……", flush=True)
    checks = environment_checks() + dependency_checks(root)
    for port in (FRONTEND_PORT, BACKEND_PORT):
        try:
            ensure_ports_available([port])
            checks.append(Check("端口 %s" % port, True, "可用于启动", required=False))
        except ProjectError:
            checks.append(Check("端口 %s" % port, False,
                                "已被占用；若阅读器正在运行，这是正常的。否则先停止占用服务。",
                                required=False))
    show_checks(checks)
    print("此检查不启动 AI、不修改登录状态，也不读取或复制登录凭据。", flush=True)
    return 0 if all(check.ok for check in checks if check.required or check.name == "ChatGPT 登录") else 1


def assert_running(processes: Sequence[Tuple[str, subprocess.Popen]]) -> None:
    for name, process in processes:
        code = process.poll()
        if code is not None:
            raise ProjectError("%s 提前退出（退出码 %s），其余服务将停止。请查看上方日志。" % (name, code))


def wait_ready(processes: Sequence[Tuple[str, subprocess.Popen]],
               token: str, timeout: float = 90.0) -> None:
    opener = build_opener(ProxyHandler({}))
    waiting = [
        Request("http://%s:%s/api/health" % (LOCAL_HOST, BACKEND_PORT),
                headers={"X-Reader-Token": token}),
        Request("http://%s:%s/" % (LOCAL_HOST, FRONTEND_PORT)),
    ]
    deadline = time.monotonic() + timeout
    while waiting and time.monotonic() < deadline:
        assert_running(processes)
        for request in list(waiting):
            try:
                with opener.open(request, timeout=1) as response:
                    if response.status == 200:
                        waiting.remove(request)
            except (URLError, TimeoutError, OSError):
                pass
        if waiting:
            time.sleep(0.2)
    if waiting:
        raise ProjectError("服务在 90 秒内未就绪，已停止本次启动的服务。请查看日志。")
    assert_running(processes)


def supervise(processes: Sequence[Tuple[str, subprocess.Popen]]) -> None:
    while True:
        assert_running(processes)
        time.sleep(0.2)


def start(root: Path = ROOT) -> None:
    checks = environment_checks() + dependency_checks(root)
    # Reading saved results and importing a PDF must remain available while
    # Codex is missing, outdated, logged out, or temporarily unavailable.
    # The API independently requires a compatible, ChatGPT-authenticated CLI.
    for check in checks:
        if check.name == "Codex CLI":
            check.required = False
    require_checks(checks)
    ensure_ports_available([FRONTEND_PORT, BACKEND_PORT])
    env = os.environ.copy()
    env["READER_BACKEND_URL"] = "http://%s:%s" % (LOCAL_HOST, BACKEND_PORT)
    env["PYTHONUNBUFFERED"] = "1"
    if sys.platform == "darwin":
        # The backend venv can be Intel even when this launcher is native ARM.
        # Reuse the architecture with which the CLI status check just ran.
        env["READER_CODEX_ARCH"] = "arm64" if native_node_prefix() else platform.machine()
    for key in ("OPENAI_API_KEY", "CODEX_API_KEY"):
        env.pop(key, None)
    # Build has no local auth token; it is created only for server runtime.
    env.pop("PAPER_READER_LOCAL_TOKEN", None)
    print("构建浏览器界面（首次启动可能需要稍等）……", flush=True)
    run_command([executable("npm") or "npm", "run", "build"], root / "frontend", env)
    ensure_ports_available([FRONTEND_PORT, BACKEND_PORT])
    env["PAPER_READER_LOCAL_TOKEN"] = secrets.token_urlsafe(32)
    processes = []  # type: List[Tuple[str, subprocess.Popen]]
    try:
        processes.append(("后端", spawn([
            str(root / "backend/.venv/bin/python"), "-m", "uvicorn", "app.main:app",
            "--host", LOCAL_HOST, "--port", str(BACKEND_PORT),
        ], root / "backend", env)))
        processes.append(("前端", spawn([
            executable("node") or "node", "node_modules/next/dist/bin/next", "start",
            "--hostname", LOCAL_HOST, "--port", str(FRONTEND_PORT),
        ], root / "frontend", env)))
        wait_ready(processes, env["PAPER_READER_LOCAL_TOKEN"])
        print("\nPaperREADed 已启动： http://%s:%s/\n"
              "请保留此终端；按 Ctrl-C 停止本次启动的前后端。\n"
              "导入论文不会自动调用 AI；开始分析前需在页面确认发送论文文本。\n"
              % (LOCAL_HOST, FRONTEND_PORT), flush=True)
        supervise(processes)
    finally:
        stop_processes([process for _, process in processes])


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="PaperREADed：本机安装、诊断与启动")
    parser.add_argument("command", choices=("setup", "doctor", "start"))
    args = parser.parse_args(argv)
    try:
        with interrupt_handling():
            if args.command == "doctor":
                return doctor()
            if args.command == "setup":
                setup()
            else:
                start()
        return 0
    except KeyboardInterrupt:
        print("\n已停止本次任务及其服务。论文与已完成的分析仍保存在 .local/。", flush=True)
        return 130
    except (ProjectError, OSError) as error:
        print("\n无法完成：%s" % error, file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
