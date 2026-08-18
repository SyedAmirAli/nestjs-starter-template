import IORedis, { type RedisOptions } from 'ioredis';
import type { ConnectionOptions } from 'bullmq';
import { REDIS_DB, REDIS_HOST, REDIS_PASSWORD, REDIS_PORT, REDIS_URL, REDIS_USERNAME } from '@/config/dotenv';

/**
 * BullMQ requires `maxRetriesPerRequest: null` on its Redis connections (blocking commands).
 *
 * We hand BullMQ connection *options* (not a shared instance) so it manages its own
 * connections internally — this also sidesteps ioredis type-identity clashes with
 * BullMQ's bundled copy.
 */
export const bullConnection: ConnectionOptions = {
    host: REDIS_HOST,
    port: REDIS_PORT,
    username: REDIS_USERNAME ?? undefined,
    password: REDIS_PASSWORD ?? undefined,
    db: REDIS_DB,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
};

/** Standalone ioredis connection (e.g. for pub/sub / streaming fan-out in later phases). */
export const bullRedisOptions: RedisOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
};

export function createRedisConnection(): IORedis {
    return new IORedis(REDIS_URL, bullRedisOptions);
}
