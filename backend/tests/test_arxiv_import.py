import asyncio
from http.client import IncompleteRead
from io import BytesIO
import json
import ssl
from urllib.error import HTTPError, URLError

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter

from app import arxiv_import, codex_runner, local_api
from app.arxiv_import import ArxivImportError, parse_arxiv_reference
from app.main import create_app


@pytest.mark.parametrize("reference,expected", [
    ("2309.07041", "2309.07041"),
    ("  https://arxiv.org/pdf/2309.07041  ", "2309.07041"),
    ("https://arxiv.org/abs/2309.07041v2", "2309.07041v2"),
    ("http://www.arxiv.org/pdf/2309.07041v2.pdf", "2309.07041v2"),
    ("arXiv:2309.07041", "2309.07041"),
    ("0704.0001", "0704.0001"),
    ("1412.9999v12", "1412.9999v12"),
    ("1501.00001", "1501.00001"),
    ("hep-th/9901001", "hep-th/9901001"),
    ("https://arxiv.org/pdf/math.GT/0309136v1.pdf", "math.GT/0309136v1"),
    ("https://arxiv.org/abs/cond-mat/0703001", "cond-mat/0703001"),
])
def test_reference_formats(reference, expected):
    assert parse_arxiv_reference(reference) == expected


@pytest.mark.parametrize("reference", [
    "", " ", "x" * 501, "2300.07041", "2313.07041", "2309.00000", "2309.7041",
    "0703.0001", "1412.00001", "1501.0001", "2309.07041v0", "2309.07041v-1",
    "hep-th/9101001", "hep-th/0704001", "math/0313001", "math/0309000",
    "https://evil.example/pdf/2309.07041", "https://arxiv.org.evil.example/pdf/2309.07041",
    "https://arxiv.org@127.0.0.1/pdf/2309.07041", "https://name:pass@arxiv.org/pdf/2309.07041",
    "https://arxiv.org:443/pdf/2309.07041", "https://127.0.0.1/pdf/2309.07041",
    "http://169.254.169.254/latest/meta-data/", "file:///etc/passwd", "ftp://arxiv.org/pdf/2309.07041",
    "https://arxiv.org/pdf/2309.07041?url=http://127.0.0.1", "https://arxiv.org/pdf/2309.07041#page=2",
    "https://arxiv.org/pdf/../2309.07041", "https://arxiv.org/pdf/%32%33%30%39.07041",
    "https://arxiv.org/pdf/2309.07041/extra", "https://arxiv.org\\@evil.example/pdf/2309.07041",
    "https://arxiv.org/abs/2309.07041\nextra", "2309.07041\x00", "２３０９.０７０４１",
])
def test_invalid_reference_and_ssrf_inputs_rejected(reference):
    with pytest.raises(ArxivImportError):
        parse_arxiv_reference(reference)


class Response(BytesIO):
    def __init__(self, content=b"%PDF-1.7\npayload", headers=None, status=200):
        super().__init__(content)
        self.headers = headers if headers is not None else {"Content-Type": "application/pdf"}
        self.status = status
        self.read_sizes = []

    def read(self, size):
        self.read_sizes.append(size)
        return super().read(size)


def mock_download(monkeypatch, response=None, error=None):
    calls = []

    class Opener:
        def open(self, request, timeout):
            calls.append((request, timeout))
            if error is not None:
                raise error
            return response

    def build(*handlers):
        assert handlers[0].proxies == {}
        assert isinstance(handlers[1], arxiv_import._NoRedirect)
        return Opener()

    monkeypatch.setattr(arxiv_import, "build_opener", build)
    return calls


def test_download_only_uses_canonical_https_and_no_credentials(monkeypatch):
    response = Response()
    calls = mock_download(monkeypatch, response)
    assert arxiv_import._download_pdf("https://arxiv.org/abs/2309.07041v2") == b"%PDF-1.7\npayload"
    request, timeout = calls[0]
    assert request.full_url == "https://arxiv.org/pdf/2309.07041v2"
    assert request.get_method() == "GET"
    assert set(key.lower() for key in request.headers) == {"user-agent", "accept", "accept-encoding"}
    assert timeout == 10
    assert response.closed
    assert max(response.read_sizes) <= arxiv_import.READ_CHUNK_BYTES


def test_invalid_reference_makes_no_network_request(monkeypatch):
    calls = mock_download(monkeypatch, Response())
    with pytest.raises(ArxivImportError):
        arxiv_import._download_pdf("https://127.0.0.1/private")
    assert not calls


@pytest.mark.parametrize("target", ["https://arxiv.org/pdf/2309.07041", "http://127.0.0.1/secret", "file:///etc/passwd"])
def test_every_redirect_is_rejected(target):
    with pytest.raises(ArxivImportError, match="跳转"):
        arxiv_import._NoRedirect().redirect_request(None, None, 302, "Found", {}, target)


@pytest.mark.parametrize("response,status", [
    (Response(b"<html>error</html>", {"Content-Type": "text/html"}), 422),
    (Response(b"not a PDF"), 422),
    (Response(b"", {}), 422),
    (Response(headers={"Content-Length": str(30 * 1024 * 1024 + 1)}), 413),
    (Response(headers={"Content-Length": "bad"}), 502),
    (Response(headers={"Content-Length": "-1"}), 502),
    (Response(headers={"Content-Encoding": "gzip"}), 502),
    (Response(status=206), 502),
])
def test_invalid_upstream_response_rejected(monkeypatch, response, status):
    mock_download(monkeypatch, response)
    with pytest.raises(ArxivImportError) as result:
        arxiv_import._download_pdf("2309.07041")
    assert result.value.status_code == status
    assert response.closed


def test_stream_limit_does_not_trust_content_length(monkeypatch):
    monkeypatch.setattr(arxiv_import, "MAX_PDF_BYTES", 12)
    response = Response(b"%PDF-1.7" + b"x" * 100, {"Content-Length": "8"})
    mock_download(monkeypatch, response)
    with pytest.raises(ArxivImportError) as result:
        arxiv_import._download_pdf("2309.07041")
    assert result.value.status_code == 413
    assert response.read_sizes == [13]


@pytest.mark.parametrize("error,status", [
    (HTTPError("https://arxiv.org/pdf/2309.07041", 404, "missing", {}, None), 404),
    (HTTPError("https://arxiv.org/pdf/2309.07041", 429, "limited", {}, None), 503),
    (HTTPError("https://arxiv.org/pdf/2309.07041", 500, "internal", {}, None), 502),
    (URLError("offline"), 502), (TimeoutError("timeout"), 504),
    (IncompleteRead(b"%PDF"), 502),
], ids=["not-found", "rate-limited", "upstream-error", "offline", "timeout", "partial-response"])
def test_network_errors_are_safe_and_actionable(monkeypatch, error, status):
    mock_download(monkeypatch, error=error)
    with pytest.raises(ArxivImportError) as result:
        arxiv_import._download_pdf("2309.07041")
    assert result.value.status_code == status


def test_stream_deadline(monkeypatch):
    values = iter([0, arxiv_import.DOWNLOAD_TIMEOUT])
    monkeypatch.setattr(arxiv_import.time, "monotonic", lambda: next(values))
    mock_download(monkeypatch, Response())
    with pytest.raises(ArxivImportError) as result:
        arxiv_import._download_pdf("2309.07041")
    assert result.value.status_code == 504


@pytest.mark.parametrize("platform,ca_count,load_system", [
    ("darwin", 0, True), ("darwin", 1, False), ("linux", 0, False), ("linux", 1, False),
])
def test_system_ca_fallback_only_fills_empty_macos_store(monkeypatch, platform, ca_count, load_system):
    class Context:
        verify_mode = ssl.CERT_REQUIRED
        check_hostname = True
        loaded = []

        def cert_store_stats(self):
            return {"x509_ca": ca_count}

        def load_verify_locations(self, **kwargs):
            self.loaded.append(kwargs)

    context = Context()
    monkeypatch.setattr(arxiv_import.ssl, "create_default_context", lambda: context)
    monkeypatch.setattr(arxiv_import.sys, "platform", platform)
    monkeypatch.setattr(arxiv_import.Path, "is_file", lambda path: True)
    assert arxiv_import._ssl_context() is context
    assert context.loaded == ([{"cafile": "/etc/ssl/cert.pem"}] if load_system else [])
    assert context.verify_mode == ssl.CERT_REQUIRED
    assert context.check_hostname is True


def test_real_tls_context_always_verifies_server():
    context = arxiv_import._ssl_context()
    assert context.verify_mode == ssl.CERT_REQUIRED
    assert context.check_hostname is True


class Process:
    def __init__(self, content=b"%PDF-1.7", error=b"", returncode=0, hang=False):
        self.content, self.error, self.returncode, self.hang = content, error, returncode, hang
        self.killed = self.waited = False

    async def communicate(self):
        if self.hang:
            await asyncio.sleep(10)
        return self.content, self.error

    def kill(self):
        self.killed = True
        self.returncode = -9

    async def wait(self):
        self.waited = True
        return self.returncode


def subprocess_mock(monkeypatch, process):
    calls = []

    async def spawn(*args, **kwargs):
        calls.append(args)
        return process

    monkeypatch.setattr(arxiv_import.asyncio, "create_subprocess_exec", spawn)
    return calls


def test_download_worker_gets_only_validated_identifier(monkeypatch):
    calls = subprocess_mock(monkeypatch, Process())
    assert asyncio.run(arxiv_import.download_arxiv_pdf("https://arxiv.org/abs/2309.07041")) == b"%PDF-1.7"
    assert calls[0][-3:] == ("app.arxiv_import", "--worker", "2309.07041")


def test_worker_hard_deadline_kills_and_reaps_process(monkeypatch):
    process = Process(returncode=None, hang=True)
    subprocess_mock(monkeypatch, process)
    monkeypatch.setattr(arxiv_import, "DOWNLOAD_TIMEOUT", 0.001)
    with pytest.raises(ArxivImportError) as result:
        asyncio.run(arxiv_import.download_arxiv_pdf("2309.07041"))
    assert result.value.status_code == 504
    assert process.killed and process.waited


def test_cancelled_download_also_kills_worker(monkeypatch):
    process = Process(returncode=None, hang=True)
    subprocess_mock(monkeypatch, process)

    async def cancel():
        task = asyncio.create_task(arxiv_import.download_arxiv_pdf("2309.07041"))
        await asyncio.sleep(0)
        task.cancel()
        await task

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(cancel())
    assert process.killed and process.waited


@pytest.mark.parametrize("error,status", [
    (json.dumps({"error": "PDF 大小不能超过 30 MiB。", "status_code": 413}).encode(), 413),
    (b"traceback includes private details", 502),
    (b'{"error": "bad", "status_code": 200}', 502),
])
def test_worker_error_contract(monkeypatch, error, status):
    subprocess_mock(monkeypatch, Process(error=error, returncode=1))
    with pytest.raises(ArxivImportError) as result:
        asyncio.run(arxiv_import.download_arxiv_pdf("2309.07041"))
    assert result.value.status_code == status
    assert "private details" not in str(result.value)


def make_pdf():
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    content = BytesIO()
    writer.write(content)
    return content.getvalue()


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PAPER_READER_LOCAL_TOKEN", "arxiv-test-token")

    async def no_ai(*args, **kwargs):
        raise AssertionError("Import must not call AI")

    monkeypatch.setattr(codex_runner, "run_analysis", no_ai)
    monkeypatch.setattr(codex_runner, "codex_status", no_ai)
    with TestClient(create_app(tmp_path / "data"), base_url="http://127.0.0.1:8100",
                    headers={"X-Reader-Token": "arxiv-test-token"}) as result:
        yield result


def test_api_import_persists_only_pdf_and_keeps_local_upload(client, monkeypatch):
    content = make_pdf()
    downloads = []

    async def download(identifier):
        downloads.append(identifier)
        return content

    monkeypatch.setattr(local_api, "download_arxiv_pdf", download)
    response = client.post("/api/papers/arxiv", json={"reference": "https://arxiv.org/abs/2309.07041v2"})
    assert response.status_code == 201
    paper = response.json()
    assert downloads == ["2309.07041v2"]
    assert paper["filename"] == "arxiv-2309.07041v2.pdf"
    assert paper["page_count"] == 1
    assert paper["text_available"] is False
    assert paper["warnings"]
    assert client.get("/api/papers/" + paper["id"] + "/pdf").content == content
    assert client.get("/api/papers").json() == [paper]
    assert client.get("/api/analyses").json() == []
    assert client.post("/api/papers", files={"file": ("local.pdf", content)}).status_code == 201
    assert len(client.get("/api/papers").json()) == 2


@pytest.mark.parametrize("payload", [{}, {"reference": ""}, {"reference": "../bad"},
                                     {"reference": "2309.07041", "url": "https://example.com"},
                                     {"reference": "x" * 501}])
def test_api_invalid_reference_does_not_fetch_or_store(client, monkeypatch, payload):
    async def no_download(*args):
        raise AssertionError("Invalid input must not download")

    monkeypatch.setattr(local_api, "download_arxiv_pdf", no_download)
    assert client.post("/api/papers/arxiv", json=payload).status_code == 422
    assert client.get("/api/papers").json() == []
    assert not list(client.app.state.storage.papers_dir.iterdir())


@pytest.mark.parametrize("status", [404, 413, 422, 502, 503, 504])
def test_api_download_failure_writes_nothing(client, monkeypatch, status):
    async def download(*args):
        raise ArxivImportError("下载失败", status)

    monkeypatch.setattr(local_api, "download_arxiv_pdf", download)
    response = client.post("/api/papers/arxiv", json={"reference": "2309.07041"})
    assert response.status_code == status
    assert response.json()["detail"] == "下载失败"
    assert not list(client.app.state.storage.papers_dir.iterdir())
    assert client.get("/api/analyses").json() == []


@pytest.mark.parametrize("content", [b"not a pdf", b"%PDF-1.7 broken"])
def test_api_pdf_validation_failure_writes_nothing(client, monkeypatch, content):
    async def download(*args):
        return content

    monkeypatch.setattr(local_api, "download_arxiv_pdf", download)
    assert client.post("/api/papers/arxiv", json={"reference": "2309.07041"}).status_code == 422
    assert not list(client.app.state.storage.papers_dir.iterdir())


def test_api_arxiv_import_still_requires_launch_token(client, monkeypatch):
    async def no_download(*args):
        raise AssertionError("Unauthorized request must not download")

    monkeypatch.setattr(local_api, "download_arxiv_pdf", no_download)
    response = client.post("/api/papers/arxiv", json={"reference": "2309.07041"}, headers={"X-Reader-Token": "bad"})
    assert response.status_code == 403
