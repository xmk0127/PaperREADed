"""Smoke-helper regression tests; no actual services, AI calls or papers."""

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest import mock


SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
try:
    SPEC = importlib.util.spec_from_file_location("paperreaded_smoke", SCRIPTS / "smoke.py")
    smoke = importlib.util.module_from_spec(SPEC)
    SPEC.loader.exec_module(smoke)
finally:
    sys.path.pop(0)


class SmokeTests(unittest.TestCase):
    def test_real_route_selection_checks_bridge_without_ai_or_credentials(self):
        requests = []

        def respond(url):
            requests.append(url)
            if ":8100/api/papers" in url:
                return 403, "{}"
            if url.endswith("health"):
                return 200, json.dumps({"status": "ok"})
            if "/api/local/" in url:
                return 200, "[]"
            return 200, "<title>PaperREADed</title>"

        with mock.patch.object(smoke, "fetch", side_effect=respond), \
                mock.patch.object(smoke.project, "assert_running") as alive, \
                contextlib.redirect_stdout(io.StringIO()):
            smoke.check_services([])
        self.assertEqual(len(requests), 7)
        self.assertIn("http://127.0.0.1:3100/api/local/papers", requests)
        self.assertIn("http://127.0.0.1:3100/api/local/analyses", requests)
        self.assertFalse(any("codex" in url for url in requests))
        self.assertEqual(alive.call_count, 2)

    def test_nonempty_storage_or_broken_bridge_fails(self):
        responses = [(200, "PaperREADed"), (200, "PaperREADed"),
                     (200, '{"status":"ok"}'), (200, '{"status":"ok"}'),
                     (200, '[{"id":"private-paper"}]')]
        with mock.patch.object(smoke, "fetch", side_effect=responses), \
                mock.patch.object(smoke.project, "assert_running"):
            with self.assertRaisesRegex(smoke.project.ProjectError, "临时存储"):
                smoke.check_services([])

    def test_context_restores_environment_and_functions_even_on_failure(self):
        checks = smoke.project.environment_checks
        supervise = smoke.project.supervise
        with mock.patch.dict(os.environ, {"READER_STORAGE_ROOT": "user-data", "NEXT_TELEMETRY_DISABLED": "0"}):
            with self.assertRaisesRegex(RuntimeError, "stop"):
                with smoke.verification_context(Path("/tmp/test-smoke-storage")):
                    self.assertEqual(os.environ["READER_STORAGE_ROOT"], "/tmp/test-smoke-storage")
                    self.assertIs(smoke.project.supervise, smoke.check_services)
                    raise RuntimeError("stop")
            self.assertEqual(os.environ["READER_STORAGE_ROOT"], "user-data")
            self.assertEqual(os.environ["NEXT_TELEMETRY_DISABLED"], "0")
        self.assertIs(smoke.project.environment_checks, checks)
        self.assertIs(smoke.project.supervise, supervise)

    def test_smoke_skips_codex_checks_and_removes_temporary_storage(self):
        observed = []

        def start(root):
            smoke.project.environment_checks()
            storage = Path(os.environ["READER_STORAGE_ROOT"])
            observed.append(storage)
            self.assertTrue(storage.parent.is_dir())
            self.assertNotIn(".local", storage.parts)

        with mock.patch.object(smoke.project, "environment_checks", return_value=[]) as checks, \
                mock.patch.object(smoke.project, "start", side_effect=start), \
                mock.patch.object(smoke.project, "ensure_ports_available"), \
                contextlib.redirect_stdout(io.StringIO()):
            smoke.run_smoke()
        checks.assert_called_once_with(include_codex=False)
        self.assertEqual(len(observed), 1)
        self.assertFalse(observed[0].parent.exists())

    def test_occupied_port_prevents_start_without_killing_existing_services(self):
        with mock.patch.object(smoke.project, "ensure_ports_available", side_effect=smoke.project.ProjectError("occupied")), \
                mock.patch.object(smoke.project, "start") as start, \
                contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(smoke.project.ProjectError, "occupied"):
                smoke.run_smoke()
        start.assert_not_called()


if __name__ == "__main__":
    unittest.main()
