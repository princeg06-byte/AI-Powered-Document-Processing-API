"use strict";

const router = require("express").Router();
const multer = require("multer");
const config = require("../config");
const {
  evaluate,
  assessQuality,
  detectHallucinations,
  parseAndEvaluate,
  health,
  evaluateValidation,
  hallucinationValidation,
} = require("../controllers/eval.controller");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.upload.maxFileSizeBytes },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") return cb(null, true);
    cb(new Error("Only PDF files are accepted"), false);
  },
});

// ─── Routes ────────────────────────────────────────────────────

/**
 * @route  POST /api/eval/evaluate
 * @desc   Full evaluation pipeline (quality + hallucination)
 *
 * Body:
 *   { "text": "...", "query": "...", "llmResponse": "...", "sourceText": "..." }
 */
router.post("/evaluate", evaluateValidation, evaluate);

/**
 * @route  POST /api/eval/quality
 * @desc   Quality-only assessment (coherence, readability, completeness)
 *
 * Body:
 *   { "text": "..." }
 */
router.post("/quality", assessQuality);

/**
 * @route  POST /api/eval/hallucination
 * @desc   Detect hallucinations vs source document
 *
 * Body:
 *   { "sourceText": "...", "llmResponse": "..." }
 */
router.post("/hallucination", hallucinationValidation, detectHallucinations);

/**
 * @route  POST /api/eval/parse-and-evaluate
 * @desc   Convenience: upload PDF → parse → evaluate in one call
 *
 * Form data:
 *   file          (required) PDF binary
 *   query         (optional) user query context
 *   llmResponse   (optional) LLM response to evaluate
 */
router.post("/parse-and-evaluate", upload.single("file"), parseAndEvaluate);

/**
 * @route  GET /api/eval/health
 * @desc   Check Python evaluator service health
 */
router.get("/health", health);

module.exports = router;
