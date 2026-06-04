import { logger } from "./logger.js";

interface RateLimitEntry {
  count: number;
  firstAttempt: number;
  lastAttempt: number;
  blockedUntil: number;
}

const store = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, entry] of store.entries()) {
    if (entry.blockedUntil < now && now - entry.lastAttempt > 3600000) {
      store.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.info({ cleaned }, "Rate-limit store cleaned up");
  }
}, 5 * 60 * 1000);

export interface RateLimitConfig {
  maxAttempts: number;
  windowMs: number;
  blockMs: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 10 * 60 * 1000, // 10 minutes
  blockMs: 15 * 60 * 1000,  // 15 minutes
};

function getKey(identifier: string, prefix: string): string {
  return `${prefix}:${identifier}`;
}

function getEntry(key: string): RateLimitEntry | undefined {
  return store.get(key);
}

function setEntry(key: string, entry: RateLimitEntry): void {
  store.set(key, entry);
}

function deleteEntry(key: string): void {
  store.delete(key);
}

export function getRemainingBlockMs(identifier: string, prefix: string): number {
  const key = getKey(identifier, prefix);
  const entry = getEntry(key);
  if (!entry) return 0;
  const now = Date.now();
  if (entry.blockedUntil > now) {
    return entry.blockedUntil - now;
  }
  return 0;
}

export function isRateLimited(identifier: string, prefix: string): boolean {
  return getRemainingBlockMs(identifier, prefix) > 0;
}

export function recordAttempt(identifier: string, prefix: string, config: RateLimitConfig = DEFAULT_CONFIG): { blocked: boolean; remainingBlockMs: number; attemptsRemaining: number } {
  const key = getKey(identifier, prefix);
  const now = Date.now();
  const entry = getEntry(key);

  if (entry && entry.blockedUntil > now) {
    return {
      blocked: true,
      remainingBlockMs: entry.blockedUntil - now,
      attemptsRemaining: 0,
    };
  }

  if (entry) {
    // Reset if window expired
    if (now - entry.firstAttempt > config.windowMs) {
      entry.count = 1;
      entry.firstAttempt = now;
      entry.lastAttempt = now;
      entry.blockedUntil = 0;
      setEntry(key, entry);
      return {
        blocked: false,
        remainingBlockMs: 0,
        attemptsRemaining: config.maxAttempts - 1,
      };
    }

    entry.count += 1;
    entry.lastAttempt = now;

    if (entry.count >= config.maxAttempts) {
      entry.blockedUntil = now + config.blockMs;
      setEntry(key, entry);
      logger.warn({ identifier, prefix, attempts: entry.count }, "Rate limit triggered");
      return {
        blocked: true,
        remainingBlockMs: config.blockMs,
        attemptsRemaining: 0,
      };
    }

    setEntry(key, entry);
    return {
      blocked: false,
      remainingBlockMs: 0,
      attemptsRemaining: config.maxAttempts - entry.count,
    };
  }

  // First attempt
  setEntry(key, {
    count: 1,
    firstAttempt: now,
    lastAttempt: now,
    blockedUntil: 0,
  });

  return {
    blocked: false,
    remainingBlockMs: 0,
    attemptsRemaining: config.maxAttempts - 1,
  };
}

export function recordSuccess(identifier: string, prefix: string): void {
  const key = getKey(identifier, prefix);
  deleteEntry(key);
}

export function getClientIp(req: any): string {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
    || req.headers["x-real-ip"]
    || req.socket?.remoteAddress
    || "unknown";
}

export function rateLimitErrorResponse(res: any, remainingBlockMs: number, message?: string): void {
  const minutes = Math.ceil(remainingBlockMs / 60000);
  res.status(429).json({
    error: message || `Too many failed attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    retryAfterMs: remainingBlockMs,
  });
}
