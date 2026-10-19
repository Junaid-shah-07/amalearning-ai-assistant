/**
 * Gemini API Retry Utility
 *
 * Implements resilient retry logic for Google Gemini API:
 * - Handles transient 503 (Service Unavailable / Overloaded) and 429 (Rate Limit / Quota) errors
 * - Maximum of 2 retries using exponential backoff with jitter
 * - Aborts immediately on permanent 4xx errors (e.g., 400 Invalid API Key, 401, 403)
 * - Sanitizes error messages to ensure API keys and secrets are never exposed in logs
 */

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, error: any, delayMs: number) => void;
}

/**
 * Extracts HTTP status code from error object or error message.
 */
export function extractStatusCode(err: any): number | null {
  if (!err) return null;

  if (typeof err.status === 'number' && Number.isFinite(err.status)) {
    return err.status;
  }
  if (typeof err.statusCode === 'number' && Number.isFinite(err.statusCode)) {
    return err.statusCode;
  }
  if (typeof err.code === 'number' && Number.isFinite(err.code)) {
    return err.code;
  }
  if (typeof err.response?.status === 'number') {
    return err.response.status;
  }

  // Handle string status like "503"
  if (typeof err.status === 'string' && /^\d+$/.test(err.status)) {
    return parseInt(err.status, 10);
  }

  // Extract from JSON payload in err.message if present
  if (typeof err.message === 'string') {
    try {
      const parsed = JSON.parse(err.message);
      if (typeof parsed?.error?.code === 'number') {
        return parsed.error.code;
      }
    } catch {
      // Not JSON string
    }

    // Look for status patterns like [503 Service Unavailable] or "status: 503"
    const match = err.message.match(/\[(\d{3})\b|\b(?:status|code)[:\s]+(\d{3})\b/i);
    if (match) {
      const code = parseInt(match[1] || match[2], 10);
      if (code >= 100 && code < 600) return code;
    }
  }

  return null;
}

/**
 * Determines whether an error is permanent (non-retryable client error).
 * Any 4xx error EXCEPT 429 (Too Many Requests) is considered permanent.
 */
export function isPermanentError(err: any): boolean {
  const status = extractStatusCode(err);
  if (status && status >= 400 && status < 500 && status !== 429) {
    return true;
  }

  if (err && typeof err.message === 'string') {
    const msg = err.message.toLowerCase();
    if (
      msg.includes('api_key_invalid') ||
      msg.includes('api key not valid') ||
      msg.includes('invalid api key') ||
      msg.includes('permission_denied') ||
      msg.includes('invalid_argument') ||
      msg.includes('unauthenticated') ||
      msg.includes('forbidden')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Determines whether an error is transient and safe to retry.
 * Matches 503 (Unavailable / Overloaded) and 429 (Too Many Requests / Rate Limited).
 */
export function isTransientError(err: any): boolean {
  // If explicitly a permanent error, do not treat as transient
  if (isPermanentError(err)) {
    return false;
  }

  const status = extractStatusCode(err);
  if (status === 503 || status === 429) {
    return true;
  }

  if (err && typeof err.message === 'string') {
    const msg = err.message.toLowerCase();
    if (
      msg.includes('503') ||
      msg.includes('429') ||
      msg.includes('unavailable') ||
      msg.includes('overloaded') ||
      msg.includes('resource_exhausted') ||
      msg.includes('high demand') ||
      msg.includes('too many requests') ||
      msg.includes('rate limit')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Calculates exponential backoff with full jitter.
 * delay = min(maxDelay, baseDelay * 2^attempt) + random(0, jitterMs)
 */
export function calculateBackoffWithJitter(
  attempt: number,
  baseDelayMs: number = 500,
  maxDelayMs: number = 3000,
  jitterMs: number = 200
): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
  const jitter = Math.floor(Math.random() * (jitterMs + 1));
  return exponential + jitter;
}

/**
 * Sanitizes an error message so that API keys, authorization headers,
 * and secret environment values are stripped before logging.
 */
export function sanitizeErrorMessage(err: any): string {
  if (!err) return 'Unknown error';
  let message = typeof err === 'string' ? err : err.message || err.toString() || 'Unknown error';

  // Redact potential API keys (e.g. AIza..., key=..., Bearer ...)
  message = message
    .replace(/key=[a-zA-Z0-9_\-]+/gi, 'key=[REDACTED]')
    .replace(/AIza[a-zA-Z0-9_\-]{20,}/g, '[REDACTED_API_KEY]')
    .replace(/Bearer\s+[a-zA-Z0-9_\-\.]+/gi, 'Bearer [REDACTED]')
    .replace(/(["']?apiKey["']?\s*[:=]\s*["'])([^"']+)(["'])/gi, '$1[REDACTED]$3');

  // Redact process.env secrets if loaded
  if (typeof process !== 'undefined' && process.env) {
    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.length > 5) {
      message = message.split(process.env.GEMINI_API_KEY).join('[REDACTED_GEMINI_KEY]');
    }
    if (process.env.N8N_API_KEY && process.env.N8N_API_KEY.length > 5) {
      message = message.split(process.env.N8N_API_KEY).join('[REDACTED_N8N_KEY]');
    }
  }

  return message;
}

/**
 * Executes a Gemini operation with up to maxRetries (default 2) for transient errors (503 / 429).
 * Aborts immediately on permanent errors (4xx).
 */
export async function executeGeminiWithRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<{ result: T; attempts: number }> {
  const maxRetries = options.maxRetries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 3000;
  const jitterMs = options.jitterMs ?? 200;
  const sleep = options.sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();
      return { result, attempts: attempt + 1 };
    } catch (err: any) {
      lastError = err;
      const sanitized = sanitizeErrorMessage(err);
      const statusCode = extractStatusCode(err);

      // Check if permanent error (e.g. 400 Invalid API Key, 401, 403)
      if (isPermanentError(err)) {
        console.warn(`[Gemini API] Permanent error encountered (status: ${statusCode || 400}). Aborting retries: ${sanitized}`);
        throw err;
      }

      // Check if transient error (503 or 429)
      if (!isTransientError(err)) {
        console.warn(`[Gemini API] Non-retryable error encountered (status: ${statusCode || 'unknown'}). Aborting retries: ${sanitized}`);
        throw err;
      }

      // If transient and we have retries remaining
      if (attempt < maxRetries) {
        const delay = calculateBackoffWithJitter(attempt, baseDelayMs, maxDelayMs, jitterMs);
        if (options.onRetry) {
          options.onRetry(attempt + 1, err, delay);
        } else {
          console.warn(
            `[Gemini API] Transient ${statusCode ? `HTTP ${statusCode}` : 'error'} received. Retry attempt ${attempt + 1}/${maxRetries} scheduled in ${delay}ms...`
          );
        }
        await sleep(delay);
      } else {
        console.warn(
          `[Gemini API] Maximum retries exhausted (${maxRetries}/${maxRetries}) for transient ${statusCode ? `HTTP ${statusCode}` : 'error'}: ${sanitized}`
        );
      }
    }
  }

  throw lastError;
}
