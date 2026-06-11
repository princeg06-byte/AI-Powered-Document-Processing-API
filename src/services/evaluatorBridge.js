"use strict";

const axios = require("axios");
const config = require("../config");
const logger = require("../utils/logger");

/**
 * EvaluatorBridgeService
 *
 * HTTP client that communicates with the Python FastAPI evaluator microservice.
 * Provides methods for text quality assessment and hallucination detection.
 */
class EvaluatorBridgeService {
  constructor() {
    this.client = axios.create({
      baseURL: config.evaluator.url,
      timeout: config.evaluator.timeout,
      headers: {
        "Content-Type": "application/json",
        "x-internal-key": config.evaluator.apiKey,
      },
    });

    // Request interceptor — log outbound calls
    this.client.interceptors.request.use((req) => {
      logger.debug(`[EvaluatorBridge] → ${req.method?.toUpperCase()} ${req.baseURL}${req.url}`);
      return req;
    });

    // Response interceptor — log timing
    this.client.interceptors.response.use(
      (res) => {
        logger.debug(`[EvaluatorBridge] ← ${res.status} from ${res.config.url} (${res.headers["x-process-time"] || "?"}ms)`);
        return res;
      },
      (err) => {
        const msg = err.response?.data?.detail || err.message;
        logger.error(`[EvaluatorBridge] Error: ${msg}`);
        return Promise.reject(err);
      }
    );
  }

  /**
   * Full evaluation pipeline: quality + hallucination assessment.
   *
   * @param {object} payload
   * @param {string} payload.text           Extracted PDF text
   * @param {string} [payload.query]        User query / context
   * @param {string} [payload.llmResponse]  LLM-generated response to evaluate
   * @param {string} [payload.sourceText]   Ground-truth source for hallucination check
   * @returns {Promise<EvaluationResult>}
   */
  async evaluate(payload) {
    try {
      const { data } = await this.client.post("/evaluate", payload);
      return data;
    } catch (err) {
      this._handleError(err, "evaluate");
    }
  }

  /**
   * Quality-only assessment.
   *
   * @param {string} text
   * @param {object} [options]
   * @returns {Promise<QualityResult>}
   */
  async assessQuality(text, options = {}) {
    try {
      const { data } = await this.client.post("/quality", { text, ...options });
      return data;
    } catch (err) {
      this._handleError(err, "assessQuality");
    }
  }

  /**
   * Hallucination detection between a source document and an LLM response.
   *
   * @param {string} sourceText       Original extracted text
   * @param {string} llmResponse      LLM-generated response
   * @returns {Promise<HallucinationResult>}
   */
  async detectHallucinations(sourceText, llmResponse) {
    try {
      const { data } = await this.client.post("/hallucination", {
        source_text: sourceText,
        llm_response: llmResponse,
      });
      return data;
    } catch (err) {
      this._handleError(err, "detectHallucinations");
    }
  }

  /**
   * Health check — verify the Python service is reachable.
   * @returns {Promise<boolean>}
   */
  async healthCheck() {
    try {
      const { data } = await this.client.get("/health");
      return data?.status === "ok";
    } catch {
      return false;
    }
  }

  /** @private */
  _handleError(err, method) {
    if (err.code === "ECONNREFUSED" || err.code === "ECONNRESET") {
      const serviceErr = new Error("Python evaluator service is unavailable. Is it running?");
      serviceErr.statusCode = 503;
      throw serviceErr;
    }
    if (err.response?.status === 422) {
      const detail = JSON.stringify(err.response.data?.detail || err.response.data);
      const validationErr = new Error(`Evaluator validation error in ${method}: ${detail}`);
      validationErr.statusCode = 422;
      throw validationErr;
    }
    const wrapped = new Error(`Evaluator bridge error in ${method}: ${err.message}`);
    wrapped.statusCode = err.response?.status || 500;
    throw wrapped;
  }
}

module.exports = new EvaluatorBridgeService();
