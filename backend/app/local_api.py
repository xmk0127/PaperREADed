"""Local-only API routes, protected by the application launch-token middleware."""

from typing import Dict, List

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from . import codex_runner
from .arxiv_import import ArxivImportError, download_arxiv_pdf, parse_arxiv_reference
from .jobs import JobError
from .models import AnalysisJob, AnalysisRequest, ArxivImportRequest, CodexStatus, Paper
from .pdf_extract import MAX_PDF_BYTES, PDFImportError, extract_pages_isolated

router = APIRouter(prefix="/api")


@router.get("/codex/status", response_model=CodexStatus)
async def codex_status():
    return await codex_runner.codex_status()


@router.get("/papers", response_model=List[Paper])
def list_papers(request: Request):
    return request.app.state.storage.list_papers()


@router.post("/papers", response_model=Paper, status_code=201)
async def upload_paper(request: Request, file: UploadFile = File(...)):
    try:
        content = await file.read(MAX_PDF_BYTES + 1)
        if len(content) > MAX_PDF_BYTES:
            raise HTTPException(413, "PDF 大小不能超过 30 MiB。")
        try:
            pages, warnings = await extract_pages_isolated(content)
        except PDFImportError as exc:
            raise HTTPException(422, str(exc)) from exc
        return await run_in_threadpool(request.app.state.storage.create_paper,
                                      file.filename or "paper.pdf", content, pages, warnings)
    finally:
        await file.close()


@router.post("/papers/arxiv", response_model=Paper, status_code=201)
async def import_arxiv_paper(payload: ArxivImportRequest, request: Request):
    try:
        identifier = parse_arxiv_reference(payload.reference)
        content = await download_arxiv_pdf(identifier)
        pages, warnings = await extract_pages_isolated(content)
    except ArxivImportError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    except PDFImportError as exc:
        raise HTTPException(422, str(exc)) from exc
    filename = "arxiv-" + identifier.replace("/", "-") + ".pdf"
    return await run_in_threadpool(request.app.state.storage.create_paper,
                                  filename, content, pages, warnings)


@router.get("/papers/{paper_id}/pdf")
def get_pdf(paper_id: str, request: Request):
    try:
        paper = request.app.state.storage.get_paper(paper_id)
        path = request.app.state.storage.pdf_path(paper_id)
    except (ValueError, FileNotFoundError):
        raise HTTPException(404, "未找到该论文。")
    return FileResponse(path, media_type="application/pdf", filename=paper.filename,
                        content_disposition_type="inline", headers={"Cache-Control": "no-store"})


@router.get("/papers/{paper_id}/pages/{page}")
def get_page(paper_id: str, page: int, request: Request):
    try:
        pages = request.app.state.storage.get_pages(paper_id)
    except (ValueError, FileNotFoundError):
        raise HTTPException(404, "未找到该论文。")
    if page < 1 or page > len(pages):
        raise HTTPException(404, "未找到该 PDF 页。")
    return {"page": page, "text": pages[page - 1]}


@router.get("/analyses", response_model=List[AnalysisJob])
def list_analyses(request: Request):
    return request.app.state.storage.list_jobs()


@router.post("/analyses", response_model=AnalysisJob, status_code=202)
async def start_analysis(payload: AnalysisRequest, request: Request):
    try:
        return await request.app.state.jobs.start(payload)
    except JobError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc


@router.get("/analyses/{job_id}", response_model=AnalysisJob)
def get_analysis(job_id: str, request: Request):
    try:
        return request.app.state.storage.get_job(job_id)
    except (ValueError, FileNotFoundError):
        raise HTTPException(404, "未找到该分析任务。")


@router.post("/analyses/{job_id}/cancel", response_model=AnalysisJob)
async def cancel_analysis(job_id: str, request: Request):
    try:
        return await request.app.state.jobs.cancel(job_id)
    except (ValueError, FileNotFoundError):
        raise HTTPException(404, "未找到该分析任务。")


@router.delete("/analyses/{job_id}", response_model=Dict[str, str])
async def delete_analysis(job_id: str, request: Request):
    try:
        await request.app.state.jobs.delete(job_id)
    except JobError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    return {"deleted_id": job_id}
