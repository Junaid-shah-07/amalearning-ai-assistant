import crypto from 'crypto';

/**
 * Constant-time string comparison to prevent timing attacks.
 */
export function verifyApiKey(provided: string | string[] | undefined, expected: string): boolean {
  if (!provided || typeof provided !== 'string' || !expected) {
    return false;
  }
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

export interface RequestAuthContext {
  headers: Record<string, string | string[] | undefined>;
}

export interface IsRequestAuthorizedOptions {
  configuredKey?: string;
  isProduction?: boolean;
}

/**
 * Determines whether a request originated from legitimate same-origin browser interaction
 * (e.g. AI Studio Preview UI) without requiring secrets to be shipped to the client frontend.
 */
export function isSameOriginRequest(req: RequestAuthContext): boolean {
  const secFetchSite = req.headers['sec-fetch-site'];
  const origin = req.headers['origin'];
  const referer = req.headers['referer'];
  const host = req.headers['host'];

  const originStr = typeof origin === 'string' ? origin : '';
  const refererStr = typeof referer === 'string' ? referer : '';
  const hostStr = typeof host === 'string' ? host : '';

  return (
    secFetchSite === 'same-origin' ||
    (Boolean(hostStr) && (originStr === `http://${hostStr}` || originStr === `https://${hostStr}`)) ||
    (Boolean(hostStr) && (refererStr.startsWith(`http://${hostStr}/`) || refererStr.startsWith(`https://${hostStr}/`)))
  );
}

/**
 * Validates request authorization for server-to-server and same-origin browser callers.
 * - Same-origin browser requests (Preview UI) are safely permitted without exposing secrets.
 * - External requests providing matching 'x-api-key' or 'Authorization: Bearer <key>' are authorized.
 * - In production (NODE_ENV === 'production' or options.isProduction === true):
 *   External requests without a valid matching key are strictly rejected (HTTP 401).
 * - In development without a configured key, external requests remain permissible for local convenience.
 */
export function isRequestAuthorized(
  req: RequestAuthContext,
  configuredKeyOrOptions?: string | IsRequestAuthorizedOptions,
  explicitIsProduction?: boolean
): boolean {
  let configuredKey = process.env.N8N_API_KEY || '';
  let isProduction = process.env.NODE_ENV === 'production';

  if (typeof configuredKeyOrOptions === 'string') {
    configuredKey = configuredKeyOrOptions;
    if (typeof explicitIsProduction === 'boolean') {
      isProduction = explicitIsProduction;
    }
  } else if (configuredKeyOrOptions && typeof configuredKeyOrOptions === 'object') {
    if (configuredKeyOrOptions.configuredKey !== undefined) {
      configuredKey = configuredKeyOrOptions.configuredKey;
    }
    if (configuredKeyOrOptions.isProduction !== undefined) {
      isProduction = configuredKeyOrOptions.isProduction;
    }
  }

  // 1. Allow legitimate same-origin browser requests (Preview UI)
  if (isSameOriginRequest(req)) {
    return true;
  }

  // 2. Check x-api-key header
  const apiKeyHeader = req.headers['x-api-key'];
  if (apiKeyHeader) {
    return verifyApiKey(apiKeyHeader, configuredKey);
  }

  // 3. Check Authorization header (Bearer <key> or ApiKey <key>)
  const authHeader = req.headers['authorization'];
  if (authHeader && typeof authHeader === 'string') {
    const match = authHeader.match(/^(?:Bearer|ApiKey)\s+(.+)$/i);
    const token = match ? match[1] : authHeader;
    return verifyApiKey(token, configuredKey);
  }

  // 4. In production, external requests MUST be authenticated with a configured key
  if (isProduction) {
    return false;
  }

  // 5. In non-production environments with no server secret configured, allow for local dev convenience
  if (!configuredKey) {
    return true;
  }

  // External request with no matching key
  return false;
}
