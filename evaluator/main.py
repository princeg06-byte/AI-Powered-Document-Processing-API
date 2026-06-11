"""
main.py
───────
FastAPI microservice exposing the LLM evaluation pipeline over HTTP.

Start:
    uvicorn main:app --reload --port 8001
"""

from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

load_dotenv()

from pipeline import EvaluationPipeline  # noqa: E402 (after dotenv)

# ─────────────────────────────────────────
#  Logging
# ─────────────────────────────────────────

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("evaluator")


# ─────────────────────────────────────────
#  App lifecycle
# ─────────────────────────────────────────

pipeline: EvaluationPipeline | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global pipeline
    api_key = os.getenv("ANTHROPIC_API_KEY")
    model = os.getenv("LLM_MODEL", "claude-sonnet-4-20250514")

    if not api_key:
        logger.warning("ANTHROPIC_API_KEY not set — evaluation endpoints will return errors")
    else:
        pipeline = EvaluationPipeline(anthropic_api_key=api_key, model=model)
        logger.info("EvaluationPipeline initialised with model: %s", model)

    yield  # — app is running —

    pipeline = None
    logger.info("Evaluator service shutting down")


# ─────────────────────────────────────────
#  FastAPI app
# ─────────────────────────────────────────

app = FastAPI(
    title="AI Document Evaluator",
    description="LLM-powered quality & hallucination evaluation microservice",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

INTERNAL_KEY = os.getenv("EVALUATOR_API_KEY", "evaluator_internal_secret")


# ─────────────────────────────────────────
#  Auth dependency
# ─────────────────────────────────────────

def verify_internal_key(x_internal_key: str = Header(...)) -> None:
    if x_internal_key != INTERNAL_KEY:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid internal key")


# ─────────────────────────────────────────
#  Request/Response models
# ─────────────────────────────────────────

class EvaluateRequest(BaseModel):
    text: str = Field(..., min_length=10, description="Primary text to evaluate")
    query: str | None = Field(None, description="User query for context")
    llm_response: str | None = Field(None, description="LLM response to evaluate")
    source_text: str | None = Field(None, description="Ground-truth source for hallucination")

    @field_validator("text", "llm_response", "source_text", mode="before")
    @classmethod
    def strip_whitespace(cls, v):
        return v.strip() if isinstance(v, str) else v


class QualityRequest(BaseModel):
    text: str = Field(..., min_length=10)


class HallucinationRequest(BaseModel):
    source_text: str = Field(..., min_length=10)
    llm_response: str = Field(..., min_length=5)


# ─────────────────────────────────────────
#  Middleware — add process time header
# ─────────────────────────────────────────

@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    response.headers["x-process-time"] = str(round((time.perf_counter() - start) * 1000))
    return response


# ─────────────────────────────────────────
#  Routes
# ─────────────────────────────────────────

@app.get("/health")
async def health_check():
    """Public health endpoint — no auth required."""
    return {
        "status": "ok",
        "service": "ai-document-evaluator",
        "pipeline_ready": pipeline is not None,
    }


@app.post("/evaluate")
async def evaluate(req: EvaluateRequest, x_internal_key: str = Header(...)) -> dict[str, Any]:
    """Full evaluation pipeline: quality + hallucination."""
    verify_internal_key(x_internal_key)
    _require_pipeline()

    result = await pipeline.run(
        text=req.text,
        query=req.query,
        llm_response=req.llm_response,
        source_text=req.source_text,
    )
    return result


@app.post("/quality")
async def quality(req: QualityRequest, x_internal_key: str = Header(...)) -> dict[str, Any]:
    """Quality-only assessment."""
    verify_internal_key(x_internal_key)
    _require_pipeline()
    return await pipeline.run_quality_only(req.text)


@app.post("/hallucination")
async def hallucination(req: HallucinationRequest, x_internal_key: str = Header(...)) -> dict[str, Any]:
    """Hallucination detection only."""
    verify_internal_key(x_internal_key)
    _require_pipeline()
    return await pipeline.run_hallucination_only(req.source_text, req.llm_response)


# ─────────────────────────────────────────
#  Error handlers
# ─────────────────────────────────────────

@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    logger.exception("[Evaluator] Unhandled exception on %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal evaluator error: {type(exc).__name__}: {exc}"},
    )


def _require_pipeline() -> None:
    if pipeline is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Pipeline not initialised. Ensure ANTHROPIC_API_KEY is set.",
        )
