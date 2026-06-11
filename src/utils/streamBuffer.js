"use strict";

const { PassThrough, Readable } = require("stream");
const { v4: uuidv4 } = require("uuid");
const logger = require("./logger");

/**
 * StreamBufferManager
 *
 * Manages concurrent PDF generation/parsing jobs via streaming buffers.
 * Each job gets an isolated PassThrough stream so the HTTP response layer
 * can pipe the binary PDF data out as it becomes available, without waiting
 * for the entire document to be buffered in memory.
 *
 * Architecture:
 *   ┌──────────┐    write chunks     ┌──────────────┐    pipe    ┌──────────┐
 *   │ PDFKit   │ ─────────────────▶  │ PassThrough  │ ─────────▶ │  res     │
 *   │ /pdflib  │                     │  (jobBuffer) │            │ (HTTP)   │
 *   └──────────┘                     └──────────────┘            └──────────┘
 */
class StreamBufferManager {
  constructor(options = {}) {
    this.maxConcurrent = options.maxConcurrent || 20;
    this.jobTtlMs = options.jobTtlMs || 5 * 60 * 1000; // 5 minutes

    /** @type {Map<string, JobEntry>} */
    this._jobs = new Map();

    // Periodic cleanup of stale jobs
    this._cleanupInterval = setInterval(() => this._cleanup(), 60_000);
    this._cleanupInterval.unref(); // Don't prevent process from exiting
  }

  /**
   * Create a new streaming job.
   * @returns {{ jobId: string, stream: PassThrough }}
   */
  createJob() {
    if (this._jobs.size >= this.maxConcurrent) {
      throw new Error(
        `Too many concurrent jobs (max ${this.maxConcurrent}). Retry shortly.`
      );
    }

    const jobId = uuidv4();
    const stream = new PassThrough({ highWaterMark: 64 * 1024 }); // 64 KB buffer

    this._jobs.set(jobId, {
      jobId,
      stream,
      createdAt: Date.now(),
      status: "pending",
      chunks: [],
      error: null,
    });

    logger.debug(`[StreamBuffer] Job created: ${jobId} (active: ${this._jobs.size})`);
    return { jobId, stream };
  }

  /**
   * Write a Buffer/Uint8Array chunk to a job's stream.
   * @param {string} jobId
   * @param {Buffer|Uint8Array} chunk
   */
  writeChunk(jobId, chunk) {
    const job = this._getJob(jobId);
    job.status = "streaming";
    job.chunks.push(chunk);
    job.stream.write(chunk);
  }

  /**
   * Finalize a job — flush remaining data and end the stream.
   * @param {string} jobId
   * @param {Buffer|null} finalChunk
   */
  finalizeJob(jobId, finalChunk = null) {
    const job = this._getJob(jobId);
    if (finalChunk) {
      job.chunks.push(finalChunk);
      job.stream.write(finalChunk);
    }
    job.status = "done";
    job.stream.end();
    logger.debug(`[StreamBuffer] Job finalized: ${jobId}`);
  }

  /**
   * Collect the complete buffer for a job (useful for small responses).
   * @param {string} jobId
   * @returns {Buffer}
   */
  collectBuffer(jobId) {
    const job = this._getJob(jobId);
    return Buffer.concat(job.chunks);
  }

  /**
   * Mark a job as failed and emit an error on its stream.
   * @param {string} jobId
   * @param {Error} error
   */
  failJob(jobId, error) {
    const job = this._jobs.get(jobId);
    if (!job) return;
    job.status = "failed";
    job.error = error;
    job.stream.destroy(error);
    logger.error(`[StreamBuffer] Job failed: ${jobId} — ${error.message}`);
  }

  /**
   * Get the PassThrough stream for piping to an HTTP response.
   * @param {string} jobId
   * @returns {PassThrough}
   */
  getStream(jobId) {
    return this._getJob(jobId).stream;
  }

  /**
   * Get job status info.
   * @param {string} jobId
   */
  getStatus(jobId) {
    const job = this._jobs.get(jobId);
    if (!job) return null;
    return {
      jobId: job.jobId,
      status: job.status,
      createdAt: job.createdAt,
      bytesSoFar: job.chunks.reduce((s, c) => s + c.length, 0),
    };
  }

  /**
   * Release a job from memory (call after piping is complete).
   * @param {string} jobId
   */
  releaseJob(jobId) {
    this._jobs.delete(jobId);
    logger.debug(`[StreamBuffer] Job released: ${jobId} (active: ${this._jobs.size})`);
  }

  /** @private */
  _getJob(jobId) {
    const job = this._jobs.get(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    return job;
  }

  /** @private — Remove jobs older than TTL */
  _cleanup() {
    const now = Date.now();
    for (const [id, job] of this._jobs) {
      if (now - job.createdAt > this.jobTtlMs) {
        if (!job.stream.destroyed) job.stream.destroy();
        this._jobs.delete(id);
        logger.warn(`[StreamBuffer] Evicted stale job: ${id}`);
      }
    }
  }

  get activeJobCount() {
    return this._jobs.size;
  }
}

// Export a singleton for use across the app
module.exports = new StreamBufferManager({ maxConcurrent: 20 });
