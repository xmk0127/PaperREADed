"""Launcher checks use only stdlib and never call a real Codex analysis."""

import contextlib
import importlib.util
import io
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location("reader_project", Path(__file__).parents[1] / "project.py")
project = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = project
SPEC.loader.exec_module(project)


class LauncherTests(unittest.TestCase):
    def test_node_range_matches_frontend_dependency_requirements(self):
        for version, accepted in [("20.9.0", False), ("24.14.0", False),
                                  ("24.15.0", True), ("24.19.0", True), ("25.0.0", False)]:
            with self.subTest(version=version), \
                    mock.patch.object(project, "executable", side_effect=lambda name: name), \
                    mock.patch.object(project, "capture", side_effect=[(0, version), (0, "11.0.0")]):
                checks = project.environment_checks(include_codex=False)
            self.assertEqual(next(check.ok for check in checks if check.name == "Node.js"), accepted)

    def test_version_parsing_and_minimums(self):
        self.assertEqual(project.version_tuple("codex-cli 0.155.0"), (0, 155, 0))
        self.assertEqual(project.version_tuple("v24.19.0\n"), (24, 19, 0))
        self.assertIsNone(project.version_tuple("missing"))
        self.assertGreater(project.CODEX_MIN, (0, 154, 9))

    def test_node_tools_use_native_arch_but_python_does_not(self):
        with mock.patch.object(project, "native_node_prefix", return_value=["/usr/bin/arch", "-arm64"]):
            self.assertEqual(project.native_command(["/bin/codex", "--version"]),
                             ["/usr/bin/arch", "-arm64", "/bin/codex", "--version"])
            self.assertEqual(project.native_command(["npm", "ci"]),
                             ["/usr/bin/arch", "-arm64", "npm", "ci"])
            self.assertEqual(project.native_command([sys.executable, "-m", "venv"]),
                             [sys.executable, "-m", "venv"])

    def test_restricted_cli_errors_are_not_misreported_as_missing_login(self):
        self.assertIn("普通 Terminal", project.codex_failure_hint("Operation not permitted"))
        self.assertIn("原生 ARM", project.codex_failure_hint(
            "Missing optional dependency @openai/codex-darwin-x64"))

    def test_doctor_checks_chatgpt_without_starting_login(self):
        commands = []

        def capture(command, cwd=project.ROOT):
            commands.append(command)
            name = Path(command[0]).name
            if name == "node":
                return 0, "v24.19.0"
            if name == "npm":
                return 0, "11.0.0"
            if command[1:] == ["--version"]:
                return 0, "codex-cli 0.155.0"
            return 0, "Logged in using ChatGPT"

        with mock.patch.object(project, "executable", side_effect=lambda value: "/bin/" + value), \
                mock.patch.object(project, "capture", side_effect=capture):
            checks = project.environment_checks()
        self.assertTrue(all(check.ok for check in checks))
        self.assertIn(["/bin/codex", "login", "status"], commands)
        self.assertNotIn(["/bin/codex", "login"], commands)

    def test_api_key_login_is_not_accepted_as_chatgpt(self):
        with mock.patch.object(project, "executable", return_value="codex"), \
                mock.patch.object(project, "capture", side_effect=[
                    (0, "v24.19.0"), (0, "11.0.0"),
                    (0, "codex-cli 0.155.0"), (0, "Logged in using an API key"),
                ]):
            check = project.environment_checks()[-1]
        self.assertFalse(check.ok)
        self.assertFalse(check.required)  # User may start UI to see login instructions.

    def test_setup_uses_lockfile_and_virtualenv_and_does_not_touch_env(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "frontend").mkdir()
            (root / "backend").mkdir()
            envfile = root / "frontend/.env.local"
            envfile.write_text("USER_SETTING=keep\n")
            with mock.patch.object(project, "environment_checks", return_value=[]), \
                    mock.patch.object(project, "executable", return_value="npm"), \
                    mock.patch.object(project, "run_command") as run, \
                    contextlib.redirect_stdout(io.StringIO()):
                project.setup(root)
            commands = [call.args[0] for call in run.call_args_list]
            self.assertEqual(commands[0], ["npm", "ci"])
            self.assertEqual(commands[1][:3], [sys.executable, "-m", "venv"])
            self.assertEqual(commands[-3][-4:], ["install", "--no-deps", "-r", "requirements.lock"])
            self.assertEqual(commands[-2][-5:], ["install", "--no-deps", "--no-build-isolation", "-e", ".[dev]"])
            self.assertEqual(commands[-1][-2:], ["pip", "check"])
            self.assertEqual(envfile.read_text(), "USER_SETTING=keep\n")
            self.assertFalse(any("codex" in command for command in commands))

    def test_occupied_port_is_rejected_without_harming_listener(self):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            port = listener.getsockname()[1]
            with self.assertRaisesRegex(project.ProjectError, "不会替你结束其他进程"):
                project.ensure_ports_available([port])
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                pass

    @unittest.skipUnless(os.name == "posix", "POSIX process groups")
    def test_cleanup_stops_real_process_and_its_descendant(self):
        # A descendant opens a real socket. Closing it proves the process tree
        # has stopped; no PID file or authentication material is used.
        with socket.socket() as reserve:
            reserve.bind(("127.0.0.1", 0))
            port = reserve.getsockname()[1]
        child_code = (
            "import socket,time; s=socket.socket(); "
            "s.bind(('127.0.0.1',%s)); s.listen(); time.sleep(30)" % port
        )
        parent_code = (
            "import subprocess,sys,time; "
            "subprocess.Popen([sys.executable,'-c',%r]); time.sleep(30)" % child_code
        )
        process = project.spawn([sys.executable, "-c", parent_code], project.ROOT)
        try:
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                try:
                    with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                        break
                except OSError:
                    time.sleep(0.05)
            else:
                self.fail("Mock descendant did not start")
            project.stop_processes([process], grace=1)
            self.assertIsNotNone(process.poll())
            with self.assertRaises(OSError):
                socket.create_connection(("127.0.0.1", port), timeout=0.2)
        finally:
            project.stop_processes([process], grace=0.1)

    @unittest.skipUnless(os.name == "posix", "POSIX process groups")
    def test_service_exit_is_failure_even_when_exit_code_is_zero(self):
        process = project.spawn([sys.executable, "-c", "pass"], project.ROOT)
        process.wait(timeout=3)
        try:
            with self.assertRaisesRegex(project.ProjectError, "退出码 0"):
                project.supervise([("模拟后端", process)])
        finally:
            project.stop_processes([process])

    def test_start_token_is_runtime_only_and_cleanup_runs_on_service_failure(self):
        fake_backend = mock.Mock()
        fake_frontend = mock.Mock()
        snapshots = []

        def record_build(command, cwd, env):
            snapshots.append(dict(env))

        with mock.patch.object(project, "environment_checks", return_value=[]), \
                mock.patch.object(project, "dependency_checks", return_value=[]), \
                mock.patch.object(project, "ensure_ports_available"), \
                mock.patch.object(project, "run_command", side_effect=record_build), \
                mock.patch.object(project, "spawn", side_effect=[fake_backend, fake_frontend]) as spawn, \
                mock.patch.object(project, "wait_ready"), \
                mock.patch.object(project, "supervise", side_effect=project.ProjectError("退出")), \
                mock.patch.object(project, "stop_processes") as cleanup, \
                mock.patch.dict(os.environ, {"PAPER_READER_LOCAL_TOKEN": "do-not-reuse"}), \
                contextlib.redirect_stdout(io.StringIO()) as output:
            with self.assertRaises(project.ProjectError):
                project.start()
        self.assertNotIn("PAPER_READER_LOCAL_TOKEN", snapshots[0])
        backend_env = spawn.call_args_list[0].args[2]
        frontend_env = spawn.call_args_list[1].args[2]
        token = backend_env["PAPER_READER_LOCAL_TOKEN"]
        self.assertGreaterEqual(len(token), 40)
        self.assertNotEqual(token, "do-not-reuse")
        self.assertEqual(token, frontend_env["PAPER_READER_LOCAL_TOKEN"])
        self.assertNotIn(token, output.getvalue())
        self.assertEqual(backend_env["READER_BACKEND_URL"], "http://127.0.0.1:8100")
        for call in spawn.call_args_list:
            self.assertIn("127.0.0.1", call.args[0])
            self.assertNotIn("0.0.0.0", call.args[0])
        cleanup.assert_called_once_with([fake_backend, fake_frontend])

    def test_start_cleans_backend_if_frontend_cannot_spawn(self):
        backend = mock.Mock()
        with mock.patch.object(project, "environment_checks", return_value=[]), \
                mock.patch.object(project, "dependency_checks", return_value=[]), \
                mock.patch.object(project, "ensure_ports_available"), \
                mock.patch.object(project, "run_command"), \
                mock.patch.object(project, "spawn", side_effect=[backend, OSError("failed")]), \
                mock.patch.object(project, "stop_processes") as cleanup, \
                contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(OSError):
                project.start()
        cleanup.assert_called_once_with([backend])

    def test_doctor_returns_nonzero_when_login_missing(self):
        with mock.patch.object(project, "environment_checks", return_value=[
                project.Check("ChatGPT 登录", False, "请登录", required=False)]), \
                mock.patch.object(project, "dependency_checks", return_value=[]), \
                mock.patch.object(project, "ensure_ports_available"), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(project.doctor(), 1)


if __name__ == "__main__":
    unittest.main()
