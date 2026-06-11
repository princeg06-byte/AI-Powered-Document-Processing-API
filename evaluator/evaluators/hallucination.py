"""
hallucination.py
────────────────
LLM-powered hallucination detection.

Compares an LLM-generated response against a source document and identifies:
  • Claims that are unsupported by the source
  • Claims that directly contradict the source
  • The overall hallucination rate (0 = none, 1 = entirely hallucinated)
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

HALLUCINATION_PROMPT = """\
You are an expert fact-checker specialising in detecting hallucinations in AI-generated text.

SOURCE DOCUMENT:
\"\"\"
{source_text}
\"\"\"

LLM-GENERATED RESPONSE:
\"\"\"
{llm_response}
\"\"\"

Task: Analyse every factual claim in the LLM response. Identify which claims are:
  (A) SUPPORTED    — directly supported or reasonably inferred from the source
  (B) UNSUPPORTED  — not mentioned in the source (may be true, but unverifiable)
  (C) CONTRADICTED — directly contradicts information in the source

Return ONLY a valid JSON object with NO markdown or preamble:

{{
  "hallucination_rate": <float 0.0–1.0, fraction of claims that are UNSUPPORTED or CONTRADICTED>,
  "total_claims": <int>,
  "supported_claims": <int>,
  "unsupported_claims": <int>,
  "contradicted_claims": <int>,
  "hallucinated_segments": [
    {{
      "text": "<exact quote from llm_response>",
      "type": "UNSUPPORTED" | "CONTRADICTED",
      "explanation": "<why this is flagged>"
    }}
  ],
  "confidence": <float 0.0–1.0, your confidence in this assessment>,
  "overall_assessment": "<two-sentence summary>"
}}
"""


class HallucinationDetector:
    """
    Detects hallucinations in LLM-generated responses by comparing them
    against a ground-truth source document using Claude as judge.
    """

    def __init__(self, client: anthropic.Anthropic, model: str = "claude-sonnet-4-20250514") -> None:
        self.client = client
        self.model = model

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
    async def detect(self, source_text: str, llm_response: str) -> dict:
        """
        Compare *llm_response* against *source_text* and return hallucination report.

        Parameters
        ----------
        source_text:   The authoritative source / extracted PDF text.
        llm_response:  The LLM-generated answer to be evaluated.

        Returns
        -------
        dict containing hallucination_rate, flagged segments, and stats.
        """
        cleaned_source = processor.clean(source_text)
        cleaned_response = processor.clean(llm_response)

        # Truncate source to avoid token limits; keep full response
        trunc_source = processor.truncate(cleaned_source, max_chars=5_000)
        trunc_response = processor.truncate(cleaned_response, max_chars=2_000)

        logger.info(
            "[HallucinationDetector] Source: %d chars | Response: %d chars",
            len(trunc_source),
            len(trunc_response),
        )

        prompt = HALLUCINATION_PROMPT.format(
            source_text=trunc_source,
            llm_response=trunc_response,
        )

        message = self.client.messages.create(
            model=self.model,
            max_tokens=1536,
            messages=[{"role": "user", "content": prompt}],
        )

        raw = message.content[0].text.strip()
        result = self._parse_response(raw)
        result["model_used"] = self.model
        return result

    def _parse_response(self, raw: str) -> dict:
        """Parse and validate the JSON response from the judge LLM."""
        cleaned = re.sub(r"```(?:json)?|```", "", raw).strip()

        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError as exc:
            logger.error("[HallucinationDetector] JSON parse error: %s", exc)
            return {
                "hallucination_rate": 0.0,
                "total_claims": 0,
                "supported_claims": 0,
                "unsupported_claims": 0,
                "contradicted_claims": 0,
                "hallucinated_segments": [],
                "parse_error": str(exc),
                "raw_response": raw[:500],
            }

        # Validate and clamp numeric fields
        data["hallucination_rate"] = max(0.0, min(1.0, float(data.get("hallucination_rate", 0.0))))
        data["confidence"] = max(0.0, min(1.0, float(data.get("confidence", 0.5))))

        for count_field in ("total_claims", "supported_claims", "unsupported_claims", "contradicted_claims"):
            data[count_field] = max(0, int(data.get(count_field, 0)))

        if "hallucinated_segments" not in data or not isinstance(data["hallucinated_segments"], list):
            data["hallucinated_segments"] = []

        # Sanitise segment entries
        valid_types = {"UNSUPPORTED", "CONTRADICTED"}
        data["hallucinated_segments"] = [
            seg for seg in data["hallucinated_segments"]
            if isinstance(seg, dict) and seg.get("type") in valid_types
        ]

        return data
