"use strict";

require("dotenv").config();

const config = {
  env: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT, 10) || 3000,

  security: {
    apiKey: process.env.API_KEY,
    jwtSecret: process.env.JWT_SECRET || "changeme",
  },

  llm: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.LLM_MODEL || "claude-sonnet-4-20250514",
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS, 10) || 2048,
  },

  evaluator: {
    url: process.env.EVALUATOR_URL || "http://localhost:8001",
    apiKey: process.env.EVALUATOR_API_KEY || "evaluator_internal_secret",
    timeout: 60_000,
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60_000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
  },

  upload: {
    maxFileSizeBytes: (parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 20) * 1024 * 1024,
    tempDir: process.env.UPLOAD_TEMP_DIR || "/tmp/doc-processor",
  },

  logging: {
    level: process.env.LOG_LEVEL || "info",
    file: process.env.LOG_FILE || "logs/app.log",
  },
};

// Validate critical values at startup
const required = ["llm.anthropicApiKey"];
for (const key of required) {
  const val = key.split(".").reduce((o, k) => o?.[k], config);
  if (!val) {
    console.warn(`[config] WARNING: ${key} is not set — some features will be disabled.`);
  }
}

module.exports = config;
