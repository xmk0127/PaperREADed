"""Source distribution must not copy private data or follow symlinks."""

import importlib.util
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile


SPEC = importlib.util.spec_from_file_location("release_bundle", Path(__file__).parents[1] / "release_bundle.py")
bundle = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bundle)


class ReleaseBundleTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name).resolve() / "project"
        self.root.mkdir()
        for name in ["README.md", "scripts/project.py", "frontend/package.json", "backend/pyproject.toml"]:
            self.write(name)

    def write(self, name, content="fixture only"):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        return path

    def test_includes_only_intended_source_and_marks_preview(self):
        expected = [
            "frontend/src/app/page.tsx", "frontend/src/app/globals.css",
            "frontend/package-lock.json", "backend/app/main.py",
            "backend/tests/test_main.py", "backend/requirements.lock",
            "scripts/smoke.py", "scripts/tests/test_release_bundle.py",
            "data/wall-crossing/proposition-4.1.json", ".github/workflows/ci.yml",
            ".github/ISSUE_TEMPLATE/bug.yml", "docs/publishing.md",
        ]
        for name in expected:
            self.write(name)
        output, count = bundle.build_bundle(self.root, self.root / "dist/PaperREADed-source.zip")
        with ZipFile(output) as archive:
            names = archive.namelist()
            for name in expected:
                self.assertIn("PaperREADed/" + name, names)
            self.assertEqual(count + 1, len(names))
            note = archive.read("PaperREADed/RELEASE-NOTES.txt").decode()
            self.assertIn("source preview", note)
            self.assertIn("No code license has been selected", note)

    def test_selected_license_and_third_party_notice_are_included(self):
        license_text = "MIT License\n\nCopyright (c) 2026 xmk0127\n"
        self.write("LICENSE", license_text)
        self.write("NOTICE.md", "Third-party content retains its own rights.")
        output, _ = bundle.build_bundle(self.root, self.root / "dist/licensed.zip")
        with ZipFile(output) as archive:
            self.assertEqual(archive.read("PaperREADed/LICENSE").decode(), license_text)
            self.assertIn("PaperREADed/NOTICE.md", archive.namelist())
            note = archive.read("PaperREADed/RELEASE-NOTES.txt").decode()
            self.assertIn("Consult LICENSE", note)
            self.assertIn("NOTICE.md", note)
            self.assertNotIn("No code license has been selected", note)

    def test_private_files_env_credentials_caches_and_pdfs_are_excluded(self):
        private = [
            ".local/jobs/result.json", ".local/papers/source.pdf", ".env", ".env.production",
            "backend/.env.example", "frontend/.env.local", ".codex/auth.json",
            "frontend/public/papers/sample.pdf", "frontend/src/copied.pdf",
            "data/other/user-paper.json", "frontend/src/token.ts", "backend/app/credentials.py",
            "backend/app/auth.json", "docs/private-notes.md", "docs/secrets.md",
            "backend/app/.env.py", "backend/app/__pycache__/file.py",
            "backend/.venv/bin/python", "frontend/node_modules/package/index.ts",
            "frontend/.next/server/page.ts", "frontend/src/secret.key", "debug.log",
        ]
        for name in private:
            self.write(name, "PRIVATE_SENTINEL")
        output, _ = bundle.build_bundle(self.root, self.root / "dist/PaperREADed-source.zip")
        with ZipFile(output) as archive:
            for name in archive.namelist():
                self.assertNotIn(b"PRIVATE_SENTINEL", archive.read(name), name)
        for name in private:
            self.assertTrue((self.root / name).exists(), "Private originals must not be deleted")

    def test_file_and_directory_symlinks_are_not_followed(self):
        external = Path(self.folder.name).resolve() / "outside"
        external.mkdir()
        (external / "secret.py").write_text("OUTSIDE_SENTINEL")
        (self.root / "backend/app").mkdir(parents=True)
        (self.root / "backend/app/config.py").symlink_to(external / "secret.py")
        (self.root / "backend/app/copied").symlink_to(external, target_is_directory=True)
        (self.root / "docs").symlink_to(external, target_is_directory=True)
        self.assertNotIn(Path("backend/app/config.py"), bundle.source_files(self.root))
        self.assertNotIn(Path("backend/app/copied/secret.py"), bundle.source_files(self.root))
        output, _ = bundle.build_bundle(self.root, self.root / "dist/PaperREADed-source.zip")
        with ZipFile(output) as archive:
            self.assertFalse(any(b"OUTSIDE_SENTINEL" in archive.read(name) for name in archive.namelist()))

    def test_source_root_parent_symlink_is_not_traversed(self):
        external = Path(self.folder.name).resolve() / "outside"
        (external / "src").mkdir(parents=True)
        (external / "src/page.tsx").write_text("OUTSIDE_SENTINEL")
        self.write("frontend/package.json").unlink()
        (self.root / "frontend").rmdir()
        (self.root / "frontend").symlink_to(external, target_is_directory=True)
        self.assertFalse(any(path.as_posix().startswith("frontend/") for path in bundle.source_files(self.root)))

    def test_output_is_not_overwritten_or_redirected_through_symlink(self):
        output = self.write("dist/PaperREADed-source.zip", "keep original")
        with self.assertRaisesRegex(bundle.BundleError, "已存在"):
            bundle.build_bundle(self.root, output)
        self.assertEqual(output.read_text(), "keep original")
        (self.root / "linked-dist").symlink_to(output.parent, target_is_directory=True)
        with self.assertRaisesRegex(bundle.BundleError, "符号链接"):
            bundle.build_bundle(self.root, self.root / "linked-dist/new.zip")

    def test_path_traversal_and_unapproved_data_fail_allowlist(self):
        for name in ["../README.md", "/README.md", "data/result.json", "scripts/config.json"]:
            self.assertFalse(bundle.is_allowed(Path(name)), name)

    def test_missing_required_source_is_rejected(self):
        (self.root / "README.md").unlink()
        with self.assertRaisesRegex(bundle.BundleError, "README.md"):
            bundle.build_bundle(self.root, self.root / "dist/PaperREADed-source.zip")


if __name__ == "__main__":
    unittest.main()
