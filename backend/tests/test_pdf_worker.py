import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app import pdf_extract


@pytest.fixture
def worker(monkeypatch):
    process = SimpleNamespace(
        returncode=0,
        communicate=AsyncMock(return_value=(b'{"pages":["Paper"],"warnings":[]}', b"")),
        kill=Mock(),
        wait=AsyncMock(return_value=0),
    )
    start = AsyncMock(return_value=process)
    monkeypatch.setattr(pdf_extract.asyncio, "create_subprocess_exec", start)
    return process, start


def test_worker_returns_pages_and_warnings(worker):
    process, start = worker
    expected = {"pages": ["Theorem 1.2", ""], "warnings": ["第 2 页没有文本。"]}
    process.communicate.return_value = (json.dumps(expected).encode("utf-8"), b"")

    result = asyncio.run(pdf_extract.extract_pages_isolated(b"%PDF-test"))

    assert result == (expected["pages"], expected["warnings"])
    start.assert_awaited_once()
    process.communicate.assert_awaited_once_with(b"%PDF-test")
    process.kill.assert_not_called()


def test_oversize_pdf_does_not_launch_worker(worker, monkeypatch):
    process, start = worker
    monkeypatch.setattr(pdf_extract, "MAX_PDF_BYTES", 8)

    with pytest.raises(pdf_extract.PDFImportError, match="大小不能超过"):
        asyncio.run(pdf_extract.extract_pages_isolated(b"x" * 9))

    start.assert_not_called()
    process.communicate.assert_not_called()


@pytest.mark.parametrize("already_exited", [False, True])
def test_worker_timeout_kills_and_reaps_process(worker, monkeypatch, already_exited):
    process, _ = worker
    process.returncode = None
    if already_exited:
        # The child can exit between checking returncode and sending SIGKILL.
        process.kill.side_effect = ProcessLookupError
    monkeypatch.setattr(pdf_extract, "EXTRACTION_TIMEOUT", 0.01)

    async def blocked_communicate(_content):
        await asyncio.Event().wait()

    process.communicate.side_effect = blocked_communicate

    with pytest.raises(pdf_extract.PDFImportError, match="解析超过") as error:
        asyncio.run(pdf_extract.extract_pages_isolated(b"%PDF-test"))

    assert isinstance(error.value.__cause__, asyncio.TimeoutError)
    process.communicate.assert_awaited_once_with(b"%PDF-test")
    process.kill.assert_called_once_with()
    process.wait.assert_awaited_once_with()


@pytest.mark.parametrize("returncode", [None, 0])
def test_request_cancellation_reaps_child_and_preserves_cancellation(worker, returncode):
    process, _ = worker
    process.returncode = returncode

    async def scenario():
        started = asyncio.Event()

        async def blocked_communicate(_content):
            started.set()
            await asyncio.Event().wait()

        process.communicate.side_effect = blocked_communicate
        task = asyncio.create_task(pdf_extract.extract_pages_isolated(b"%PDF-test"))
        try:
            await asyncio.wait_for(started.wait(), timeout=1)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        finally:
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)

    asyncio.run(scenario())

    if returncode is None:
        process.kill.assert_called_once_with()
    else:
        process.kill.assert_not_called()
    process.wait.assert_awaited_once_with()


def test_communication_error_reaps_child_and_propagates(worker):
    process, _ = worker
    process.returncode = None
    failure = OSError("pipe failed")
    process.communicate.side_effect = failure

    with pytest.raises(OSError) as error:
        asyncio.run(pdf_extract.extract_pages_isolated(b"%PDF-test"))

    assert error.value is failure
    process.kill.assert_called_once_with()
    process.wait.assert_awaited_once_with()


@pytest.mark.parametrize("returncode", [1, -9])
def test_failed_worker_has_safe_import_error(worker, returncode):
    process, _ = worker
    process.returncode = returncode
    process.communicate.return_value = (b"private worker diagnostic", b"")

    with pytest.raises(pdf_extract.PDFImportError, match="解析进程已停止") as error:
        asyncio.run(pdf_extract.extract_pages_isolated(b"%PDF-test"))

    assert "private worker diagnostic" not in str(error.value)
    process.kill.assert_not_called()


def test_worker_pdf_error_is_preserved(worker):
    process, _ = worker
    message = "暂不支持加密 PDF，请先在本机解密后重新导入。"
    process.communicate.return_value = (json.dumps({"error": message}).encode("utf-8"), b"")

    with pytest.raises(pdf_extract.PDFImportError) as error:
        asyncio.run(pdf_extract.extract_pages_isolated(b"%PDF-test"))

    assert str(error.value) == message


@pytest.mark.parametrize("output", [b"not JSON", b"{}", b"[]", b"null", b'{"pages":[]}'])
def test_malformed_worker_result_has_safe_import_error(worker, output):
    process, _ = worker
    process.communicate.return_value = (output, b"")

    with pytest.raises(pdf_extract.PDFImportError, match="未返回有效结果"):
        asyncio.run(pdf_extract.extract_pages_isolated(b"%PDF-test"))

