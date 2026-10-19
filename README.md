# AMALearning WhatsApp AI Assistant (Zeeshan)

Official AI-powered WhatsApp assistant backend and interactive preview simulator for **AMALearning** (GCSE, IGCSE, and Cambridge O-Level platform).

---

## Architecture Overview

The system is built as a production-grade full-stack Node.js / Express application with an embedded Vite React preview interface:

```
                      +---------------------------------------+
                      |           Client Sources              |
                      |  - WhatsApp Webhook (via n8n Cloud)   |
                      |  - AI Studio Browser Preview          |
                      +-------------------+-------------------+
                                          |
                                          | HTTP POST /api/chat
                                          v
                      +---------------------------------------+
                      |         Express API Gateway           |
                      |  - In-Memory Rate Limiting            |
                      |  - Fail-Closed Auth Middleware        |
                      |  - JSON Payload Validation            |
                      +-------------------+-------------------+
                                          |
                      +-------------------+-------------------+
                      |       Live Plans Caching Service      |
                      |  - Single source of truth from API    |
                      |  - Board-aware package disambiguation |
                      +-------------------+-------------------+
                                          |
                      +-------------------+-------------------+
                      |         AI Generation Core            |
                      |  - Google GenAI (gemini-2.5-flash)    |
                      |  - Transient Retry Engine (429/503)   |
                      |  - Deterministic Fallback Engine      |
                      +---------------------------------------+
```

### Key Components

1. **Express Server (`server.ts`):**
   - Listens on `0.0.0.0` bound to dynamic `process.env.PORT` (defaults to 3000 in dev, 8080 in production/Cloud Run).
   - Serves API routes (`/api/chat`, `/api/plans`, `/api/info`) and hosts the Vite React frontend in development and production (`dist/`).
2. **Authentication Middleware (`src/utils/auth.ts`):**
   - Constant-time verification (`crypto.timingSafeEqual`) of `x-api-key` or `Authorization: Bearer <token>` for external callers.
   - Fail-closed in production: External callers without valid credentials receive `HTTP 401 Unauthorized`.
   - Same-origin browser requests (e.g. Preview UI) are safely allowed without embedding secrets in client bundles.
3. **In-Memory Rate Limiter (`src/utils/rateLimiter.ts`):**
   - Sliding window token-bucket rate limiter.
   - Enforced on `POST /api/chat` (60 req/min), `GET /api/plans` (60 req/min), and `GET /api/info` (120 req/min).
   - Returns standard `X-RateLimit-*` and `Retry-After` headers on `HTTP 429 Too Many Requests`.
4. **Live Plans Integration (`src/services/plansService.ts`):**
   - Queries the live public AMALearning API (`https://api.amalearning.space/api/v1/plan/get/public/all`) with in-memory TTL caching.
   - Cache bypass via `?refresh=true` requires valid authentication.
   - Dynamic disambiguation of exam boards (AQA vs Edexcel).
   - Zero-invention policy: If the live API returns empty or fails, informs the user that plans are temporarily unavailable and directs them to `support@amalearning.space`.
5. **AI Resiliency & Fallback Engine (`src/utils/geminiRetry.ts`, `server.ts`):**
   - Central model configuration via `GEMINI_MODEL` (`gemini-2.5-flash-lite`).
   - Exponential backoff with jitter on transient errors (HTTP 429, 503).
   - Automatic fallback to deterministic, rule-based response engine when AI calls are unavailable or unconfigured.
   - Strict log sanitizer strips raw API keys and tokens from all error output.

---

## Required Environment Variables

Configure these environment variable **names** in your deployment platform or local `.env` file. **Never commit actual secret values to source control.**

| Variable Name | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Recommended | API key for Google Gemini model generation. Kept strictly on the backend. |
| `N8N_API_KEY` | Required in Production | Shared secret token required in `x-api-key` or `Authorization: Bearer` for external server-to-server requests (e.g. n8n Cloud). |
| `PORT` | Optional (default: 3000 / 8080) | Port for the HTTP server to listen on. Automatically set by Google Cloud Run. |
| `NODE_ENV` | Optional | Set to `production` in live deployments to activate fail-closed authentication. |

---

## Local Development & Setup

### Prerequisites
- Node.js 22 LTS
- npm (v10+)

### Installation
```bash
# Deterministic dependency install using package-lock.json
npm ci
```

### Running Locally
```bash
# Start full-stack development server on port 3000
npm run dev
```

### Running Tests
The project includes a 63-test regression suite validating compliance, authentication, rate limiting, and plan disambiguation:
```bash
# Run regression tests
npm test

# Run TypeScript type check
npm run lint

# Build production bundle
npm run build
```

---

## API Endpoints

### 1. `POST /api/chat`
Main conversational endpoint for WhatsApp integrations and testing simulator.

- **Headers:**
  - `Content-Type: application/json`
  - `x-api-key`: Required for external callers in production
- **Request Body:**
  ```json
  {
    "messages": [
      { "role": "user", "content": "What is included in the 7-day free trial?" }
    ],
    "customerName": "Optional Name"
  }
  ```
- **Response:**
  ```json
  {
    "reply": "AMAL offers a 7-day free trial..."
  }
  ```

### 2. `GET /api/plans`
Fetches live individual and school subscription packages from the AMALearning API.

- **Query Parameters:**
  - `category` (optional): `'individual'` or `'school'`
  - `refresh` (optional): `'true'` to force cache refresh (requires valid API key or same-origin session)
- **Rate Limit:** 60 requests/minute per client.

### 3. `GET /api/info`
Health check and assistant configuration status.

- **Response:**
  ```json
  {
    "status": "online",
    "name": "AMALearning WhatsApp Assistant (Zeeshan)",
    "assistantName": "Zeeshan",
    "brand": "AMAL / A.M.A.Learning",
    "hasApiKey": true,
    "hasN8nAuth": true,
    "model": "gemini-2.5-flash-lite",
    "version": "1.0.0"
  }
  ```
- **Rate Limit:** 120 requests/minute per client.

---

## Deployment Guide (Google Cloud Run)

The application is containerized using a multi-stage `Dockerfile` optimized for Google Cloud Run:

1. **Build Container Image:**
   ```bash
   gcloud builds submit --tag gcr.io/PROJECT_ID/amal-whatsapp-assistant
   ```

2. **Deploy Service to Cloud Run:**
   ```bash
   gcloud run deploy amal-whatsapp-assistant \
     --image gcr.io/PROJECT_ID/amal-whatsapp-assistant \
     --platform managed \
     --region europe-west1 \
     --allow-unauthenticated \
     --port 8080 \
     --set-env-vars NODE_ENV=production \
     --set-secrets GEMINI_API_KEY=GEMINI_API_KEY:latest,N8N_API_KEY=N8N_API_KEY:latest
   ```

3. **Configure n8n Cloud:**
   - In your n8n workflow, create an **HTTP Request** node.
   - **Method:** `POST`
   - **URL:** `https://<YOUR-CLOUD-RUN-URL>/api/chat`
   - **Headers:** `x-api-key: <N8N_API_KEY>`
   - **Body Parameters:**
     ```json
     {
       "messages": [
         { "role": "user", "content": "={{ $json.body.message }}" }
       ]
     }
     ```

---

## Security & Privacy Guardrails

- **Zero Secret Exposure:** Backend tokens (`GEMINI_API_KEY`, `N8N_API_KEY`) are kept on the server and never injected into client-side Vite bundles.
- **Fail-Closed External Access:** External production requests without a valid `x-api-key` are blocked with `HTTP 401`.
- **DoS & Cost Protection:** In-memory sliding window rate limits protect Gemini API quotas and server compute.
- **Cache Flooding Prevention:** Unauthenticated callers cannot force upstream cache refreshes with `?refresh=true`.
- **Student Data Safeguards:** The assistant enforces strict policy rules preventing the disclosure of unverified mock exam results, passwords, or personal details over chat.
