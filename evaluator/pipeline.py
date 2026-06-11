"""
pipeline.py
───────────
Orchestrates the end-to-end LLM evaluation pipeline.

Flow:
  raw text / LLM response
       │
       ▼
  TextProcessor.clean()     ← normalise & chunk
       │
       ├──▶ QualityEvaluator.evaluate()      ┐
       │                                      ├──▶ metrics.aggregate()
       └──▶ HallucinationDetector.detect()   ┘
                                              │
                                              ▼
                                     EvaluationResult (dict)
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import anthropic

from .evaluators.quality import QualityEvaluator
from .evaluators.hallucination import HallucinationDetector
from .evaluators.metrics import aggregate
from .utils.text_processor import processor

logger = logging.getLogger(__name__)


class EvaluationPipeline:
    """
    Main orchestration class.  Coordinates quality and hallucination
    evaluations and returns a unified result dict.
    """

    def __init__(self, anthropic_api_key: str, model: str = "claude-sonnet-4-20250514") -> None:
        self.client = anthropic.Anthropic(api_key=anthropic_api_key)
        self.model = model
        self.quality_evaluator = QualityEvaluator(self.client, model)
        self.hallucination_detector = HallucinationDetector(self.client, model)

    # ─── Public API ──────────────────────────────────────────────────────────

    async def run(
        self,
        text: str,
        *,
        query: str | None = None,
        llm_response: str | None = None,
        source_text: str | None = None,
    ) -> dict[str, Any]:
        """
        Execute the full evaluation pipeline.

        Parameters
        ----------
        text:         Primary text to evaluate (e.g. extracted PDF text).
        query:        Optional user query for context.
        llm_response: Optional LLM-generated response to evaluate for hallucinations.
        source_text:  Optional separate ground-truth source (defaults to *text*).

        Returns
        -------
        Comprehensive evaluation dict.
        """
        start = time.perf_counter()
        logger.info("[Pipeline] Starting evaluation — text length: %d chars", len(text))

        eval_text = text
        ground_truth = source_text or text
        response_to_check = llm_response or text

        # Run quality and hallucination evaluations concurrently
        quality_task = asyncio.create_task(
            self.quality_evaluator.evaluate(eval_text)
        )
        hallucination_task = asyncio.create_task(
            self.hallucination_detector.detect(ground_truth, response_to_check)
        )

        quality_result, hallucination_result = await asyncio.gather(
            quality_task, hallucination_task, return_exceptions=True
        )

        # Handle partial failures gracefully
        if isinstance(quality_result, Exception):
            logger.error("[Pipeline] Quality evaluator failed: %s", quality_result)
            quality_result = {"error": str(quality_result)}
        if isinstance(hallucination_result, Exception):
            logger.error("[Pipeline] Hallucination detector failed: %s", hallucination_result)
            hallucination_result = {"error": str(hallucination_result), "hallucination_rate": 0.0}

        # Aggregate into composite metrics
        metrics = aggregate(quality_result, hallucination_result)

        elapsed_ms = round((time.perf_counter() - start) * 1000)
        logger.info(
            "[Pipeline] Done in %dms — grade: %s | score: %.2f | hallucination_rate: %.2f",
            elapsed_ms,
            metrics.grade,
            metrics.composite_score,
            metrics.hallucination_rate,
        )

        return {
            "metrics": metrics.to_dict(),
            "quality": quality_result,
            "hallucination": hallucination_result,
            "text_preview": processor.truncate(processor.clean(text), max_chars=300),
            "query": query,
            "elapsed_ms": elapsed_ms,
        }

    async def run_quality_only(self, text: str) -> dict[str, Any]:
        """Run only the quality evaluator (faster, no hallucination check)."""
        start = time.perf_counter()
        result = await self.quality_evaluator.evaluate(text)
        result["elapsed_ms"] = round((time.perf_counter() - start) * 1000)
        return result

    async def run_hallucination_only(self, source_text: str, llm_response: str) -> dict[str, Any]:
        """Run only hallucination detection."""
        start = time.perf_counter()
        result = await self.hallucination_detector.detect(source_text, llm_response)
        result["elapsed_ms"] = round((time.perf_counter() - start) * 1000)
        return result
