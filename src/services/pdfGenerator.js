"use strict";

const PDFDocument = require("pdfkit");
const streamBuffer = require("../utils/streamBuffer");
const logger = require("../utils/logger");

/**
 * PdfGeneratorService
 *
 * Generates PDFs from structured JSON templates using PDFKit.
 * Each generation is isolated in a StreamBufferManager job so the
 * response can be piped out incrementally.
 */
class PdfGeneratorService {
  /**
   * Generate a PDF document from a template object.
   *
   * @param {object} template
   * @param {string} template.title
   * @param {string} [template.author]
   * @param {string} [template.subject]
   * @param {Array<Section>} template.sections
   * @returns {Promise<{ jobId: string, buffer: Buffer }>}
   */
  async generate(template) {
    const { jobId, stream } = streamBuffer.createJob();
    const log = logger.forRequest(jobId);

    try {
      log.info(`[PdfGenerator] Generating PDF: "${template.title}"`);

      const pdf = new PDFDocument({
        autoFirstPage: true,
        size: "A4",
        margins: { top: 72, bottom: 72, left: 72, right: 72 },
        info: {
          Title: template.title || "Untitled",
          Author: template.author || "AI Doc Processor",
          Subject: template.subject || "",
          Creator: "AI-Powered Document Processing API",
          Producer: "PDFKit + Node.js",
        },
      });

      // Pipe PDFKit output directly into our stream buffer
      pdf.pipe(stream);

      // ── Cover / Title page ──
      this._renderTitle(pdf, template);

      // ── Sections ──
      for (const section of template.sections || []) {
        pdf.addPage();
        this._renderSection(pdf, section);
      }

      pdf.end();

      // Wait for the stream to finish
      await new Promise((resolve, reject) => {
        stream.on("finish", resolve);
        stream.on("error", reject);
      });

      const buffer = streamBuffer.collectBuffer(jobId);
      streamBuffer.releaseJob(jobId);

      log.info(`[PdfGenerator] Done — ${buffer.length} bytes`);
      return { jobId, buffer };
    } catch (err) {
      streamBuffer.failJob(jobId, err);
      throw err;
    }
  }

  /**
   * Stream a PDF directly to an HTTP response.
   * Caller is responsible for setting res.setHeader before calling this.
   *
   * @param {object} template
   * @param {import('http').ServerResponse} res
   */
  async streamToResponse(template, res) {
    const { jobId, stream } = streamBuffer.createJob();
    const log = logger.forRequest(jobId);

    log.info(`[PdfGenerator:stream] Streaming PDF: "${template.title}"`);

    const pdf = new PDFDocument({
      autoFirstPage: true,
      size: "A4",
      margins: { top: 72, bottom: 72, left: 72, right: 72 },
      info: {
        Title: template.title || "Untitled",
        Author: template.author || "AI Doc Processor",
      },
    });

    pdf.pipe(stream);
    stream.pipe(res);

    this._renderTitle(pdf, template);

    for (const section of template.sections || []) {
      pdf.addPage();
      this._renderSection(pdf, section);
    }

    pdf.end();

    stream.on("finish", () => {
      log.info(`[PdfGenerator:stream] Stream complete for jobId: ${jobId}`);
      streamBuffer.releaseJob(jobId);
    });

    stream.on("error", (err) => {
      log.error(`[PdfGenerator:stream] Stream error for jobId: ${jobId} — ${err.message}`);
      streamBuffer.failJob(jobId, err);
    });

    return jobId;
  }

  // ─── Private rendering helpers ────────────────────────────────────

  /** @private */
  _renderTitle(pdf, template) {
    const { title, author, subject, date } = template;

    pdf
      .font("Helvetica-Bold")
      .fontSize(28)
      .fillColor("#1a1a2e")
      .text(title || "Untitled Document", { align: "center" });

    pdf.moveDown(0.5);
    pdf.moveTo(72, pdf.y).lineTo(pdf.page.width - 72, pdf.y).strokeColor("#4a90d9").lineWidth(2).stroke();
    pdf.moveDown(1);

    if (author) {
      pdf.font("Helvetica").fontSize(14).fillColor("#555").text(`Author: ${author}`, { align: "center" });
    }
    if (subject) {
      pdf.moveDown(0.3).fontSize(12).fillColor("#777").text(subject, { align: "center" });
    }
    if (date) {
      pdf.moveDown(0.3).fontSize(11).fillColor("#999").text(date, { align: "center" });
    }
  }

  /** @private */
  _renderSection(pdf, section) {
    const { heading, body, table, list } = section;

    if (heading) {
      pdf
        .font("Helvetica-Bold")
        .fontSize(16)
        .fillColor("#1a1a2e")
        .text(heading);

      pdf.moveDown(0.4);
      pdf.moveTo(72, pdf.y).lineTo(pdf.page.width - 72, pdf.y).strokeColor("#e0e0e0").lineWidth(1).stroke();
      pdf.moveDown(0.6);
    }

    if (body) {
      pdf.font("Helvetica").fontSize(11).fillColor("#333").text(body, { align: "justify", lineGap: 4 });
      pdf.moveDown(1);
    }

    if (list && Array.isArray(list)) {
      for (const item of list) {
        pdf.font("Helvetica").fontSize(11).fillColor("#333")
          .text(`• ${item}`, { indent: 16, lineGap: 2 });
      }
      pdf.moveDown(1);
    }

    if (table && Array.isArray(table.rows)) {
      this._renderTable(pdf, table);
    }
  }

  /** @private — Simple table renderer */
  _renderTable(pdf, table) {
    const { headers = [], rows = [] } = table;
    const colCount = Math.max(headers.length, ...rows.map((r) => r.length));
    const colWidth = (pdf.page.width - 144) / colCount;
    const rowHeight = 22;
    let y = pdf.y;

    const drawRow = (cells, isHeader) => {
      cells.forEach((cell, i) => {
        const x = 72 + i * colWidth;
        pdf
          .rect(x, y, colWidth, rowHeight)
          .fillAndStroke(isHeader ? "#1a1a2e" : i % 2 === 0 ? "#f7f9fc" : "#ffffff", "#d0d0d0");

        pdf
          .font(isHeader ? "Helvetica-Bold" : "Helvetica")
          .fontSize(9)
          .fillColor(isHeader ? "#ffffff" : "#333333")
          .text(String(cell ?? ""), x + 4, y + 6, { width: colWidth - 8, lineBreak: false });
      });
      y += rowHeight;
    };

    if (headers.length) drawRow(headers, true);
    rows.forEach((row) => drawRow(row, false));

    pdf.y = y + 8;
    pdf.moveDown(1);
  }
}

module.exports = new PdfGeneratorService();
