"use strict";

const config = require("../config");
const logger = require("../utils/logger");

/**
 * API key authentication middleware.
 *
 * Expects:  Authorization: Bearer <API_KEY>
 *       or: x-api-key: <API_KEY>
 */
function authenticate(req, res, next) {
  // Skip auth in test environment
  if (config.env === "test") return next();

  const authHeader = req.headers["authorization"] || "";
  const headerKey = req.headers["x-api-key"] || "";

  let token = null;

  if (authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  } else if (headerKey) {
    token = headerKey.trim();
  }

  if (!token) {
    logger.warn(`[Auth] Missing API key — IP: ${req.ip}`);
    return res.status(401).json({
      success: false,
      error: "Authentication required. Provide a Bearer token or x-api-key header.",
    });
  }

  if (!config.security.apiKey) {
    // API key not configured — warn but allow through in dev
    if (config.env === "development") {
      logger.warn("[Auth] API_KEY not set — skipping validation in development mode");
      req.requestId = req.headers["x-request-id"] || require("uuid").v4();
      return next();
    }
    return res.status(500).json({ success: false, error: "Server authentication misconfigured." });
  }

  if (token !== config.security.apiKey) {
    logger.warn(`[Auth] Invalid API key — IP: ${req.ip}`);
    return res.status(403).json({ success: false, error: "Invalid API key." });
  }

  req.requestId = req.headers["x-request-id"] || require("uuid").v4();
  logger.debug(`[Auth] Authenticated — requestId: ${req.requestId}`);
  next();
}

module.exports = { authenticate };
