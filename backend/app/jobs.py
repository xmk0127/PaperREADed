"""One cancellable AI task at a time, with restart-safe persisted state."""

import asyncio
import unicodedata
from typing import Any, List, Optional
from uuid import uuid4

from . import codex_runner
from .models import AnalysisJob, AnalysisRequest, AnalysisResult
from .pdf_extract import MAX_ANALYSIS_CHARACTERS
from .storage import Storage, now


class JobError(ValueError):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def normalized(text: str) -> str:
    return "".join(unicodedata.normalize("NFKC", text).split())


def validate_sources(result: AnalysisResult, pages: List[str]) -> AnalysisResult:
    """Verify page ranges and exact normalized excerpts, never invented quotations."""
    data = result.model_dump(mode="json")
    normalized_pages = [normalized(page) for page in pages]
    unsupported = False

    def walk(value: Any) -> None:
        nonlocal unsupported
        if isinstance(value, list):
            for item in value:
                walk(item)
        elif isinstance(value, dict):
            if "source" in value:
                source = value["source"]
                if any(page < 1 or page > len(pages) for page in source["pages"]):
                    raise ValueError("分析结果包含超出论文范围的 PDF 页码，请重试。")
                evidence = normalized(source["evidence"])
                # Only join physically consecutive pages; do not manufacture a
                # continuous quotation by stitching separate passages together.
                chunks: List[str] = []
                previous = None
                for page in sorted(set(source["pages"])):
                    if previous is not None and page == previous + 1:
                        chunks[-1] += normalized_pages[page - 1]
                    else:
                        chunks.append(normalized_pages[page - 1])
                    previous = page
                if not evidence or not any(evidence in chunk for chunk in chunks):
                    if source["evidence"] or not source["inferred"]:
                        unsupported = True
                    source["inferred"] = True
                    source["evidence"] = ""
            for child in value.values():
                walk(child)

    walk(data)
    if unsupported:
        limitation = "部分出处引文无法与对应 PDF 页的提取文本核对，已移除未经验证的引文并标记为推断。"
        if limitation not in data["limitations"]:
            if len(data["limitations"]) >= 100:
                data["limitations"][-1] += " " + limitation
            else:
                data["limitations"].append(limitation)
    return AnalysisResult.model_validate(data)


class JobManager:
    def __init__(self, storage: Storage):
        self.storage = storage
        self._lock: Optional[asyncio.Lock] = None
        self._task: Optional[asyncio.Task] = None
        self._active_id: Optional[str] = None
        self._closed = False

    def _running_lock(self) -> asyncio.Lock:
        # Python 3.9 binds locks at creation; construct only inside the ASGI loop.
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    def recover(self) -> None:
        for job in self.storage.list_jobs():
            if job.status in {"queued", "running"}:
                job.status = "failed"
                job.stage = "任务中断"
                job.error = "服务重启时任务尚未完成；未自动重新发送论文，请手动重试。"
                job.updated_at = now()
                self.storage.save_job(job)

    async def start(self, request: AnalysisRequest) -> AnalysisJob:
        async with self._running_lock():
            if self._closed:
                raise JobError("服务正在关闭，请稍后重试。", 503)
            if self._task and not self._task.done():
                raise JobError("已有分析任务正在运行，请等待完成或先取消。", 409)
            if request.processing_consent is not True:
                raise JobError("请先确认将论文文本发送给 OpenAI 进行分析。")
            try:
                paper = self.storage.get_paper(request.paper_id)
                pages = self.storage.get_pages(request.paper_id)
            except (ValueError, FileNotFoundError):
                raise JobError("未找到该论文，请重新导入。", 404)
            if not paper.text_available or not any(page.strip() for page in pages):
                raise JobError("论文没有可读取文本；扫描件暂不支持 AI 分析。")
            if sum(map(len, pages)) > MAX_ANALYSIS_CHARACTERS:
                raise JobError("论文全文超过 600,000 字符，无法分析；不会截断原文。", 413)
            status = await codex_runner.codex_status()
            if self._closed:
                raise JobError("服务正在关闭，请稍后重试。", 503)
            if not status.installed or not status.authenticated or status.auth_method != "chatgpt":
                raise JobError("请先安装 Codex CLI，并在终端通过 codex login 登录 ChatGPT。" + status.message, 503)
            timestamp = now()
            job = AnalysisJob(id=str(uuid4()), paper_id=paper.id, target=request.target,
                              instructions=request.instructions, status="queued", stage="等待本机 Codex",
                              created_at=timestamp, updated_at=timestamp, error=None, result=None)
            self.storage.save_job(job)
            self._active_id = job.id
            self._task = asyncio.create_task(self._run(job.model_copy(deep=True), pages))
            return job

    async def _run(self, job: AnalysisJob, pages: List[str]) -> None:
        try:
            job.status = "running"
            job.stage = "Codex 正在分析论文"
            job.updated_at = now()
            self.storage.save_job(job)
            result = await codex_runner.run_analysis(pages, job.target, job.instructions,
                                                     self.storage.job_workdir(job.id))
            job.result = validate_sources(AnalysisResult.model_validate(result), pages)
            job.status = "completed"
            job.stage = "分析完成"
        except asyncio.CancelledError:
            job.status = "cancelled"
            job.stage = "已取消"
            job.error = None
            job.result = None
        except codex_runner.CodexError as exc:
            job.status = "failed"
            job.stage = "分析失败"
            job.error = str(exc)[:2000]
        except ValueError as exc:
            job.status = "failed"
            job.stage = "结果验证失败"
            job.error = "AI 结果格式或出处未通过验证，请重试。"
        except Exception:
            job.status = "failed"
            job.stage = "分析失败"
            job.error = "本地分析发生错误，请检查 Codex CLI 后重试。"
        finally:
            job.updated_at = now()
            self.storage.save_job(job)

    async def cancel(self, job_id: str) -> AnalysisJob:
        async with self._running_lock():
            job = self.storage.get_job(job_id)
            if job.status not in {"queued", "running"}:
                return job
            if job_id == self._active_id and self._task and not self._task.done():
                self._task.cancel()
                try:
                    await self._task
                except asyncio.CancelledError:
                    pass
            job = self.storage.get_job(job_id)
            if job.status in {"queued", "running"}:
                job.status = "cancelled"
                job.stage = "已取消"
                job.updated_at = now()
                self.storage.save_job(job)
            return job

    async def shutdown(self) -> None:
        self._closed = True
        if self._active_id and self._task and not self._task.done():
            await self.cancel(self._active_id)

    async def delete(self, job_id: str) -> None:
        async with self._running_lock():
            try:
                job = self.storage.get_job(job_id)
            except (ValueError, FileNotFoundError):
                raise JobError("未找到该分析任务。", 404)
            if (job.status in {"queued", "running"}
                    or (job_id == self._active_id and self._task and not self._task.done())):
                raise JobError("该任务仍在分析中，请先取消或等待完成后再删除。", 409)
            try:
                self.storage.delete_job(job_id)
            except (ValueError, FileNotFoundError):
                raise JobError("未找到可安全删除的分析记录。", 404)
            except OSError:
                raise JobError("删除未完成，记录仍保留，请稍后重试；导入的论文不会删除。", 500)
            if job_id == self._active_id:
                self._active_id = None
                self._task = None
