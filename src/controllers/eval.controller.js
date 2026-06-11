"use strict";

const { body, validationResult } = require("express-validator");
const evaluatorBridge = require("../services/evaluatorBridge");
const pdfParser = require("../services/pdfParser");
const logger = require("../utils/logger");

// ─────────────────────────────────────────
//  Validation rules
// ─────────────────────────────────────────

const evaluateValidation = [
  body("text").notEmpty().isString().withMessage("text is required"),
  body("query").optional().isString(),
  body("llmResponse").optional().isString(),
  body("sourceText").optional().isString(),
];

const hallucinationValidation = [
  body("sourceText").notEmpty().isString().withMessage("sourceText is required"),
  body("llmResponse").notEmpty().isString().withMessage("llmResponse is required"),
];

// ─────────────────────────────────────────
//  Controllers
// ─────────────────────────────────────────

/**
 * POST /api/eval/evaluate
 * Full evaluation: quality + hallucination detection.
 */
async function evaluate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const log = logger.forRequest(req.requestId);

  try {
    log.info("[Eval:evaluate] Starting full evaluation pipeline");
    const result = await evaluatorBridge.evaluate(req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/eval/quality
 * Assess text quality (coherence, readability, completeness).
 */
async function assessQuality(req, res, next) {
  const log = logger.forRequest(req.requestId);

  try {
    const { text, ...options } = req.body;
    if (!text) return res.status(400).json({ success: false, error: "text is required" });

    log.info(`[Eval:quality] Assessing ${text.length} chars`);
    const result = await evaluatorBridge.assessQuality(text, options);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/eval/hallucination
 * Detect hallucinations in an LLM response versus a source document.
 */
async function detectHallucinations(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const log = logger.forRequest(req.requestId);

  try {
    const { sourceText, llmResponse } = req.body;
    log.info(`[Eval:hallucination] Source: ${sourceText.length} chars | Response: ${llmResponse.length} chars`);
    const result = await evaluatorBridge.detectHallucinations(sourceText, llmResponse);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/eval/parse-and-evaluate
 * Convenience endpoint: upload a PDF, parse it, then run the full evaluation pipeline.
 */
async function parseAndEvaluate(req, res, next) {
  const log = logger.forRequest(req.requestId);

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No PDF file uploaded." });
    }

    log.info(`[Eval:parse-and-evaluate] File: ${req.file.originalname}`);

    // Step 1: Parse the PDF
    const parseResult = await pdfParser.parse(req.file.buffer);

    // Step 2: Evaluate the extracted text
    const evalPayload = {
      text: parseResult.text,
      query: req.body.query,
      llmResponse: req.body.llmResponse,
      sourceText: req.body.sourceText || parseResult.text,
    };

    const evalResult = await evaluatorBridge.evaluate(evalPayload);

    res.json({
      success: true,
      data: {
        parsing: parseResult,
        evaluation: evalResult,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/eval/health
 * Check if the Python evaluator service is reachable.
 */
async function health(req, res) {
  const isHealthy = await evaluatorBridge.healthCheck();
  res.status(isHealthy ? 200 : 503).json({
    success: isHealthy,
    evaluatorService: isHealthy ? "up" : "down",
    evaluatorUrl: require("../config").evaluator.url,
  });
}

module.exports = {
  evaluate,
  assessQuality,
  detectHallucinations,
  parseAndEvaluate,
  health,
  evaluateValidation,
  hallucinationValidation,
};
