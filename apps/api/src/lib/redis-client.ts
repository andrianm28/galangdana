const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

/**
 * Bun's native Redis client (available since Bun 1.2+, verified against
 * this repo's installed Bun 1.4.0 and the running docker-compose redis
 * service before this file was written) — no ioredis/node-redis dependency
 * needed.
 */
export const redis = new Bun.RedisClient(REDIS_URL);
