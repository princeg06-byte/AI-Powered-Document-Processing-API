```markdown
# AI-Powered Document Processing API

A production-grade RESTful API for automated PDF generation and parsing, tightly integrated with a Python-based LLM evaluation pipeline for quality assessment and hallucination detection.

## 🚀 Overview

This system consists of two microservices that work seamlessly together over HTTP to intelligently handle and evaluate PDFs:

**1. Node.js Express API (The Primary Gateway)**
* **Generate PDFs:** Accepts a JSON object describing a document (title, sections, tables, bullet lists) and generates a cleanly formatted `.pdf` file.
* **Parse PDFs:** Accepts PDF uploads and extracts all text, word counts, page counts, and metadata.
* **High Concurrency:** Utilizes streaming buffers internally. Each PDF job gets an isolated `PassThrough` stream tracked by UUID, allowing multiple simultaneous requests without blocking the queue.

**2. Python Evaluator (Background Microservice)**
* **LLM Evaluation:** Takes extracted text and an LLM-generated response, scoring it using Anthropic's Claude as a judge.
* **Concurrent Checks:** Evaluates *Quality* (coherence, readability, completeness) and *Hallucination* (unsupported/contradicted claims) concurrently using `asyncio.gather` for minimal latency.
* **Actionable Metrics:** Returns a composite score, a letter grade (A–F), and explicitly flags fabricated sentences.

---

## 🧠 Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                  Node.js Express API  (:3000)               │
│                                                             │
│  POST /api/pdf/generate    ──▶  PdfGeneratorService         │
│  POST /api/pdf/parse       ──▶  PdfParserService            │
│  POST /api/pdf/parse-batch ──▶  PdfParserService (batch)    │
│                                                             │
│  POST /api/eval/evaluate          ┐                         │
│  POST /api/eval/quality           ├──▶ EvaluatorBridge      │
│  POST /api/eval/hallucination     │         │               │
│  POST /api/eval/parse-and-evaluate┘         │               │
└─────────────────────────────────────────────┼───────────────┘
                                              │ HTTP
                                              ▼
┌──────────────────────────────────────────────────────────────┐
│              Python FastAPI Evaluator  (:8001)               │
│                                                              │
│  POST /evaluate       ──▶  EvaluationPipeline.run()          │
│  POST /quality        ──▶  QualityEvaluator                  │
│  POST /hallucination  ──▶  HallucinationDetector             │
│                                                              │
│  Both evaluators use Claude (claude-sonnet-4-20250514)       │
│  as the judge LLM, running concurrently via asyncio          │
└──────────────────────────────────────────────────────────────┘

```

### Key Design Decisions

| Concern | Approach |
| --- | --- |
| **Concurrent PDF generation** | `StreamBufferManager` — per-job `PassThrough` streams; HTTP response pipes chunks as they're generated. Includes TTL-based cleanup. |
| **PDF parsing** | `pdf-parse` in Node.js for robust extraction. Supports batch processing of up to 10 PDFs capped with `Promise.allSettled`. |
| **LLM evaluation** | Quality + hallucination run concurrently via `asyncio.gather`. |
| **Hallucination scoring** | LLM-as-judge pattern — Claude compares response claims strictly against source text. |
| **Fault tolerance** | `evaluatorBridge.js` intercepts and handles Python service 503s gracefully. Each Python evaluator is wrapped in `tenacity` retries. |
| **Security & Auth** | API key via `Authorization: Bearer` or `x-api-key` header. `express-rate-limit` utilized for window/max requests. |

---

## 📂 Project Structure & Core Files

### Node.js Express API (`src/`)

* **`utils/streamBuffer.js`**: Core concurrency engine handling isolated PDF streams.
* **`services/pdfGenerator.js`**: Builds PDFs from JSON templates using PDFKit. Supports full-buffer and true streaming modes (`?stream=true`).
* **`services/pdfParser.js`**: Extracts text and metadata. Includes `parseBatch()` for concurrent multi-file processing.
* **`services/evaluatorBridge.js`**: Axios HTTP client managing communication and error handling with the Python microservice.

### Python FastAPI Evaluator (`evaluator/`)

* **`evaluators/quality.py`**: Queries Claude with a structured prompt to return JSON scores for coherence, readability, completeness, and factual accuracy.
* **`evaluators/hallucination.py`**: Compares every claim against the source document to flag `UNSUPPORTED` or `CONTRADICTED` segments.
* **`pipeline.py`**: Orchestrates the concurrent execution of evaluators.
* **`metrics.py`**: Handles weighted composite scoring and grade calculation.

---

## 🛠️ Quick Start

### 1. Prerequisites

Ensure you have the following installed:

* **Node.js** ≥ 18.0.0
* **Python** ≥ 3.10
* An **Anthropic API Key**

### 2. Clone and Install

```bash
git clone <your-repo-url>
cd ai-doc-processor

# Install Node.js dependencies
npm install

# Install Python dependencies
cd evaluator
pip install -r requirements.txt
cd ..

```

### 3. Environment Configuration

Copy the template and set up your variables:

```bash
cp .env.example .env

```

Open `.env` and fill in:

* `ANTHROPIC_API_KEY=sk-ant-...` (Your Anthropic API key)
* `API_KEY=your_chosen_api_key` (The secret you will use to authenticate requests to this API)

### 4. Start the Services

You will need to run the services concurrently in two separate terminals.

**Terminal 1 — Node.js API:**

```bash
npm run dev
# Server will start on http://localhost:3000

```

**Terminal 2 — Python Evaluator:**

```bash
cd evaluator
uvicorn main:app --reload --port 8001
# Or run from root using: npm run evaluator

```

---

## 📊 Scoring Model

The LLM evaluation pipeline calculates a weighted composite score based on the following formula:

$$\text{Composite Score} = (\text{Coherence} \times 0.25) + (\text{Readability} \times 0.20) + (\text{Completeness} \times 0.20) + (\text{Factual Accuracy} \times 0.20) - (\text{Hallucination Rate} \times 0.15)$$

**Grading Scale:**

* **A**: ≥ 0.90
* **B**: ≥ 0.80
* **C**: ≥ 0.70
* **D**: ≥ 0.60
* **F**: < 0.60

**Triggered Flags:**

* `HIGH_HALLUCINATION_RATE`: Hallucination rate > 0.30
* `LOW_COHERENCE`: Coherence < 0.50
* `POOR_READABILITY`: Readability < 0.40
* `INCOMPLETE_CONTENT`: Completeness < 0.50
* `LOW_FACTUAL_ACCURACY`: Factual accuracy < 0.60

---

## 📖 API Reference

All `/api/*` endpoints require authentication via headers:
`Authorization: Bearer <API_KEY>`

### PDF Endpoints

**1. Generate a PDF** (`POST /api/pdf/generate`)
Generates a structured PDF from JSON. Add `?stream=true` to the URL to pipe the chunks immediately.

```bash
curl -X POST http://localhost:3000/api/pdf/generate \
  -H "Authorization: Bearer your_chosen_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My First Report",
    "sections": [{ "heading": "Intro", "body": "Hello world." }]
  }' --output test.pdf

```

**2. Parse a PDF** (`POST /api/pdf/parse`)
Extracts text, metadata, and counts from an uploaded document.

```bash
curl -X POST http://localhost:3000/api/pdf/parse \
  -H "Authorization: Bearer your_chosen_api_key" \
  -F "file=@test.pdf" \
  -F "extractMetadata=true"

```

**3. Batch Parse PDFs** (`POST /api/pdf/parse-batch`)
Upload up to 10 files simultaneously under the `files` form field.

### Evaluation Endpoints

**1. Full Pipeline Evaluation** (`POST /api/eval/evaluate`)

```bash
curl -X POST http://localhost:3000/api/eval/evaluate \
  -H "Authorization: Bearer your_chosen_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "The extracted PDF text goes here...",
    "llmResponse": "The AI-generated summary to evaluate...",
    "sourceText": "Original document text for hallucination check..."
  }'

```

**2. Additional Evaluator Routes:**

* `POST /api/eval/quality` — Quality metrics only (Faster response).
* `POST /api/eval/hallucination` — Hallucination metrics only.
* `POST /api/eval/parse-and-evaluate` — Upload a PDF → parse it → evaluate it in one automated call.

### Health Checks (No Auth Required)

```bash
curl http://localhost:3000/health
curl http://localhost:8001/health

```

```

```
