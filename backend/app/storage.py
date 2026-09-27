"""Private, atomic local persistence for imported papers and analysis jobs."""

import json
import os
import shutil
import stat
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List, Optional
from uuid import UUID, uuid4

from .models import AnalysisJob, Paper


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def valid_id(value: str) -> str:
    try:
        if str(UUID(value)) != value:
            raise ValueError("Invalid identifier")
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValueError("Invalid identifier") from exc
    return value


def _remove_work_directory(path: Path) -> None:
    # rmtree refuses a top-level symlink and unlinks any nested symlinks rather
    # than following them. Keep this portable to supported Python 3.9 builds
    # on macOS where descriptor-relative os operations are unavailable.
    shutil.rmtree(path)


class Storage:
    def __init__(self, root: Optional[Path] = None):
        configured = os.environ.get("READER_STORAGE_ROOT", "").strip()
        if root is not None:
            self.root = Path(root)
        elif configured:
            self.root = Path(configured)
            if not self.root.is_absolute():
                raise ValueError("READER_STORAGE_ROOT must be an absolute directory path")
        else:
            self.root = Path(__file__).resolve().parents[2] / ".local"
        self.papers_dir = self.root / "papers"
        self.jobs_dir = self.root / "analyses"
        self.work_dir = self.root / "work"
        for directory in (self.root, self.papers_dir, self.jobs_dir, self.work_dir):
            if directory.is_symlink():
                raise ValueError("Storage directories must not be symlinks")
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            directory.chmod(0o700)

    @staticmethod
    def _atomic(path: Path, data: bytes) -> None:
        descriptor, temporary = tempfile.mkstemp(prefix=".write-", dir=path.parent)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                os.fchmod(stream.fileno(), 0o600)
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def _write_json(self, path: Path, data: Any) -> None:
        self._atomic(path, json.dumps(data, ensure_ascii=False).encode("utf-8"))

    @staticmethod
    def _read_json(path: Path) -> Any:
        if path.is_symlink():
            raise ValueError("Storage files must not be symlinks")
        return json.loads(path.read_text(encoding="utf-8"))

    def paper_directory(self, paper_id: str) -> Path:
        path = self.papers_dir / valid_id(paper_id)
        if path.is_symlink():
            raise ValueError("Paper directory must not be a symlink")
        return path

    def create_paper(self, filename: str, content: bytes, pages: List[str], warnings: List[str]) -> Paper:
        paper_id = str(uuid4())
        clean_name = filename.replace("\\", "/").rsplit("/", 1)[-1][:255] or "paper.pdf"
        paper = Paper(id=paper_id, title=Path(clean_name).stem or "未命名论文", filename=clean_name,
                      page_count=len(pages), created_at=now(),
                      text_available=any(page.strip() for page in pages), warnings=warnings)
        directory = self.paper_directory(paper_id)
        directory.mkdir(mode=0o700)
        self._atomic(directory / "paper.pdf", content)
        self._write_json(directory / "pages.json", pages)
        self._write_json(directory / "paper.json", paper.model_dump(mode="json"))
        return paper

    def get_paper(self, paper_id: str) -> Paper:
        return Paper.model_validate(self._read_json(self.paper_directory(paper_id) / "paper.json"))

    def list_papers(self) -> List[Paper]:
        papers = []
        for path in self.papers_dir.iterdir():
            try:
                papers.append(self.get_paper(path.name))
            except (FileNotFoundError, ValueError, OSError):
                continue
        return sorted(papers, key=lambda item: item.created_at, reverse=True)

    def get_pages(self, paper_id: str) -> List[str]:
        self.get_paper(paper_id)
        pages = self._read_json(self.paper_directory(paper_id) / "pages.json")
        if not isinstance(pages, list) or not all(isinstance(page, str) for page in pages):
            raise ValueError("Invalid stored paper text")
        return pages

    def pdf_path(self, paper_id: str) -> Path:
        self.get_paper(paper_id)
        path = self.paper_directory(paper_id) / "paper.pdf"
        if path.is_symlink() or not path.is_file():
            raise FileNotFoundError("Paper PDF not found")
        return path

    def save_job(self, job: AnalysisJob) -> None:
        self._write_json(self.jobs_dir / (valid_id(job.id) + ".json"), job.model_dump(mode="json"))

    def get_job(self, job_id: str) -> AnalysisJob:
        return AnalysisJob.model_validate(self._read_json(self.jobs_dir / (valid_id(job_id) + ".json")))

    def list_jobs(self) -> List[AnalysisJob]:
        jobs = []
        for path in self.jobs_dir.glob("*.json"):
            try:
                jobs.append(self.get_job(path.stem))
            except (FileNotFoundError, ValueError, OSError):
                continue
        return sorted(jobs, key=lambda item: item.created_at, reverse=True)

    def delete_job(self, job_id: str) -> None:
        """Remove one job and its work artifacts, never the imported paper.

        The job JSON contains its result and is unlinked last. If artifact
        cleanup fails partway through, the record remains visible for retry.
        The caller must hold the JobManager lock and reject active jobs.
        """
        identifier = valid_id(job_id)
        for directory in (self.root, self.jobs_dir, self.work_dir):
            if directory.is_symlink() or not directory.is_dir():
                raise ValueError("Storage directories must not be symlinks")
        record = self.jobs_dir / (identifier + ".json")
        if not stat.S_ISREG(record.lstat().st_mode):
            raise ValueError("Analysis record must be a regular file")
        work = self.work_dir / identifier
        try:
            artifact = work.lstat()
        except FileNotFoundError:
            artifact = None
        if artifact is not None:
            if not stat.S_ISDIR(artifact.st_mode):
                raise ValueError("Work directory must not be a symlink or file")
            _remove_work_directory(work)
        record.unlink()

    def job_workdir(self, job_id: str) -> Path:
        directory = self.work_dir / valid_id(job_id)
        if directory.is_symlink():
            raise ValueError("Work directory must not be a symlink")
        directory.mkdir(mode=0o700, exist_ok=True)
        directory.chmod(0o700)
        return directory
