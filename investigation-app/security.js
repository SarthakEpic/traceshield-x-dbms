export function createFixedWindowRateLimiter({ windowMs, max, keyFn, skip } = {}) {
  const buckets = new Map();
  const duration = Math.max(1000, Number(windowMs) || 60_000);
  const limit = Math.max(1, Number(max) || 60);
  let lastCleanup = 0;

  return function rateLimiter(req, res, next) {
    if (skip?.(req)) return next();
    const now = Date.now();
    if (now - lastCleanup > duration) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
      }
      lastCleanup = now;
    }

    const key = String(keyFn?.(req) || req.ip || req.socket?.remoteAddress || 'unknown');
    const current = buckets.get(key);
    const bucket = current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + duration };
    bucket.count += 1;
    buckets.set(key, bucket);

    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - bucket.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > limit) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({ error: 'Too many requests. Try again later.', requestId: req.requestId });
    }
    return next();
  };
}
