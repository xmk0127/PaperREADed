from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from app import codex_runner
from app.main import create_app
from app.models import AnalysisResult, CodexStatus
from app.pdf_extract import PDFImportError, extract_pages


def pdf_bytes(text="Theorem 1 holds", page_count=1):
    writer = PdfWriter()
    for index in range(page_count):
        page = writer.add_blank_page(width=612, height=792)
        if text:
            font = DictionaryObject({NameObject("/Type"): NameObject("/Font"),
                                     NameObject("/Subtype"): NameObject("/Type1"),
                                     NameObject("/BaseFont"): NameObject("/Helvetica")})
            page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})})
            stream = DecodedStreamObject()
            stream.set_data(("BT /F1 12 Tf 50 700 Td (" + text + ") Tj ET").encode())
            page[NameObject("/Contents")] = writer._add_object(stream)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PAPER_READER_LOCAL_TOKEN", "test-local-secret")

    async def status():
        return CodexStatus(installed=True, authenticated=True, auth_method="chatgpt", version="test", message="ready")

    async def run(*args):
        return AnalysisResult(title="Theorem 1", target_found=False, statement=[], intuitive_explanation=[],
                              symbols=[], proof={"goal": [], "strategy": [], "sections": []},
                              relations=[], importance=[], limitations=["未找到指定结论"])

    monkeypatch.setattr(codex_runner, "codex_status", status)
    monkeypatch.setattr(codex_runner, "run_analysis", run)
    with TestClient(create_app(tmp_path / "data"), base_url="http://127.0.0.1:8100",
                    headers={"X-Reader-Token": "test-local-secret"}) as test_client:
        yield test_client


def test_import_read_pdf_and_original_page_text(client):
    content = pdf_bytes()
    imported = client.post("/api/papers", files={"file": ("../paper.pdf", content, "application/pdf")})
    assert imported.status_code == 201
    paper = imported.json()
    assert paper["text_available"] is True
    assert paper["filename"] == "paper.pdf"
    assert paper["page_count"] == 1
    assert client.get("/api/papers").json() == [paper]
    assert client.get(f"/api/papers/{paper['id']}/pdf").content == content
    assert client.get(f"/api/papers/{paper['id']}/pages/1").json() == {"page": 1, "text": "Theorem 1 holds"}
    assert client.get(f"/api/papers/{paper['id']}/pages/0").status_code == 404
    assert client.get(f"/api/papers/{paper['id']}/pages/2").status_code == 404
    assert client.get("/api/analyses").json() == []


def test_analysis_requires_explicit_consent_and_a_concrete_target(client):
    paper = client.post("/api/papers", files={"file": ("p.pdf", pdf_bytes())}).json()
    base = {"paper_id": paper["id"], "target": "Theorem 1"}
    assert client.post("/api/analyses", json=base).status_code == 422
    assert client.post("/api/analyses", json={**base, "processing_consent": False}).status_code == 422
    assert client.post("/api/analyses", json={**base, "target": "  ", "processing_consent": True}).status_code == 422
    assert client.get("/api/analyses").json() == []


def test_job_endpoints_return_complete_contract(client):
    paper = client.post("/api/papers", files={"file": ("p.pdf", pdf_bytes())}).json()
    response = client.post("/api/analyses", json={"paper_id": paper["id"], "target": "Theorem 1", "processing_consent": True})
    assert response.status_code == 202
    job = response.json()
    assert set(job) == {"id", "paper_id", "target", "instructions", "status", "stage", "created_at", "updated_at", "error", "result"}
    saved = client.get("/api/analyses/" + job["id"]).json()
    assert saved["status"] == "completed"
    assert saved["result"]["target_found"] is False
    assert client.get("/api/analyses").json()[0]["id"] == job["id"]
    assert client.post("/api/analyses/" + job["id"] + "/cancel").json()["status"] == "completed"


def test_blank_pdf_imports_with_warning_but_cannot_start_analysis(client):
    response = client.post("/api/papers", files={"file": ("scanned.pdf", pdf_bytes(text=""))})
    assert response.status_code == 201
    paper = response.json()
    assert paper["text_available"] is False
    assert paper["warnings"]
    response = client.post("/api/analyses", json={"paper_id": paper["id"], "target": "Theorem 1", "processing_consent": True})
    assert response.status_code == 400


@pytest.mark.parametrize("content", [b"not a pdf", b"%PDF-1.7\nbroken"])
def test_corrupt_pdf_rejected_without_import(client, content):
    assert client.post("/api/papers", files={"file": ("bad.pdf", content)}).status_code == 422
    assert client.get("/api/papers").json() == []


def test_page_count_limit_is_enforced():
    with pytest.raises(PDFImportError, match="250"):
        extract_pages(pdf_bytes(text="", page_count=251))


def test_import_and_jobs_survive_application_restart(client):
    paper = client.post("/api/papers", files={"file": ("p.pdf", pdf_bytes())}).json()
    path = client.app.state.storage.root
    with TestClient(create_app(path), base_url="http://127.0.0.1:8100", headers={"X-Reader-Token": "test-local-secret"}) as restarted:
        assert restarted.get("/api/papers").json()[0]["id"] == paper["id"]


def test_unknown_papers_and_jobs_are_not_found(client):
    assert client.get("/api/papers/not-a-uuid/pdf").status_code == 404
    assert client.get("/api/analyses/not-a-uuid").status_code == 404
    assert client.post("/api/analyses/not-a-uuid/cancel").status_code == 404
    assert client.post("/api/analyses", json={"paper_id": "missing", "target": "Theorem 1", "processing_consent": True}).status_code == 404
