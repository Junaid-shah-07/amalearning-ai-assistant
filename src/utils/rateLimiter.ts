import { Request, Response, NextFunction } from 'express';

export interface RateLimitOptions {
  windowMs?: number; // Time window in milliseconds (default: 60,000 = 1 minute)
  max?: number;      // Maximum requests per window (default: 60)
  keyGenerator?: (req: Request) => string;
  skip?: (req: Request) => boolean;
}

interface ClientBucket {
  count: number;
  resetTime: number;
}

// In-memory bucket storage
const store = new Map<string, ClientBucket>();

// Periodic cleanup of expired buckets every 2 minutes
const CLEANUP_INTERVAL_MS = 120000;
let cleanupTimer: NodeJS.Timeout | null = null;

function ensureCleanupTimer() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of store.entries()) {
      if (bucket.resetTime <= now) {
        store.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  // Do not hold Node process open for cleanup timer
  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }
}

/**
 * Resets the in-memory rate limit store (useful for automated tests).
 */
export function resetRateLimitStore(): void {
  store.clear();
}

/**
 * Default key generator:
 * Prioritises x-api-key header for authenticated external clients,
 * then falls back to IP address (supporting x-forwarded-for behind reverse proxies).
 */
export function defaultKeyGenerator(req: Request): string {
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.trim()) {
    return `key:${apiKey.trim()}`;
  }
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return `ip:${forwarded.split(',')[0].trim()}`;
  }
  return `ip:${req.ip || req.socket?.remoteAddress || '127.0.0.1'}`;
}

/**
 * Checks rate limit for a given key.
 */
export function checkRateLimit(
  key: string,
  options: { windowMs?: number; max?: number } = {}
): { allowed: boolean; retryAfterSeconds: number; remaining: number; total: number } {
  const windowMs = options.windowMs ?? 60000;
  const max = options.max ?? 60;
  const now = Date.now();

  ensureCleanupTimer();

  let bucket = store.get(key);
  if (!bucket || bucket.resetTime <= now) {
    bucket = { count: 1, resetTime: now + windowMs };
    store.set(key, bucket);
    return {
      allowed: true,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
      remaining: max - 1,
      total: max,
    };
  }

  bucket.count += 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetTime - now) / 1000));
  const remaining = Math.max(0, max - bucket.count);

  if (bucket.count > max) {
    return {
      allowed: false,
      retryAfterSeconds,
      remaining: 0,
      total: max,
    };
  }

  return {
    allowed: true,
    retryAfterSeconds,
    remaining,
    total: max,
  };
}

/**
 * Express middleware that enforces rate limiting on endpoints like POST /api/chat.
 */
export function createRateLimitMiddleware(options: RateLimitOptions = {}) {
  const windowMs = options.windowMs ?? 60000;
  const max = options.max ?? 60;
  const keyGenerator = options.keyGenerator || defaultKeyGenerator;
  const skip = options.skip || (() => false);

  return (req: Request, res: Response, next: NextFunction) => {
    if (skip(req)) {
      return next();
    }

    const key = keyGenerator(req);
    const result = checkRateLimit(key, { windowMs, max });

    res.setHeader('X-RateLimit-Limit', max.toString());
    res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
    res.setHeader('X-RateLimit-Reset', result.retryAfterSeconds.toString());

    if (!result.allowed) {
      res.setHeader('Retry-After', result.retryAfterSeconds.toString());
      return res.status(429).json({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please wait a moment before sending more messages.',
        retryAfter: result.retryAfterSeconds,
      });
    }

    next();
  };
}
