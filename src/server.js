"use strict";

require("dotenv").config();

const http = require("http");
const app = require("./app");
const config = require("./config");
const logger = require("./utils/logger");

const server = http.createServer(app);

// ─────────────────────────────────────────
//  Graceful Shutdown
// ─────────────────────────────────────────

let isShuttingDown = false;

function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`[Server] ${signal} received — graceful shutdown initiated`);

  server.close((err) => {
    if (err) {
      logger.error("[Server] Error during shutdown:", err);
      process.exit(1);
    }
    logger.info("[Server] HTTP server closed");
    process.exit(0);
  });

  // Force-kill after 10s if connections hang
  setTimeout(() => {
    logger.warn("[Server] Forced shutdown after timeout");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  logger.error("[Server] Uncaught exception:", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.error("[Server] Unhandled promise rejection:", reason);
});

// ─────────────────────────────────────────
//  Start
// ─────────────────────────────────────────

server.listen(config.port, () => {
  logger.info(`
╔══════════════════════════════════════════════════════╗
║     AI-Powered Document Processing API               ║
║                                                      ║
║  🚀  Running on  http://localhost:${config.port}              ║
║  🌍  Environment: ${config.env.padEnd(33)}║
║  📋  Docs:        GET /                              ║
╚══════════════════════════════════════════════════════╝
  `.trim());
});

module.exports = server;
