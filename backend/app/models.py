"""Shared, bounded data contracts for local papers and cited AI readings."""

from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Source(StrictModel):
    pages: List[int] = Field(max_length=250)
    evidence: str = Field(max_length=12000)
    inferred: bool

    @field_validator("pages")
    @classmethod
    def positive_pages(cls, pages):
        if any(page < 1 or page > 250 for page in pages):
            raise ValueError("PDF 页码必须在 1–250 之间")
        return list(dict.fromkeys(pages))


class Block(StrictModel):
    kind: Literal["paragraph", "formula"]
    text: str = Field(min_length=1, max_length=30000)
    source: Source


class Section(StrictModel):
    title: str = Field(min_length=1, max_length=500)
    blocks: List[Block] = Field(max_length=100)


class Symbol(StrictModel):
    symbol: str = Field(max_length=1500)
    meaning: str = Field(max_length=4000)
    explanation: str = Field(max_length=12000)
    source: Source


class Relation(StrictModel):
    target: str = Field(max_length=500)
    statement: List[Block] = Field(max_length=50)
    explanation: List[Block] = Field(max_length=100)


class Proof(StrictModel):
    goal: List[Block] = Field(max_length=20)
    strategy: List[Block] = Field(max_length=30)
    sections: List[Section] = Field(max_length=60)


class AnalysisResult(StrictModel):
    title: str = Field(min_length=1, max_length=500)
    target_found: bool
    statement: List[Block] = Field(max_length=60)
    intuitive_explanation: List[Block] = Field(max_length=30)
    symbols: List[Symbol] = Field(max_length=150)
    proof: Proof
    relations: List[Relation] = Field(max_length=50)
    importance: List[Section] = Field(max_length=12)
    limitations: List[str] = Field(max_length=100)


class CodexStatus(StrictModel):
    installed: bool
    authenticated: bool
    auth_method: Literal["chatgpt", "api_key", "none"]
    version: str
    message: str


class Paper(StrictModel):
    id: str
    title: str
    filename: str
    page_count: int
    created_at: str
    text_available: bool
    warnings: List[str] = Field(default_factory=list)


class ArxivImportRequest(StrictModel):
    reference: str = Field(min_length=1, max_length=500)


class AnalysisRequest(StrictModel):
    paper_id: str = Field(min_length=1, max_length=100)
    target: str = Field(min_length=1, max_length=500)
    instructions: str = Field(default="", max_length=4000)
    processing_consent: Literal[True]

    @field_validator("target")
    @classmethod
    def concrete_target(cls, value):
        if not value.strip():
            raise ValueError("请具体说明要分析的结论")
        return value.strip()


class AnalysisJob(StrictModel):
    id: str
    paper_id: str
    target: str
    instructions: str = ""
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    stage: str
    created_at: str
    updated_at: str
    error: Optional[str] = None
    result: Optional[AnalysisResult] = None
