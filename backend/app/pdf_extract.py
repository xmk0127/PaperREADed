"""Bounded PDF import using the PDF text layer; no OCR or remote requests."""

import asyncio
from io import BytesIO
import json
import logging
from pathlib import Path
import sys
from typing import List, Tuple

from pypdf import PdfReader

MAX_PDF_BYTES = 30 * 1024 * 1024
MAX_PDF_PAGES = 250
MAX_ANALYSIS_CHARACTERS = 600_000
EXTRACTION_TIMEOUT = 60


class PDFImportError(ValueError):
    pass


def extract_pages(content: bytes) -> Tuple[List[str], List[str]]:
    if len(content) > MAX_PDF_BYTES:
        raise PDFImportError("PDF 大小不能超过 30 MiB。")
    if not content or not content.lstrip().startswith(b"%PDF-"):
        raise PDFImportError("文件不是有效的 PDF。")
    try:
        reader = PdfReader(BytesIO(content), strict=True)
        if reader.is_encrypted:
            raise PDFImportError("暂不支持加密 PDF，请先在本机解密后重新导入。")
        count = len(reader.pages)
        if not count:
            raise PDFImportError("PDF 没有可读取的页面。")
        if count > MAX_PDF_PAGES:
            raise PDFImportError("PDF 页数不能超过 250 页。")
        pages = []
        characters = 0
        for page in reader.pages:
            text = (page.extract_text() or "").strip()
            characters += len(text)
            if characters > MAX_ANALYSIS_CHARACTERS:
                raise PDFImportError("全文超过 600,000 字符，无法导入；不会截断论文。")
            pages.append(text)
    except PDFImportError:
        raise
    except Exception as exc:
        raise PDFImportError("PDF 损坏或无法读取，请检查文件后重试。") from exc
    empty = [str(index + 1) for index, page in enumerate(pages) if not page.strip()]
    warnings = []
    if len(empty) == len(pages):
        warnings.append("未检测到可提取文本。此文件可能是扫描件，当前不支持 OCR，无法开始 AI 分析。")
    elif empty:
        warnings.append("以下 PDF 页未提取到文本，可能包含扫描图片：" + "、".join(empty) + "。")
    return pages, warnings


async def extract_pages_isolated(content: bytes) -> Tuple[List[str], List[str]]:
    """A malformed PDF cannot keep the web server's worker thread busy forever."""
    if len(content) > MAX_PDF_BYTES:
        raise PDFImportError("PDF 大小不能超过 30 MiB。")
    process = await asyncio.create_subprocess_exec(
        sys.executable, "-m", "app.pdf_extract", "--worker",
        cwd=str(Path(__file__).resolve().parents[1]),
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        output, _ = await asyncio.wait_for(process.communicate(content), EXTRACTION_TIMEOUT)
    except BaseException as exc:
        if process.returncode is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass
        await process.wait()
        if isinstance(exc, asyncio.TimeoutError):
            raise PDFImportError("PDF 解析超过 60 秒，已停止；请检查文件或使用较小的 PDF。") from exc
        raise
    if process.returncode != 0:
        raise PDFImportError("PDF 解析进程已停止，文件可能损坏或超过资源限制。")
    try:
        result = json.loads(output)
        if "error" in result:
            raise PDFImportError(result["error"])
        return result["pages"], result["warnings"]
    except (ValueError, KeyError, TypeError) as exc:
        if isinstance(exc, PDFImportError):
            raise
        raise PDFImportError("PDF 解析未返回有效结果。") from exc


def _worker() -> None:
    import resource

    logging.disable(logging.CRITICAL)
    resource.setrlimit(resource.RLIMIT_CPU, (45, 50))
    if sys.platform == "linux":
        resource.setrlimit(resource.RLIMIT_AS, (1024 ** 3, 1024 ** 3))
    try:
        pages, warnings = extract_pages(sys.stdin.buffer.read(MAX_PDF_BYTES + 1))
        result = {"pages": pages, "warnings": warnings}
    except PDFImportError as exc:
        result = {"error": str(exc)}
    sys.stdout.write(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__" and "--worker" in sys.argv:
    _worker()
