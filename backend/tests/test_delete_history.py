import asyncio
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app import storage as storage_module
from app.jobs import JobError, JobManager
from app.main import create_app
from app.models import AnalysisJob, AnalysisResult
from app.storage import Storage, now


def saved_job(store, paper_id, status="completed"):
    stamp = now()
    result = AnalysisResult(title="Theorem 1", target_found=False, statement=[],
                            intuitive_explanation=[], symbols=[],
                            proof={"goal": [], "strategy": [], "sections": []},
                            relations=[], importance=[], limitations=["Not found"])
    job = AnalysisJob(id=str(uuid4()), paper_id=paper_id, target="Theorem 1",
                      status=status, stage=status, created_at=stamp, updated_at=stamp,
                      result=result if status == "completed" else None)
    store.save_job(job)
    return job


@pytest.fixture
def store(tmp_path):
    return Storage(tmp_path / "data")


@pytest.mark.parametrize("status", ["completed", "failed", "cancelled"])
def test_delete_terminal_job_removes_only_its_record_result_and_work(store, status):
    paper = store.create_paper("paper.pdf", b"original-pdf", ["original page"], [])
    job = saved_job(store, paper.id, status)
    sibling = saved_job(store, paper.id)
    work = store.job_workdir(job.id)
    (work / "codex-runtime").mkdir()
    (work / "codex-runtime" / "session.db").write_bytes(b"private work")
    (work / "output.json").write_text("private result")
    other_work = store.job_workdir(sibling.id)
    (other_work / "keep.txt").write_text("keep")

    asyncio.run(JobManager(store).delete(job.id))

    assert not (store.jobs_dir / (job.id + ".json")).exists()
    assert not work.exists()
    assert store.list_jobs() == [sibling]
    assert (other_work / "keep.txt").read_text() == "keep"
    assert store.get_paper(paper.id) == paper
    assert store.pdf_path(paper.id).read_bytes() == b"original-pdf"
    assert store.get_pages(paper.id) == ["original page"]
    assert Storage(store.root).list_jobs() == [sibling]


def test_job_without_work_directory_can_be_deleted(store):
    job = saved_job(store, str(uuid4()))
    store.delete_job(job.id)
    assert store.list_jobs() == []


@pytest.mark.parametrize("identifier", ["../papers", "..", "/tmp/secret", "not-a-uuid",
                                         "00000000000000000000000000000000"])
def test_invalid_job_id_never_changes_storage(store, identifier):
    job = saved_job(store, str(uuid4()))
    with pytest.raises(ValueError):
        store.delete_job(identifier)
    assert store.get_job(job.id) == job


def test_unknown_job_does_not_delete_orphan_work(store):
    identifier = str(uuid4())
    work = store.job_workdir(identifier)
    (work / "keep.txt").write_text("keep")
    with pytest.raises(FileNotFoundError):
        store.delete_job(identifier)
    assert (work / "keep.txt").read_text() == "keep"


@pytest.mark.parametrize("link_kind", ["record", "work"])
def test_symlink_record_or_job_directory_is_rejected_without_following(store, tmp_path, link_kind):
    job = saved_job(store, str(uuid4()))
    outside = tmp_path / "outside"
    outside.mkdir()
    sentinel = outside / "keep.txt"
    sentinel.write_text("keep")
    record = store.jobs_dir / (job.id + ".json")
    if link_kind == "record":
        outside_record = outside / "job.json"
        record.rename(outside_record)
        record.symlink_to(outside_record)
    else:
        (store.work_dir / job.id).symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError):
        store.delete_job(job.id)
    assert record.exists()
    assert sentinel.read_text() == "keep"


def test_nested_artifact_symlinks_are_unlinked_not_followed(store, tmp_path):
    job = saved_job(store, str(uuid4()))
    work = store.job_workdir(job.id)
    outside = tmp_path / "outside"
    outside.mkdir()
    sentinel = outside / "keep.txt"
    sentinel.write_text("keep")
    (work / "linked-directory").symlink_to(outside, target_is_directory=True)
    (work / "linked-file").symlink_to(sentinel)
    (work / "dangling-link").symlink_to(outside / "missing")
    store.delete_job(job.id)
    assert not work.exists()
    assert sentinel.read_text() == "keep"


@pytest.mark.parametrize("directory_name", ["root", "analyses", "work"])
def test_replaced_storage_directory_symlinks_are_rejected(store, tmp_path, directory_name):
    job = saved_job(store, str(uuid4()))
    work = store.job_workdir(job.id)
    (work / "keep.txt").write_text("keep")
    directory = store.root if directory_name == "root" else store.root / directory_name
    moved = tmp_path / "moved"
    directory.rename(moved)
    directory.symlink_to(moved, target_is_directory=True)
    with pytest.raises(ValueError):
        store.delete_job(job.id)
    assert (store.jobs_dir / (job.id + ".json")).exists()
    assert (work / "keep.txt").read_text() == "keep"


def test_partial_work_cleanup_failure_keeps_record_for_retry(store, monkeypatch):
    job = saved_job(store, str(uuid4()))
    work = store.job_workdir(job.id)
    (work / "partial.txt").write_text("partial")
    (work / "remaining.txt").write_text("remaining")
    real_cleanup = storage_module._remove_work_directory

    def fail_after_first_file(path):
        (path / "partial.txt").unlink()
        raise PermissionError("simulated cleanup failure")

    monkeypatch.setattr(storage_module, "_remove_work_directory", fail_after_first_file)
    with pytest.raises(JobError) as error:
        asyncio.run(JobManager(store).delete(job.id))
    assert error.value.status_code == 500
    assert store.get_job(job.id) == job
    assert (work / "remaining.txt").read_text() == "remaining"
    monkeypatch.setattr(storage_module, "_remove_work_directory", real_cleanup)
    asyncio.run(JobManager(store).delete(job.id))
    assert store.list_jobs() == []


@pytest.mark.parametrize("status", ["queued", "running"])
def test_manager_rejects_unfinished_records_even_without_a_live_task(store, status):
    job = saved_job(store, str(uuid4()), status)
    with pytest.raises(JobError) as error:
        asyncio.run(JobManager(store).delete(job.id))
    assert error.value.status_code == 409
    assert "取消" in str(error.value)
    assert store.get_job(job.id) == job


def test_manager_rejects_live_task_even_if_persisted_status_is_terminal(store):
    job = saved_job(store, str(uuid4()), "completed")
    manager = JobManager(store)

    async def scenario():
        manager._active_id = job.id
        manager._task = asyncio.create_task(asyncio.Event().wait())
        try:
            with pytest.raises(JobError) as error:
                await manager.delete(job.id)
            assert error.value.status_code == 409
            assert store.get_job(job.id) == job
        finally:
            manager._task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await manager._task

    asyncio.run(scenario())


def test_cancel_then_delete_awaits_worker_and_record_stays_deleted(store):
    job = saved_job(store, str(uuid4()), "running")
    manager = JobManager(store)

    async def scenario():
        entered = asyncio.Event()

        async def worker():
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                job.status = "cancelled"
                store.save_job(job)

        manager._active_id = job.id
        manager._task = asyncio.create_task(worker())
        await entered.wait()
        assert (await manager.cancel(job.id)).status == "cancelled"
        await manager.delete(job.id)
        await asyncio.sleep(0)
        assert store.list_jobs() == []
        assert manager._active_id is None
        assert manager._task is None

    asyncio.run(scenario())


def test_delete_uses_manager_running_lock(store):
    job = saved_job(store, str(uuid4()))
    manager = JobManager(store)

    async def scenario():
        lock = manager._running_lock()
        await lock.acquire()
        task = asyncio.create_task(manager.delete(job.id))
        await asyncio.sleep(0)
        assert not task.done()
        assert store.get_job(job.id) == job
        lock.release()
        await task
        assert store.list_jobs() == []

    asyncio.run(scenario())


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PAPER_READER_LOCAL_TOKEN", "test-local-secret")
    with TestClient(create_app(tmp_path / "data"), base_url="http://127.0.0.1:8100",
                    headers={"X-Reader-Token": "test-local-secret"}) as client:
        yield client


def test_api_delete_contract_and_paper_retention(client):
    store = client.app.state.storage
    paper = store.create_paper("paper.pdf", b"original-pdf", ["original page"], [])
    job = saved_job(store, paper.id)
    response = client.delete("/api/analyses/" + job.id)
    assert response.status_code == 200
    assert response.json() == {"deleted_id": job.id}
    assert client.get("/api/analyses/" + job.id).status_code == 404
    assert client.get("/api/analyses").json() == []
    assert client.get("/api/papers/" + paper.id + "/pdf").content == b"original-pdf"
    assert client.get("/api/papers/" + paper.id + "/pages/1").json()["text"] == "original page"
    assert client.delete("/api/analyses/" + job.id).status_code == 404


@pytest.mark.parametrize("identifier", ["invalid", str(uuid4())])
def test_api_delete_unknown_or_malformed_id_is_404(client, identifier):
    assert client.delete("/api/analyses/" + identifier).status_code == 404


@pytest.mark.parametrize("status", ["queued", "running"])
def test_api_delete_unfinished_is_409(client, status):
    store = client.app.state.storage
    job = saved_job(store, str(uuid4()), status)
    response = client.delete("/api/analyses/" + job.id)
    assert response.status_code == 409
    assert "取消" in response.json()["detail"]
    assert store.get_job(job.id) == job


def test_api_delete_protects_record_from_unauthorized_requests(client):
    store = client.app.state.storage
    job = saved_job(store, str(uuid4()))
    path = "/api/analyses/" + job.id
    assert client.delete(path, headers={"X-Reader-Token": ""}).status_code == 403
    assert client.delete(path, headers={"X-Reader-Token": "wrong"}).status_code == 403
    assert client.delete(path, headers={"Host": "attacker.example"}).status_code == 403
    assert store.get_job(job.id) == job


def test_delete_cors_preflight_allows_configured_origin(client):
    response = client.options("/api/analyses/" + str(uuid4()), headers={
        "Origin": "http://127.0.0.1:3000", "Access-Control-Request-Method": "DELETE",
        "Access-Control-Request-Headers": "X-Reader-Token"})
    assert response.status_code == 200
    assert "DELETE" in response.headers["access-control-allow-methods"]


def test_api_delete_reports_cleanup_error_without_exposing_private_paths(client, monkeypatch):
    store = client.app.state.storage
    job = saved_job(store, str(uuid4()))

    def fail(*args):
        raise PermissionError("/private/sensitive/path")

    monkeypatch.setattr(store, "delete_job", fail)
    response = client.delete("/api/analyses/" + job.id)
    assert response.status_code == 500
    assert "记录仍保留" in response.json()["detail"]
    assert "sensitive" not in response.text
    assert store.get_job(job.id) == job
