"""
quality.py
──────────
LLM-powered text quality assessment.

Evaluates four dimensions:
  • Coherence     — logical flow and structure
  • Readability   — clarity and accessibility
  • Completeness  — coverage of key topics
  • Factual Acc.  — internal consistency (no ground-truth required)
"""

from __future__ import annotations

import json
import re
import logging
from typing import Any

import anthropic
from tenacity import retry, stop_after_attempt, wait_exponential

from ..utils.text_processor import processor

logger = logging.getLogger(__name__)

QUALITY_PROMPT = """\
You are an expert document quality evaluator. Analyse the following text and score it across four dimensions. Return ONLY a valid JSON object — no markdown, no preamble.

TEXT:
\"\"\"
{text}
\"\"\"

Respond with exactly this JSON schema:
{{
  "coherence_score": <float 0.0–1.0>,
  "readability_score": <float 0.0–1.0>,
  "completeness_score": <float 0.0–1.0>,
  "factual_accuracy_score": <float 0.0–1.0>,
  "coherence_reasoning": "<one sentence>",
  "readability_reasoning": "<one sentence>",
  "completeness_reasoning": "<one sentence>",
  "factual_accuracy_reasoning": "<one sentence>",
  "overall_summary": "<two sentences>",
  "improvement_suggestions": ["<suggestion 1>", "<suggestion 2>"]
}}

Scoring guide:
  1.0 = excellent  |  0.7 = good  |  0.5 = average  |  0.3 = poor  |  0.0 = unacceptable
"""


class QualityEvaluator:
    """Assesses text quality across multiple dimensions using a Claude LLM."""

    def __init__(self, client: anthropic.Anthropic, model: str = "claude-sonnet-4-20250514") -> None:
        self.client = client
        self.model = model

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
    async def evaluate(self, text: str, **kwargs: Any) -> dict:
        """
        Run quality evaluation on *text*.

        Parameters
        ----------
        text:  The document text to evaluate.

        Returns
        -------
        dict with quality scores and reasoning.
        """
        cleaned = processor.clean(text)
        truncated = processor.truncate(cleaned, max_chars=6_000)
        stats = processor.summarise(truncated)

        logger.info(
            "[QualityEvaluator] Evaluating %d words, %d sentences",
            stats["word_count"],
            stats["sentence_count"],
        )

        prompt = QUALITY_PROMPT.format(text=truncated)

        message = self.client.messages.create(
            model=self.model,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )

        raw = message.content[0].text.strip()
        result = self._parse_response(raw)
        result["text_stats"] = stats
        result["model_used"] = self.model
        return result

    def _parse_response(self, raw: str) -> dict:
        """Parse and validate the LLM JSON response."""
        # Strip any accidental markdown fences
        cleaned = re.sub(r"```(?:json)?|```", "", raw).strip()
        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError as exc:
            logger.error("[QualityEvaluator] JSON parse error: %s\nRaw: %s", exc, raw[:300])
            # Return a safe fallback
            return {
                "coherence_score": 0.5,
                "readability_score": 0.5,
                "completeness_score": 0.5,
                "factual_accuracy_score": 0.5,
                "parse_error": str(exc),
                "raw_response": raw[:500],
            }

        # Clamp all score fields to [0, 1]
        for key in ("coherence_score", "readability_score", "completeness_score", "factual_accuracy_score"):
            if key in data:
                data[key] = max(0.0, min(1.0, float(data[key])))

        return data
