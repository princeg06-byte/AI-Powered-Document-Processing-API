"use strict";

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const { rateLimiter, errorHandler, notFoundHandler } = require("./middleware/errorHandler");
const { authenticate } = require("./middleware/auth");
const pdfRoutes = require("./routes/pdf.routes");
const evalRoutes = require("./routes/eval.routes");
const logger = require("./utils/logger");
const streamBuffer = require("./utils/streamBuffer");

const app = express();

// ─────────────────────────────────────────
//  Security & Core Middleware
// ─────────────────────────────────────────

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || "*",
  methods: ["GET", "POST", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key", "x-request-id"],
}));

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

// HTTP request logging via Morgan → Winston
app.use(morgan("combined", {
  stream: { write: (msg) => logger.http(msg.trim()) },
  skip: (req) => req.path === "/health",
}));

// ─────────────────────────────────────────
//  Rate Limiting
// ─────────────────────────────────────────

app.use("/api/", rateLimiter);

// ─────────────────────────────────────────
//  Public Routes (no auth)
// ─────────────────────────────────────────

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "ai-doc-processor",
    timestamp: new Date().toISOString(),
    activeJobs: streamBuffer.activeJobCount,
    uptime: Math.floor(process.uptime()),
  });
});

app.get("/", (req, res) => {
  res.json({
    name: "AI-Powered Document Processing API",
    version: "1.0.0",
    docs: "/api/docs",
    endpoints: {
      pdf: {
        generate: "POST /api/pdf/generate",
        parse: "POST /api/pdf/parse",
        parseBatch: "POST /api/pdf/parse-batch",
      },
      evaluation: {
        full: "POST /api/eval/evaluate",
        quality: "POST /api/eval/quality",
        hallucination: "POST /api/eval/hallucination",
        parseAndEvaluate: "POST /api/eval/parse-and-evaluate",
        health: "GET /api/eval/health",
      },
    },
  });
});

// ─────────────────────────────────────────
//  Protected API Routes
// ─────────────────────────────────────────

app.use("/api/pdf", authenticate, pdfRoutes);
app.use("/api/eval", authenticate, evalRoutes);

// ─────────────────────────────────────────
//  Error Handling (must be last)
// ─────────────────────────────────────────

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
