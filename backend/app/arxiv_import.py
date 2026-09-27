"""Download one explicitly selected arXiv PDF, never an arbitrary user URL."""

import asyncio
from http.client import HTTPException as HTTPProtocolError
import json
from pathlib import Path
import re
import socket
import ssl
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, HTTPSHandler, ProxyHandler, Request, build_opener

from .pdf_extract import MAX_PDF_BYTES

DOWNLOAD_TIMEOUT = 35
SOCKET_TIMEOUT = 10
READ_CHUNK_BYTES = 64 * 1024
INVALID_REFERENCE = "请输入有效的 arXiv 编号或 arxiv.org 的 /abs/、/pdf/ 链接，例如 2309.07041。"


class ArxivImportError(ValueError):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code


def parse_arxiv_reference(reference: str) -> str:
    """Validate identifiers before building our own fixed-host HTTPS URL."""
    value = reference.strip()
    if not value or len(value) > 500 or any(character.isspace() for character in value):
        raise ArxivImportError(INVALID_REFERENCE)
    if value.lower().startswith("arxiv:"):
        value = value[6:]
    if "://" in value:
        url = re.fullmatch(r"https?://(?:www\.)?arxiv\.org/(?:abs|pdf)/(.+)", value, re.IGNORECASE)
        if url is None:
            raise ArxivImportError(INVALID_REFERENCE)
        value = url.group(1)
    if value.endswith(".pdf"):
        value = value[:-4]

    modern = re.fullmatch(r"(?P<date>[0-9]{4})\.(?P<sequence>[0-9]{4,5})(?:v[1-9][0-9]{0,4})?", value)
    if modern:
        date, sequence = modern.group("date", "sequence")
        required_digits = 4 if int(date) < 1501 else 5
        if (int(date) >= 704 and 1 <= int(date[2:]) <= 12
                and len(sequence) == required_digits and int(sequence) > 0):
            return value
    legacy = re.fullmatch(
        r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[A-Z]{2})?/"
        r"(?P<date>[0-9]{4})(?P<sequence>[0-9]{3})(?:v[1-9][0-9]{0,4})?", value)
    if legacy:
        date = legacy.group("date")
        year, month = int(date[:2]), int(date[2:])
        full_year = 1900 + year if year >= 91 else 2000 + year
        full_date = full_year * 100 + month
        if 199104 <= full_date <= 200703 and 1 <= month <= 12 and int(legacy.group("sequence")) > 0:
            return value
    raise ArxivImportError(INVALID_REFERENCE)


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        # Even arxiv.org redirects are not followed: an upstream response cannot
        # turn this narrowly scoped downloader into a general-purpose proxy.
        raise ArxivImportError("arXiv 返回了跳转链接，已停止下载；请下载 PDF 后选择“本地 PDF”导入。", 502)


def _ssl_context() -> ssl.SSLContext:
    context = ssl.create_default_context()
    # Some standalone macOS Python distributions have no bundled trust store.
    # Use the OS's certificate bundle only when the normal store is empty;
    # never turn off certificate or hostname verification.
    system_bundle = Path("/etc/ssl/cert.pem")
    if sys.platform == "darwin" and context.cert_store_stats().get("x509_ca", 0) == 0 and system_bundle.is_file():
        context.load_verify_locations(cafile=str(system_bundle))
    return context


def _download_pdf(identifier: str) -> bytes:
    identifier = parse_arxiv_reference(identifier)
    request = Request("https://arxiv.org/pdf/" + identifier, headers={
        "User-Agent": "PaperREADed/0.1 (user-requested local PDF import)",
        "Accept": "application/pdf",
        "Accept-Encoding": "identity",
    })
    # No ambient cookies, Authorization headers, or environment-provided proxy.
    opener = build_opener(ProxyHandler({}), _NoRedirect(), HTTPSHandler(context=_ssl_context()))
    started = time.monotonic()
    try:
        with opener.open(request, timeout=SOCKET_TIMEOUT) as response:
            if response.status != 200:
                raise ArxivImportError("arXiv 未返回可下载的 PDF，请稍后重试或使用本地 PDF。", 502)
            content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
            if content_type and content_type not in ("application/pdf", "application/octet-stream"):
                raise ArxivImportError("arXiv 返回的不是 PDF，论文可能尚未提供 PDF；请检查编号。", 422)
            if response.headers.get("Content-Encoding", "identity").lower() != "identity":
                raise ArxivImportError("arXiv 返回了不支持的压缩内容，请使用本地 PDF 导入。", 502)
            declared_size = response.headers.get("Content-Length")
            if declared_size:
                try:
                    size = int(declared_size)
                except ValueError as exc:
                    raise ArxivImportError("arXiv 下载响应异常，请稍后重试。", 502) from exc
                if size < 0:
                    raise ArxivImportError("arXiv 下载响应异常，请稍后重试。", 502)
                if size > MAX_PDF_BYTES:
                    raise ArxivImportError("PDF 大小不能超过 30 MiB。", 413)
            content = bytearray()
            while True:
                if time.monotonic() - started >= DOWNLOAD_TIMEOUT:
                    raise ArxivImportError("arXiv 下载超时，请检查网络后重试，或下载 PDF 后从本地导入。", 504)
                chunk = response.read(min(READ_CHUNK_BYTES, MAX_PDF_BYTES + 1 - len(content)))
                if not chunk:
                    break
                content.extend(chunk)
                if len(content) > MAX_PDF_BYTES:
                    raise ArxivImportError("PDF 大小不能超过 30 MiB。", 413)
            if not content.lstrip().startswith(b"%PDF-"):
                raise ArxivImportError("arXiv 返回的内容不是有效 PDF，请检查编号或从本地导入。", 422)
            return bytes(content)
    except HTTPError as exc:
        if exc.code in (404, 410):
            raise ArxivImportError("未找到该 arXiv 论文的 PDF，请核对编号和版本。", 404) from exc
        if exc.code == 429:
            raise ArxivImportError("arXiv 暂时限制下载，请稍后再试。", 503) from exc
        raise ArxivImportError("arXiv 暂时无法提供 PDF，请稍后重试或从本地导入。", 502) from exc
    except (TimeoutError, socket.timeout) as exc:
        raise ArxivImportError("arXiv 下载超时，请检查网络后重试，或下载 PDF 后从本地导入。", 504) from exc
    except (URLError, OSError, HTTPProtocolError) as exc:
        raise ArxivImportError("无法连接 arXiv，请检查本机网络；也可以下载 PDF 后选择“本地 PDF”导入。", 502) from exc


async def download_arxiv_pdf(identifier: str) -> bytes:
    """A hard deadline also bounds DNS lookup and slow, trickling responses."""
    identifier = parse_arxiv_reference(identifier)
    try:
        process = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "app.arxiv_import", "--worker", identifier,
            cwd=str(Path(__file__).resolve().parents[1]),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
    except OSError as exc:
        raise ArxivImportError("无法启动 arXiv 下载进程，请重启本机服务后重试。", 502) from exc
    try:
        content, error = await asyncio.wait_for(process.communicate(), DOWNLOAD_TIMEOUT)
    except BaseException as exc:
        if process.returncode is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass
        await process.wait()
        if isinstance(exc, asyncio.TimeoutError):
            raise ArxivImportError("arXiv 下载超过 35 秒，已停止；请检查网络后重试或从本地导入 PDF。", 504) from exc
        raise
    if process.returncode != 0:
        try:
            result = json.loads(error)
            status = result["status_code"]
            message = result["error"]
            if status not in (404, 413, 422, 502, 503, 504) or not isinstance(message, str):
                raise ValueError("invalid error")
        except (ValueError, KeyError, TypeError):
            raise ArxivImportError("arXiv 下载失败，请稍后重试或从本地导入 PDF。", 502)
        raise ArxivImportError(message, status)
    if len(content) > MAX_PDF_BYTES:
        raise ArxivImportError("PDF 大小不能超过 30 MiB。", 413)
    return content


def _worker() -> None:
    try:
        content = _download_pdf(sys.argv[2])
    except ArxivImportError as exc:
        sys.stderr.write(json.dumps({"error": str(exc), "status_code": exc.status_code}, ensure_ascii=False))
        raise SystemExit(1)
    sys.stdout.buffer.write(content)


if __name__ == "__main__" and len(sys.argv) == 3 and sys.argv[1] == "--worker":
    _worker()
