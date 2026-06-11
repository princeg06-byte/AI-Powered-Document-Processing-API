"use strict";

const rateLimit = require("express-rate-limit");
const config = require("../config");
const logger = require("../utils/logger");

// ─────────────────────────────────────────
//  Rate Limiter
// ─────────────────────────────────────────

const rateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  handler: (req, res) => {
    logger.warn(`[RateLimit] Limit exceeded — IP: ${req.ip}`);
    res.status(429).json({
      success: false,
      error: "Too many requests. Please slow down.",
      retryAfter: Math.ceil(config.rateLimit.windowMs / 1000),
    });
  },
});

// ─────────────────────────────────────────
//  Global Error Handler
// ─────────────────────────────────────────

/**
 * Express 4-arg error handler. Must be registered AFTER all routes.
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const statusCode = err.statusCode || err.status || 500;
  const requestId = req.requestId || "—";

  logger.error(`[ErrorHandler] ${err.message}`, {
    requestId,
    statusCode,
    stack: config.env === "development" ? err.stack : undefined,
  });

  // Multer file size error
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      success: false,
      error: `File too large. Maximum allowed size is ${config.upload.maxFileSizeBytes / (1024 * 1024)} MB.`,
    });
  }

  res.status(statusCode).json({
    success: false,
    error: config.env === "production" && statusCode === 500
      ? "Internal server error."
      : err.message,
    ...(config.env === "development" && { stack: err.stack }),
  });
}

/**
 * 404 Not Found handler. Register just before errorHandler.
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

module.exports = { rateLimiter, errorHandler, notFoundHandler };
