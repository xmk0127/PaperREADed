#!/usr/bin/env python3
"""Build a source-only PaperREADed preview; never copy private runtime data.

This intentionally uses a small allowlist, independent of .gitignore. Review
source changes before sharing: a filename policy cannot detect secrets pasted
into otherwise legitimate source code. No network access or AI call is made.
"""

import argparse
from pathlib import Path
import re
import stat
import sys
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_ROOT = "PaperREADed"
ROOT_FILES = {
    "README.md", "LICENSE", "LICENSE.md", "NOTICE", "NOTICE.md",
    "SECURITY.md", "CONTRIBUTING.md", "CHANGELOG.md", "Makefile",
    ".gitignore", ".gitattributes", ".editorconfig", ".nvmrc", ".node-version",
    ".python-version",
}
EXACT_FILES = ROOT_FILES | {
    "scripts/project.py", "scripts/release_bundle.py", "scripts/smoke.py",
    "backend/pyproject.toml", "backend/requirements.lock",
    "backend/requirements-dev.lock", "backend/requirements.txt",
    "backend/requirements-dev.txt", "backend/uv.lock",
    "frontend/package.json", "frontend/package-lock.json",
    "frontend/tsconfig.json", "frontend/next.config.ts",
    "frontend/next-env.d.ts", "frontend/eslint.config.mjs",
    "frontend/vitest.config.ts", "frontend/.gitignore",
    "data/wall-crossing/proposition-4.1.json",
    ".github/PULL_REQUEST_TEMPLATE.md",
}
# Only these subtrees and file types are intended project source. In particular,
# frontend/public, .local, arbitrary data JSON, and all PDFs are excluded.
SOURCE_TREES = {
    "frontend/src": {".ts", ".tsx", ".css"},
    "backend/app": {".py"},
    "backend/tests": {".py"},
    "scripts/tests": {".py"},
    "docs": {".md"},
    ".github/workflows": {".yml", ".yaml"},
    ".github/ISSUE_TEMPLATE": {".md", ".yml", ".yaml"},
}
SENSITIVE_NAME = re.compile(
    r"(?:^|[._-])(?:credentials?|secrets?|tokens?|private|auth|passwords?)"
    r"(?:$|[._-])", re.IGNORECASE,
)
BLOCKED_PARTS = {
    "node_modules", "__pycache__", "coverage", "htmlcov", "venv",
    "dist", "build", "out", "logs", "uploads",
}


class BundleError(Exception):
    """A distribution safety check failed."""


def unsafe_part(part: str) -> bool:
    return (part in BLOCKED_PARTS or bool(SENSITIVE_NAME.search(part))
            or (part.startswith(".") and part != ".github"))


def is_allowed(relative: Path) -> bool:
    """Decide by relative path; never inspect a private file's contents."""
    if relative.is_absolute() or ".." in relative.parts:
        return False
    name = relative.as_posix()
    if name in EXACT_FILES:
        return True
    if any(unsafe_part(part) for part in relative.parts):
        return False
    return any(name.startswith(tree + "/") and relative.suffix in extensions
               for tree, extensions in SOURCE_TREES.items())


def safe_path(root: Path, relative: Path, directory: bool = False) -> bool:
    """Reject symlinks anywhere in the file path (including directory links)."""
    current = root
    for index, part in enumerate(relative.parts):
        current /= part
        try:
            mode = current.lstat().st_mode
        except FileNotFoundError:
            return False
        if stat.S_ISLNK(mode):
            return False
        want_directory = directory or index < len(relative.parts) - 1
        if not (stat.S_ISDIR(mode) if want_directory else stat.S_ISREG(mode)):
            return False
    return True


def source_files(root: Path) -> list[Path]:
    root = Path(root).resolve(strict=True)
    candidates = {Path(name) for name in EXACT_FILES}
    for tree in SOURCE_TREES:
        # Check every parent before walking, not just the subtree's last part.
        if not safe_path(root, Path(tree), directory=True):
            continue
        pending = [root / tree]
        while pending:
            for path in pending.pop().iterdir():
                if path.is_symlink():
                    continue
                relative = path.relative_to(root)
                if path.is_dir():
                    if not unsafe_part(path.name):
                        pending.append(path)
                elif is_allowed(relative):
                    candidates.add(relative)
    return sorted(
        (path for path in candidates if is_allowed(path) and safe_path(root, path)),
        key=lambda path: path.as_posix(),
    )


def build_bundle(root: Path, output: Path) -> tuple[Path, int]:
    root = Path(root).resolve(strict=True)
    output = Path(output).absolute()
    # Refuse redirecting output through a symlink, and never overwrite a file.
    if any(path.is_symlink() for path in (output, *output.parents)):
        raise BundleError("输出路径不能包含符号链接。")
    if output.exists():
        raise BundleError("输出文件已存在；请使用 --output 指定新的文件名，旧文件不会被覆盖。")
    selected = source_files(root)
    required = {"README.md", "scripts/project.py", "frontend/package.json", "backend/pyproject.toml"}
    missing = required - {path.as_posix() for path in selected}
    if missing:
        raise BundleError("缺少必要源码文件：" + ", ".join(sorted(missing)))
    output.parent.mkdir(parents=True, exist_ok=True)
    license_present = any(path.name in {"LICENSE", "LICENSE.md"} for path in selected)
    note = (
        "PaperREADed — source preview / 源码预览包\n\n"
        "This archive is not proof of a verified AI analysis or a production release.\n"
        "真实 AI 分析需要在普通终端使用你自己的 Codex ChatGPT 登录单独验收。\n"
        "No paper PDF, imported paper, AI result, environment file, or login state is included.\n"
        "不包含论文 PDF、导入文件、分析结果、环境配置或登录凭据。\n"
        "Read README.md and docs before installation.\n"
        + ("Consult LICENSE for the code's license and NOTICE.md for third-party content.\n" if license_present else
           "No code license has been selected. Do not treat this as an open-source license grant.\n"
           "代码许可证尚未选择；不要把此预览包当作已获开源授权。\n")
    )
    with ZipFile(output, "x", compression=ZIP_DEFLATED) as archive:
        for relative in selected:
            if not safe_path(root, relative):
                raise BundleError("打包时文件发生变化，请检查后重试：" + relative.as_posix())
            archive.write(root / relative, f"{ARCHIVE_ROOT}/{relative.as_posix()}")
        archive.writestr(f"{ARCHIVE_ROOT}/RELEASE-NOTES.txt", note)
    return output, len(selected)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="PaperREADed 源码预览打包（不包含 PDF 或本机数据）")
    parser.add_argument("--output", type=Path, default=ROOT / "dist/PaperREADed-source.zip")
    parser.add_argument("--list", action="store_true", help="只列出白名单文件，不创建压缩包")
    args = parser.parse_args(argv)
    try:
        if args.list:
            for path in source_files(ROOT):
                print(path.as_posix())
        else:
            output, count = build_bundle(ROOT, args.output)
            print(f"已创建源码预览包：{output}（{count} 个源码文件）")
            print("未包含 PDF 或本机数据；发布前请审查 LICENSE、第三方内容权限与真实 AI 验收状态。")
    except (OSError, BundleError) as error:
        print(f"打包失败：{error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
