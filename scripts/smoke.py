#!/usr/bin/env python3
"""Exercise the real local launcher/HTTP bridge without papers or Codex calls.

Run after setup. Uses an empty temporary storage directory, never .local/.
The normal launcher builds production assets, refuses occupied ports, and
stops its own process groups on success, failure or interruption.
"""

from contextlib import contextmanager
import json
import os
from pathlib import Path
import sys
import tempfile
from urllib.error import HTTPError
from urllib.request import ProxyHandler, build_opener

import project


def fetch(url):
    # Do not send local HTTP checks through any configured external proxy.
    opener = build_opener(ProxyHandler({}))
    try:
        response = opener.open(url, timeout=10)
    except HTTPError as error:
        response = error
    with response:
        return response.code, response.read(2 * 1024 * 1024).decode("utf-8")


def check_services(processes):
    """Only GET read-only routes; never query credentials or submit analysis."""
    project.assert_running(processes)
    frontend = "http://%s:%s" % (project.LOCAL_HOST, project.FRONTEND_PORT)
    backend = "http://%s:%s" % (project.LOCAL_HOST, project.BACKEND_PORT)
    for path in ("/", "/example?tab=proof"):
        status, body = fetch(frontend + path)
        if status != 200 or "PaperREADed" not in body:
            raise project.ProjectError("浏览器页面未正确启动：%s（HTTP %s）" % (path, status))
    for url in (backend + "/api/health", frontend + "/api/local/health"):
        status, body = fetch(url)
        if status != 200 or json.loads(body).get("status") != "ok":
            raise project.ProjectError("前后端健康检查失败：%s" % url)
    for path in ("papers", "analyses"):
        status, body = fetch(frontend + "/api/local/" + path)
        if status != 200 or json.loads(body) != []:
            raise project.ProjectError("临时存储或本机 API 转发检查失败：%s" % path)
    status, _ = fetch(backend + "/api/papers")
    if status != 403:
        raise project.ProjectError("后端应拒绝未携带本机桥接令牌的请求。")
    project.assert_running(processes)
    print("通过：生产页面、后端健康、本机 API 转发、空白临时存储与访问保护。", flush=True)


@contextmanager
def verification_context(storage_root):
    # Keep this process's environment and launcher functions exactly as found.
    overrides = {"READER_STORAGE_ROOT": str(storage_root), "NEXT_TELEMETRY_DISABLED": "1"}
    previous = {key: os.environ.get(key) for key in overrides}
    original_checks = project.environment_checks
    original_supervise = project.supervise
    try:
        os.environ.update(overrides)
        project.environment_checks = lambda: original_checks(include_codex=False)
        project.supervise = check_services
        yield
    finally:
        project.environment_checks = original_checks
        project.supervise = original_supervise
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def run_smoke(root=project.ROOT):
    print("PaperREADed 本机启动验证：不会读取 Codex 登录、导入论文或调用 AI。", flush=True)
    project.ensure_ports_available([project.FRONTEND_PORT, project.BACKEND_PORT])
    with tempfile.TemporaryDirectory(prefix="paperreaded-smoke-") as temporary:
        with verification_context(Path(temporary) / "storage"):
            # Returning from check_services runs start()'s normal finally cleanup.
            project.start(root)
    print("验证完成，本次启动的服务已停止；原有论文与分析未改动。", flush=True)


def main():
    try:
        with project.interrupt_handling():
            run_smoke()
        return 0
    except KeyboardInterrupt:
        print("\n验证已中止，本次启动的服务已清理。", file=sys.stderr)
        return 130
    except (project.ProjectError, OSError, ValueError) as error:
        print("启动验证失败：%s" % error, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
