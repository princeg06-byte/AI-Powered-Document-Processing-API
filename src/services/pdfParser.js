"use strict";

const pdfParse = require("pdf-parse");
const streamBuffer = require("../utils/streamBuffer");
const logger = require("../utils/logger");

/**
 * PdfParserService
 *
 * Extracts text, metadata, and structure from uploaded PDF buffers.
 * Uses streaming buffers internally to avoid blocking the event loop
 * while handling concurrent parse requests.
 */
class PdfParserService {
  /**
   * Parse a PDF buffer and extract structured content.
   *
   * @param {Buffer} pdfBuffer   Raw PDF bytes
   * @param {object} options
   * @param {boolean} [options.extractMetadata=true]
   * @param {boolean} [options.extractPages=true]     Include per-page text
   * @param {number}  [options.maxPages]              Limit pages parsed
   * @returns {Promise<ParseResult>}
   */
  async parse(pdfBuffer, options = {}) {
    const {
      extractMetadata = true,
      extractPages = true,
      maxPages,
    } = options;

    const { jobId, stream } = streamBuffer.createJob();
    const log = logger.forRequest(jobId);

    log.info(`[PdfParser] Parsing PDF — ${pdfBuffer.length} bytes`);

    try {
      // Write buffer into our stream for tracking/concurrency accounting
      streamBuffer.writeChunk(jobId, pdfBuffer);
      streamBuffer.finalizeJob(jobId);

      const parseOptions = {
        max: maxPages || 0,
        // Render function gives us per-page text with page numbers
        pagerender: extractPages ? this._makePageRenderer() : undefined,
      };

      const data = await pdfParse(pdfBuffer, parseOptions);

      const result = {
        jobId,
        success: true,
        text: data.text,
        wordCount: data.text.split(/\s+/).filter(Boolean).length,
        charCount: data.text.length,
        pageCount: data.numpages,
        pages: [],
        metadata: {},
        extractedAt: new Date().toISOString(),
      };

      if (extractMetadata && data.info) {
        result.metadata = this._cleanMetadata(data.info);
      }

      if (extractPages && data.text) {
        result.pages = this._splitIntoPages(data.text, data.numpages);
      }

      streamBuffer.releaseJob(jobId);
      log.info(`[PdfParser] Parsed ${data.numpages} pages, ${result.wordCount} words`);
      return result;
    } catch (err) {
      streamBuffer.failJob(jobId, err);
      throw new Error(`PDF parsing failed: ${err.message}`);
    }
  }

  /**
   * Parse multiple PDFs concurrently (up to 5 at once).
   *
   * @param {Buffer[]} buffers
   * @param {object} options
   * @returns {Promise<ParseResult[]>}
   */
  async parseBatch(buffers, options = {}) {
    const CONCURRENCY = 5;
    const results = [];

    for (let i = 0; i < buffers.length; i += CONCURRENCY) {
      const batch = buffers.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.allSettled(
        batch.map((buf) => this.parse(buf, options))
      );
      results.push(...batchResults);
    }

    return results.map((r, idx) =>
      r.status === "fulfilled"
        ? r.value
        : { success: false, error: r.reason?.message, index: idx }
    );
  }

  // ─── Private helpers ──────────────────────────────────────────────

  /** @private */
  _makePageRenderer() {
    return function pageRender(pageData) {
      return pageData.getTextContent().then((textContent) => {
        return textContent.items.map((item) => item.str).join(" ");
      });
    };
  }

  /** @private */
  _cleanMetadata(info) {
    const fieldMap = {
      Title: "title",
      Author: "author",
      Subject: "subject",
      Keywords: "keywords",
      Creator: "creator",
      Producer: "producer",
      CreationDate: "createdAt",
      ModDate: "modifiedAt",
    };

    const cleaned = {};
    for (const [raw, key] of Object.entries(fieldMap)) {
      if (info[raw]) {
        cleaned[key] = String(info[raw]).replace(/^D:/, ""); // strip PDF date prefix
      }
    }
    return cleaned;
  }

  /** @private — Naively split text into pages by dividing equally */
  _splitIntoPages(text, pageCount) {
    if (pageCount <= 1) return [{ page: 1, text: text.trim() }];

    const chunkSize = Math.ceil(text.length / pageCount);
    const pages = [];

    // Try to split on paragraph boundaries
    let start = 0;
    for (let p = 1; p <= pageCount; p++) {
      const idealEnd = start + chunkSize;
      const end = p === pageCount
        ? text.length
        : (text.lastIndexOf("\n", idealEnd) > start ? text.lastIndexOf("\n", idealEnd) : idealEnd);

      pages.push({
        page: p,
        text: text.slice(start, end).trim(),
      });
      start = end;
    }

    return pages;
  }
}

module.exports = new PdfParserService();
