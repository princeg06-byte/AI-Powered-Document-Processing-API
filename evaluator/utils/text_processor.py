"""
text_processor.py
─────────────────
Utilities for cleaning, chunking, and analysing extracted PDF text
before it reaches the LLM evaluation pipeline.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Iterator


# ── Data model ──────────────────────────────────────────────────────────────


@dataclass
class TextChunk:
    index: int
    text: str
    char_start: int
    char_end: int
    word_count: int = field(init=False)

    def __post_init__(self) -> None:
        self.word_count = len(self.text.split())


# ── Main class ───────────────────────────────────────────────────────────────


class TextProcessor:
    """
    Cleans raw PDF text and splits it into manageable chunks for LLM evaluation.

    Typical pipeline::

        processor = TextProcessor()
        cleaned   = processor.clean(raw_text)
        chunks    = list(processor.chunk(cleaned, max_words=400))
        summary   = processor.summarise(cleaned)
    """

    # Patterns compiled once at class level
    _WHITESPACE_RE = re.compile(r"[ \t]+")
    _MULTILINE_RE = re.compile(r"\n{3,}")
    _HEADER_FOOTER_RE = re.compile(r"^\s*(Page\s+\d+|©.+|Confidential)\s*$", re.IGNORECASE | re.MULTILINE)
    _URL_RE = re.compile(r"https?://\S+")
    _EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}\b")
    _CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

    def clean(self, text: str, *, strip_urls: bool = False, strip_emails: bool = False) -> str:
        """
        Normalise and clean raw PDF-extracted text.

        Steps
        -----
        1. Unicode NFC normalisation
        2. Remove control characters
        3. Collapse intra-line whitespace
        4. Collapse excessive blank lines
        5. Strip page headers / footers
        6. Optionally strip URLs and e-mail addresses
        """
        if not text:
            return ""

        text = unicodedata.normalize("NFC", text)
        text = self._CONTROL_RE.sub("", text)
        text = self._WHITESPACE_RE.sub(" ", text)
        text = self._MULTILINE_RE.sub("\n\n", text)
        text = self._HEADER_FOOTER_RE.sub("", text)

        if strip_urls:
            text = self._URL_RE.sub("[URL]", text)
        if strip_emails:
            text = self._EMAIL_RE.sub("[EMAIL]", text)

        return text.strip()

    def chunk(
        self,
        text: str,
        max_words: int = 400,
        overlap_words: int = 50,
    ) -> Iterator[TextChunk]:
        """
        Split *text* into overlapping word-based chunks.

        Parameters
        ----------
        max_words:     Target maximum words per chunk.
        overlap_words: Words shared between adjacent chunks (sliding window).
        """
        words = text.split()
        if not words:
            return

        step = max(1, max_words - overlap_words)
        char_pos = 0
        idx = 0

        for start in range(0, len(words), step):
            slice_words = words[start : start + max_words]
            chunk_text = " ".join(slice_words)

            # Approximate char positions (good enough for diagnostics)
            char_start = char_pos
            char_end = char_start + len(chunk_text)
            char_pos = char_end - len(" ".join(slice_words[-overlap_words:])) if overlap_words else char_end

            yield TextChunk(
                index=idx,
                text=chunk_text,
                char_start=char_start,
                char_end=char_end,
            )
            idx += 1

            if start + max_words >= len(words):
                break

    def truncate(self, text: str, max_chars: int = 4_000) -> str:
        """Truncate to *max_chars*, ending on a sentence boundary where possible."""
        if len(text) <= max_chars:
            return text
        truncated = text[:max_chars]
        last_dot = truncated.rfind(".")
        if last_dot > max_chars * 0.6:
            return truncated[: last_dot + 1]
        return truncated + "…"

    def summarise(self, text: str) -> dict:
        """Return basic statistics about a text string."""
        words = text.split()
        sentences = re.split(r"[.!?]+", text)
        sentences = [s.strip() for s in sentences if s.strip()]
        paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]

        avg_sentence_len = (
            sum(len(s.split()) for s in sentences) / len(sentences) if sentences else 0
        )

        return {
            "char_count": len(text),
            "word_count": len(words),
            "sentence_count": len(sentences),
            "paragraph_count": len(paragraphs),
            "avg_words_per_sentence": round(avg_sentence_len, 1),
            "estimated_read_minutes": round(len(words) / 200, 1),
        }


# Module-level singleton
processor = TextProcessor()
