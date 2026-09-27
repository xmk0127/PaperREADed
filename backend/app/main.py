"""FastAPI entry point for the PaperREADed backend."""

from os import getenv
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .jobs import JobManager
from .local_api import router
from .local_security import LocalAccessMiddleware
from .storage import Storage


def allowed_origins() -> List[str]:
    """Return browser origins allowed to call the API."""

    configured = getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    )
    return [origin.strip() for origin in configured.split(",") if origin.strip()]


class HealthResponse(BaseModel):
    status: str
    service: str
    message: str


def create_app(storage_root: Optional[Path] = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application):
        application.state.storage = Storage(storage_root)
        application.state.jobs = JobManager(application.state.storage)
        application.state.jobs.recover()
        try:
            yield
        finally:
            await application.state.jobs.shutdown()

    application = FastAPI(
        title="PaperREADed API",
        description="Local mathematical paper imports and cited Codex readings.",
        version="0.1.0",
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins(),
        allow_credentials=True,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Content-Type", "X-Reader-Token"],
    )
    application.add_middleware(LocalAccessMiddleware)
    application.include_router(router)
    application.add_api_route("/", root, tags=["system"])
    application.add_api_route("/api/health", health, response_model=HealthResponse, tags=["system"])
    return application


def root() -> dict:
    return {
        "name": "PaperREADed API",
        "docs": "/docs",
        "health": "/api/health",
    }


def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        service="paperreaded-api",
        message="后端连接正常",
    )


app = create_app()
