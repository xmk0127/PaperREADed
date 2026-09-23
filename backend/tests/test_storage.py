import os
from uuid import uuid4

import pytest

from app.models import AnalysisJob
from app.storage import Storage, now


def test_environment_storage_is_isolated_and_explicit_root_wins(tmp_path, monkeypatch):
    isolated = tmp_path / "isolated"
    monkeypatch.setenv("READER_STORAGE_ROOT", str(isolated))
    assert Storage().root == isolated
    assert Storage(tmp_path / "explicit").root == tmp_path / "explicit"
    assert Storage().list_papers() == []


def test_environment_storage_rejects_relative_paths(monkeypatch):
    monkeypatch.setenv("READER_STORAGE_ROOT", "unexpected-relative-folder")
    with pytest.raises(ValueError, match="absolute"):
        Storage()


def test_paper_roundtrip_uses_private_permissions_and_safe_filename(tmp_path):
    store = Storage(tmp_path / "data")
    paper = store.create_paper("../../a.pdf", b"%PDF-test", ["first page", ""], ["empty page"])
    assert paper.filename == "a.pdf"
    assert store.get_paper(paper.id) == paper
    assert store.get_pages(paper.id) == ["first page", ""]
    assert store.pdf_path(paper.id).read_bytes() == b"%PDF-test"
    assert store.list_papers() == [paper]
    assert os.stat(store.root).st_mode & 0o777 == 0o700
    assert os.stat(store.paper_directory(paper.id)).st_mode & 0o777 == 0o700
    assert os.stat(store.pdf_path(paper.id)).st_mode & 0o777 == 0o600
    assert os.stat(store.paper_directory(paper.id) / "pages.json").st_mode & 0o777 == 0o600
    assert Storage(store.root).get_paper(paper.id) == paper


@pytest.mark.parametrize("identifier", ["../secret", "/tmp/secret", "not-a-uuid", "A" * 32])
def test_identifiers_cannot_escape_storage(tmp_path, identifier):
    store = Storage(tmp_path / "data")
    with pytest.raises(ValueError):
        store.get_paper(identifier)
    with pytest.raises(ValueError):
        store.get_job(identifier)
    with pytest.raises(ValueError):
        store.job_workdir(identifier)


def test_atomic_write_preserves_previous_file_on_failure(tmp_path, monkeypatch):
    store = Storage(tmp_path / "data")
    path = store.root / "test.json"
    store._write_json(path, {"original": True})

    def fail_replace(*args):
        raise OSError("simulated disk failure")

    monkeypatch.setattr("app.storage.os.replace", fail_replace)
    with pytest.raises(OSError):
        store._write_json(path, {"replacement": True})
    assert store._read_json(path) == {"original": True}
    assert not list(store.root.glob(".write-*"))


def test_job_roundtrip_and_incomplete_imports_are_ignored(tmp_path):
    store = Storage(tmp_path / "data")
    (store.papers_dir / str(uuid4())).mkdir()
    stamp = now()
    job = AnalysisJob(id=str(uuid4()), paper_id=str(uuid4()), target="Theorem 1",
                      status="queued", stage="queued", created_at=stamp, updated_at=stamp)
    store.save_job(job)
    assert Storage(store.root).get_job(job.id) == job
    assert store.list_jobs() == [job]
    assert store.list_papers() == []


def test_symlink_paper_directories_are_rejected(tmp_path):
    store = Storage(tmp_path / "data")
    paper_id = str(uuid4())
    (store.papers_dir / paper_id).symlink_to(tmp_path, target_is_directory=True)
    with pytest.raises(ValueError):
        store.get_paper(paper_id)
