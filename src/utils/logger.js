"use strict";

const { createLogger, format, transports } = require("winston");
const path = require("path");
const fs = require("fs");
const config = require("../config");

// Ensure log directory exists
const logDir = path.dirname(config.logging.file);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const { combine, timestamp, errors, printf, colorize, json } = format;

const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: "HH:mm:ss" }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, requestId, ...meta }) => {
    const rid = requestId ? ` [${requestId}]` : "";
    const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `${ts} ${level}${rid}: ${message}${extra}`;
  })
);

const prodFormat = combine(timestamp(), errors({ stack: true }), json());

const logger = createLogger({
  level: config.logging.level,
  format: config.env === "production" ? prodFormat : devFormat,
  transports: [
    new transports.Console(),
    new transports.File({
      filename: config.logging.file,
      format: prodFormat,
      maxsize: 10 * 1024 * 1024, // 10 MB
      maxFiles: 5,
      tailable: true,
    }),
    new transports.File({
      filename: config.logging.file.replace(".log", ".error.log"),
      level: "error",
      format: prodFormat,
    }),
  ],
  exceptionHandlers: [
    new transports.File({ filename: config.logging.file.replace(".log", ".exceptions.log") }),
  ],
  rejectionHandlers: [
    new transports.File({ filename: config.logging.file.replace(".log", ".rejections.log") }),
  ],
});

/**
 * Create a child logger bound to a specific requestId.
 * @param {string} requestId
 */
logger.forRequest = (requestId) => logger.child({ requestId });

module.exports = logger;
