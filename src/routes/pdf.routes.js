"use strict";

const router = require("express").Router();
const multer = require("multer");
const config = require("../config");
const {
  generatePdf,
  parsePdf,
  parsePdfBatch,
  generateValidation,
} = require("../controllers/pdf.controller");

// ── Multer config — store uploads in memory (no disk I/O) ──
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
 * @route  POST /api/pdf/generate
 * @desc   Generate a PDF from a JSON template
 * @access Protected (API key)
 *
 * Body (JSON):
 *   {
 *     "title": "My Report",
 *     "author": "Jane Doe",
 *     "subject": "Q3 Analysis",
 *     "sections": [
 *       { "heading": "Introduction", "body": "..." },
 *       { "heading": "Data", "table": { "headers": ["A","B"], "rows": [[1,2]] } },
 *       { "heading": "Key Points", "list": ["Point 1", "Point 2"] }
 *     ]
 *   }
 *
 * Query params:
 *   ?stream=true   — pipe chunks as they are generated
 */
router.post("/generate", generateValidation, generatePdf);

/**
 * @route  POST /api/pdf/parse
 * @desc   Parse a PDF and return extracted text + metadata
 * @access Protected (API key)
 *
 * Form data:
 *   file            (required) — PDF binary
 *   extractMetadata (optional) — default true
 *   extractPages    (optional) — default true
 *   maxPages        (optional) — integer
 */
router.post("/parse", upload.single("file"), parsePdf);

/**
 * @route  POST /api/pdf/parse-batch
 * @desc   Parse up to 10 PDFs in one request
 * @access Protected (API key)
 *
 * Form data:
 *   files  (required) — up to 10 PDF files
 */
router.post("/parse-batch", upload.array("files", 10), parsePdfBatch);

module.exports = router;
