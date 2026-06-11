"""
metrics.py
──────────
Aggregates quality and hallucination sub-scores into a final composite
evaluation score and structured report.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class EvaluationMetrics:
    """
    Composite metrics computed from quality + hallucination sub-evaluations.

    Scoring convention (all 0–1 unless stated):
        composite_score   — overall document quality (higher = better)
        hallucination_rate — fraction of claims flagged as hallucinated (lower = better)
        quality_score      — normalised aggregate quality rating
    """

    # Sub-scores
    coherence: float = 0.0
    readability: float = 0.0
    completeness: float = 0.0
    factual_accuracy: float = 0.0
    hallucination_rate: float = 0.0

    # Composite
    quality_score: float = field(init=False)
    composite_score: float = field(init=False)
    grade: str = field(init=False)
    flags: list[str] = field(default_factory=list)

    # Weights for composite score
    _W_COHERENCE: float = 0.25
    _W_READABILITY: float = 0.20
    _W_COMPLETENESS: float = 0.20
    _W_FACTUAL: float = 0.20
    _W_HALLUCINATION: float = 0.15  # penalise hallucinations

    def __post_init__(self) -> None:
        self.quality_score = round(
            self.coherence * self._W_COHERENCE
            + self.readability * self._W_READABILITY
            + self.completeness * self._W_COMPLETENESS
            + self.factual_accuracy * self._W_FACTUAL,
            4,
        )
        hallucination_penalty = self.hallucination_rate * self._W_HALLUCINATION
        self.composite_score = round(max(0.0, self.quality_score - hallucination_penalty), 4)
        self.grade = self._assign_grade(self.composite_score)
        self._compute_flags()

    def _assign_grade(self, score: float) -> str:
        if score >= 0.90:
            return "A"
        if score >= 0.80:
            return "B"
        if score >= 0.70:
            return "C"
        if score >= 0.60:
            return "D"
        return "F"

    def _compute_flags(self) -> None:
        if self.hallucination_rate > 0.30:
            self.flags.append("HIGH_HALLUCINATION_RATE")
        if self.coherence < 0.50:
            self.flags.append("LOW_COHERENCE")
        if self.readability < 0.40:
            self.flags.append("POOR_READABILITY")
        if self.completeness < 0.50:
            self.flags.append("INCOMPLETE_CONTENT")
        if self.factual_accuracy < 0.60:
            self.flags.append("LOW_FACTUAL_ACCURACY")

    def to_dict(self) -> dict[str, Any]:
        return {
            "composite_score": self.composite_score,
            "grade": self.grade,
            "quality_score": self.quality_score,
            "hallucination_rate": self.hallucination_rate,
            "sub_scores": {
                "coherence": self.coherence,
                "readability": self.readability,
                "completeness": self.completeness,
                "factual_accuracy": self.factual_accuracy,
            },
            "flags": self.flags,
            "passed": len([f for f in self.flags if "HALLUCINATION" in f or "LOW_FACTUAL" in f]) == 0,
        }


def aggregate(quality_data: dict, hallucination_data: dict) -> EvaluationMetrics:
    """
    Build an EvaluationMetrics instance from quality + hallucination dicts.

    Both dicts are the raw outputs of their respective evaluators.
    """
    def safe_float(d: dict, *keys: str, default: float = 0.0) -> float:
        for k in keys:
            v = d.get(k)
            if v is not None:
                try:
                    return max(0.0, min(1.0, float(v)))
                except (TypeError, ValueError):
                    pass
        return default

    coherence = safe_float(quality_data, "coherence_score", "coherence")
    readability = safe_float(quality_data, "readability_score", "readability")
    completeness = safe_float(quality_data, "completeness_score", "completeness")
    factual_accuracy = safe_float(quality_data, "factual_accuracy_score", "factual_accuracy", default=1.0)
    hallucination_rate = safe_float(hallucination_data, "hallucination_rate", "rate")

    return EvaluationMetrics(
        coherence=coherence,
        readability=readability,
        completeness=completeness,
        factual_accuracy=factual_accuracy,
        hallucination_rate=hallucination_rate,
    )
