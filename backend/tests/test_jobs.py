import asyncio
from uuid import uuid4

import pytest

from app import codex_runner
from app.jobs import JobError, JobManager, validate_sources
from app.models import AnalysisJob, AnalysisRequest, AnalysisResult, CodexStatus
from app.storage import Storage, now


def result_data():
    return {"title": "Theorem 1", "target_found": True,
            "statement": [{"kind": "paragraph", "text": "解释", "source": {
                "pages": [1], "evidence": "Theorem 1 holds", "inferred": False}}],
            "intuitive_explanation": [], "symbols": [],
            "proof": {"goal": [], "strategy": [], "sections": []},
            "relations": [], "importance": [], "limitations": []}


async def authenticated():
    return CodexStatus(installed=True, authenticated=True, auth_method="chatgpt", version="test", message="ready")


def setup_job(tmp_path, monkeypatch, pages=None):
    store = Storage(tmp_path / "data")
    paper = store.create_paper("paper.pdf", b"pdf", pages or ["Theorem 1 holds"], [])
    request = AnalysisRequest(paper_id=paper.id, target="Theorem 1", processing_consent=True)
    monkeypatch.setattr(codex_runner, "codex_status", authenticated)
    return store, JobManager(store), request


def test_success_is_persisted_and_sources_are_checked(tmp_path, monkeypatch):
    store, manager, request = setup_job(tmp_path, monkeypatch)

    async def fake_run(pages, target, instructions, workdir):
        assert pages == ["Theorem 1 holds"]
        assert target == "Theorem 1"
        assert workdir.is_dir()
        return AnalysisResult.model_validate(result_data())

    monkeypatch.setattr(codex_runner, "run_analysis", fake_run)

    async def scenario():
        job = await manager.start(request)
        assert job.status == "queued"
        await manager._task
        saved = Storage(store.root).get_job(job.id)
        assert saved.status == "completed"
        assert saved.result.statement[0].source.inferred is False

    asyncio.run(scenario())


def test_busy_request_is_rejected_and_cancellation_reaches_runner(tmp_path, monkeypatch):
    store, manager, request = setup_job(tmp_path, monkeypatch)

    async def scenario():
        entered = asyncio.Event()
        cancelled = asyncio.Event()

        async def fake_run(*args):
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        monkeypatch.setattr(codex_runner, "run_analysis", fake_run)
        job = await manager.start(request)
        await entered.wait()
        with pytest.raises(JobError) as error:
            await manager.start(request)
        assert error.value.status_code == 409
        final = await manager.cancel(job.id)
        assert cancelled.is_set()
        assert final.status == "cancelled"
        assert final.result is None

    asyncio.run(scenario())


def test_shutdown_also_cancels_a_queued_task(tmp_path, monkeypatch):
    store, manager, request = setup_job(tmp_path, monkeypatch)

    async def scenario():
        job = await manager.start(request)
        await manager.shutdown()
        assert store.get_job(job.id).status == "cancelled"
        with pytest.raises(JobError) as error:
            await manager.start(request)
        assert error.value.status_code == 503

    asyncio.run(scenario())


def test_restart_marks_unfinished_jobs_failed_without_running(tmp_path, monkeypatch):
    store, manager, request = setup_job(tmp_path, monkeypatch)
    stamp = now()
    for status in ["queued", "running"]:
        store.save_job(AnalysisJob(id=str(uuid4()), paper_id=request.paper_id, target="Theorem 1",
                                  status=status, stage=status, created_at=stamp, updated_at=stamp))
    manager.recover()
    assert all(job.status == "failed" and "未自动" in job.error for job in store.list_jobs())
    assert manager._task is None


@pytest.mark.parametrize("pages,code", [([""], 400), (["x" * 600001], 413)])
def test_scanned_or_oversized_text_never_reaches_codex(tmp_path, monkeypatch, pages, code):
    store, manager, request = setup_job(tmp_path, monkeypatch, pages)

    async def forbidden():
        pytest.fail("must reject before checking Codex")

    monkeypatch.setattr(codex_runner, "codex_status", forbidden)
    with pytest.raises(JobError) as error:
        asyncio.run(manager.start(request))
    assert error.value.status_code == code
    assert store.list_jobs() == []


def test_api_key_auth_does_not_start_job(tmp_path, monkeypatch):
    store, manager, request = setup_job(tmp_path, monkeypatch)

    async def api_key():
        return CodexStatus(installed=True, authenticated=True, auth_method="api_key", version="test", message="API key")

    monkeypatch.setattr(codex_runner, "codex_status", api_key)
    with pytest.raises(JobError) as error:
        asyncio.run(manager.start(request))
    assert error.value.status_code == 503
    assert store.list_jobs() == []


def test_runner_error_is_persisted(tmp_path, monkeypatch):
    store, manager, request = setup_job(tmp_path, monkeypatch)

    async def fail(*args):
        raise codex_runner.CodexError("登录过期")

    monkeypatch.setattr(codex_runner, "run_analysis", fail)

    async def scenario():
        job = await manager.start(request)
        await manager._task
        saved = store.get_job(job.id)
        assert saved.status == "failed"
        assert saved.error == "登录过期"

    asyncio.run(scenario())


def test_evidence_mismatch_is_not_presented_as_original_quote():
    data = result_data()
    data["symbols"] = [{"symbol": "x", "meaning": "x", "explanation": "解释",
                        "source": {"pages": [1], "evidence": "Invented quote", "inferred": False}}]
    result = validate_sources(AnalysisResult.model_validate(data), ["Theorem  1\nholds"])
    assert result.statement[0].source.inferred is False
    assert result.symbols[0].source.inferred is True
    assert result.symbols[0].source.evidence == ""
    assert result.limitations


def test_nonconsecutive_pages_cannot_be_stitched_into_a_quote():
    data = result_data()
    data["statement"][0]["source"] = {"pages": [1, 3], "evidence": "firstlast", "inferred": False}
    result = validate_sources(AnalysisResult.model_validate(data), ["first", "middle", "last"])
    assert result.statement[0].source.inferred
    assert result.statement[0].source.evidence == ""


def test_consecutive_pages_support_a_quote_across_page_break():
    data = result_data()
    data["statement"][0]["source"] = {"pages": [1, 2], "evidence": "firstlast", "inferred": False}
    result = validate_sources(AnalysisResult.model_validate(data), ["first", "last"])
    assert result.statement[0].source.inferred is False


def test_shutdown_during_login_check_never_starts_analysis(tmp_path, monkeypatch):
    store, manager, request = setup_job(tmp_path, monkeypatch)

    async def scenario():
        checking = asyncio.Event()
        release = asyncio.Event()

        async def delayed_status():
            checking.set()
            await release.wait()
            return await authenticated()

        monkeypatch.setattr(codex_runner, "codex_status", delayed_status)
        start = asyncio.create_task(manager.start(request))
        await checking.wait()
        await manager.shutdown()
        release.set()
        with pytest.raises(JobError) as error:
            await start
        assert error.value.status_code == 503
        assert store.list_jobs() == []
        assert manager._task is None

    asyncio.run(scenario())


@pytest.mark.parametrize("location", ["statement", "symbol", "importance", "proof", "relation"])
def test_every_nested_source_rejects_out_of_range_pages(location):
    data = result_data()
    block = {"kind": "paragraph", "text": "bad", "source": {"pages": [2], "evidence": "bad", "inferred": True}}
    if location == "statement":
        data["statement"] = [block]
    elif location == "symbol":
        data["symbols"] = [{"symbol": "x", "meaning": "x", "explanation": "x", "source": block["source"]}]
    elif location == "importance":
        data["importance"] = [{"title": "importance", "blocks": [block]}]
    elif location == "proof":
        data["proof"]["sections"] = [{"title": "proof", "blocks": [block]}]
    else:
        data["relations"] = [{"target": "other", "statement": [], "explanation": [block]}]
    with pytest.raises(ValueError, match="页码"):
        validate_sources(AnalysisResult.model_validate(data), ["Theorem 1 holds"])
