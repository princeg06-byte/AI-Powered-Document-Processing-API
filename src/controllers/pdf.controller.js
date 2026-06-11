"use strict";

const { body, validationResult } = require("express-validator");
const pdfGenerator = require("../services/pdfGenerator");
const pdfParser = require("../services/pdfParser");
const logger = require("../utils/logger");

// ─────────────────────────────────────────
//  Validation rules
// ─────────────────────────────────────────

const generateValidation = [
  body("title").notEmpty().withMessage("title is required").isString().trim(),
  body("sections").isArray({ min: 0 }).withMessage("sections must be an array"),
  body("sections.*.heading").optional().isString().trim(),
  body("sections.*.body").optional().isString(),
  body("author").optional().isString().trim(),
  body("subject").optional().isString().trim(),
];

// ─────────────────────────────────────────
//  Controllers
// ─────────────────────────────────────────

/**
 * POST /api/pdf/generate
 * Generate a PDF from a JSON template.
 * Returns PDF binary as application/pdf.
 */
async function generatePdf(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const log = logger.forRequest(req.requestId);
  const { stream: shouldStream = false } = req.query;

  try {
    log.info(`[PDF:generate] Template: "${req.body.title}"`);

    const filename = `${req.body.title.replace(/\s+/g, "_")}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Request-Id", req.requestId);

    if (shouldStream === "true") {
      // True streaming — pipe chunks as they are generated
      const jobId = await pdfGenerator.streamToResponse(req.body, res);
      res.setHeader("X-Job-Id", jobId);
    } else {
      // Buffer fully, send at once (smaller PDFs)
      const { jobId, buffer } = await pdfGenerator.generate(req.body);
      res.setHeader("Content-Length", buffer.length);
      res.setHeader("X-Job-Id", jobId);
      res.end(buffer);
    }
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/pdf/parse
 * Parse an uploaded PDF file and return extracted text + metadata.
 */
async function parsePdf(req, res, next) {
  const log = logger.forRequest(req.requestId);

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No PDF file uploaded. Use multipart/form-data with field name 'file'." });
    }

    log.info(`[PDF:parse] File: ${req.file.originalname} — ${req.file.size} bytes`);

    const options = {
      extractMetadata: req.body.extractMetadata !== "false",
      extractPages: req.body.extractPages !== "false",
      maxPages: req.body.maxPages ? parseInt(req.body.maxPages, 10) : undefined,
    };

    const result = await pdfParser.parse(req.file.buffer, options);

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/pdf/parse-batch
 * Parse multiple PDF files in a single request.
 */
async function parsePdfBatch(req, res, next) {
  const log = logger.forRequest(req.requestId);

  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: "No PDF files uploaded." });
    }

    log.info(`[PDF:parse-batch] ${req.files.length} files`);

    const buffers = req.files.map((f) => f.buffer);
    const results = await pdfParser.parseBatch(buffers);

    res.json({
      success: true,
      totalFiles: req.files.length,
      data: results.map((r, i) => ({
        filename: req.files[i].originalname,
        ...r,
      })),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  generatePdf,
  parsePdf,
  parsePdfBatch,
  generateValidation,
};
