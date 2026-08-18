import { REDIS_CLIENT } from '@/config/dotenv';
import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService {
    private readonly KEY_SEPARATOR = ':';
    private readonly logger = new Logger(RedisService.name);

    // In-flight promise cache to prevent thundering herd on getOrSet()
    private readonly inflight = new Map<string, Promise<unknown>>();

    private readonly ttl: number;
    private readonly prefix: string;

    /**
     * Nest DI only injects REDIS_CLIENT. ttl/prefix are NOT constructor DI params —
     * scoped clones are created via createScoped() so Nest never tries to resolve Number/String.
     */
    constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
        this.ttl = 3600;
        this.prefix = '';
        this.attachListeners();
    }

    /** Build a scoped instance that shares the same Redis connection (no extra listeners). */
    private static createScoped(redis: Redis, ttl: number, prefix: string): RedisService {
        const scoped = Object.create(RedisService.prototype) as RedisService;
        Object.assign(scoped, {
            redis,
            ttl,
            prefix,
            KEY_SEPARATOR: ':',
            logger: new Logger(RedisService.name),
            inflight: new Map<string, Promise<unknown>>(),
        });
        return scoped;
    }

    private attachListeners(): void {
        this.logger.log('Redis client initialized');
        this.redis.on('connect', () => this.logger.log('Redis client connected'));
        this.redis.on('error', (err) => this.logger.error('Redis client error', err));
        this.redis.on('reconnecting', () => this.logger.log('Redis client reconnecting'));
        this.redis.on('end', () => this.logger.log('Redis client disconnected'));
        this.redis.on('ready', () => this.logger.log('Redis client ready'));
        this.redis.on('close', () => this.logger.log('Redis client closed'));
    }

    get client(): Redis {
        return this.redis;
    }

    /**
     * Shares the same redis connection, returns a new immutable instance with a prefix.
     * The root singleton is left unchanged.
     */
    withPrefix(prefix: string): RedisService {
        return RedisService.createScoped(this.redis, this.ttl, prefix);
    }

    /**
     * Shares the same redis connection, returns a new immutable instance with a default TTL.
     * The root singleton is left unchanged.
     */
    withTtl(ttl: number): RedisService {
        return RedisService.createScoped(this.redis, ttl, this.prefix);
    }

    withTtlMin(minutes: number): RedisService {
        if (!Number.isFinite(minutes) || minutes <= 0) {
            throw new Error(`withTtlMin: minutes must be a positive finite number, got ${minutes}`);
        }
        return this.withTtl(Math.round(minutes * 60));
    }

    private buildKey(keys: string[] | string): string {
        const keysArray = Array.isArray(keys) ? keys : [keys];
        return [this.prefix, ...keysArray].filter(Boolean).join(this.KEY_SEPARATOR);
    }

    private resolveTtl(ttl?: number): number {
        return ttl && ttl > 0 ? ttl : this.ttl;
    }

    private serialize(value: unknown): string {
        return JSON.stringify(value);
    }

    private deserialize<T>(raw: string): T {
        try {
            return JSON.parse(raw) as T;
        } catch {
            // Not JSON — return the raw string as-is.
            return raw as unknown as T;
        }
    }

    async get<T = unknown>(keys: string[] | string): Promise<T | null> {
        const key = this.buildKey(keys);
        try {
            const value = await this.redis.get(key);
            if (value === null) return null;
            return this.deserialize<T>(value);
        } catch (err) {
            this.logger.error(`Failed to get key "${key}"`, err);
            return null;
        }
    }

    async set<T = unknown>(keys: string[] | string, value: T, ttl?: number): Promise<boolean> {
        const key = this.buildKey(keys);
        const effectiveTtl = this.resolveTtl(ttl);

        if (value === undefined) {
            this.logger.warn(`Refusing to set key "${key}" with undefined value`);
            return false;
        }

        try {
            await this.redis.set(key, this.serialize(value), 'EX', effectiveTtl);
            return true;
        } catch (err) {
            this.logger.error(`Failed to set key "${key}"`, err);
            return false;
        }
    }

    async del(keys: string[] | string): Promise<boolean> {
        const key = this.buildKey(keys);
        try {
            await this.redis.del(key);
            return true;
        } catch (err) {
            this.logger.error(`Failed to delete key "${key}"`, err);
            return false;
        }
    }

    async has(keys: string[] | string): Promise<boolean> {
        const key = this.buildKey(keys);
        try {
            return (await this.redis.exists(key)) === 1;
        } catch (err) {
            this.logger.error(`Failed to check existence of key "${key}"`, err);
            return false;
        }
    }

    /**
     * Cache-aside: return cached value if present, otherwise run callback, cache, return.
     * Not a Redis MULTI/EXEC transaction. Concurrent misses in the same process are
     * deduped via the in-flight map.
     */
    async getOrSet<T = unknown>(
        keys: string[] | string,
        callback: () => Promise<T>,
        options?: { ttl?: number; logging?: boolean },
    ): Promise<T> {
        const key = this.buildKey(keys);
        const effectiveTtl = this.resolveTtl(options?.ttl);
        const logging = options?.logging ?? false;

        const cached = await this.get<T>(keys);
        if (cached !== null) {
            if (logging) this.logger.log(`Cache hit for key "${key}"`);
            return cached;
        }

        const existingInflight = this.inflight.get(key);
        if (existingInflight) {
            if (logging) this.logger.log(`Joining in-flight compute for key "${key}"`);
            return existingInflight as Promise<T>;
        }

        const computePromise = (async (): Promise<T> => {
            try {
                if (logging) this.logger.log(`Cache miss for key "${key}", computing...`);
                const result = await callback();

                if (result !== undefined) {
                    try {
                        await this.redis.set(key, this.serialize(result), 'EX', effectiveTtl);
                        if (logging) this.logger.log(`Cache set for key "${key}" (ttl=${effectiveTtl}s)`);
                    } catch (err) {
                        this.logger.error(`Failed to cache computed value for key "${key}"`, err);
                    }
                }

                return result;
            } finally {
                this.inflight.delete(key);
            }
        })();

        this.inflight.set(key, computePromise);
        return computePromise;
    }

    /**
     * @deprecated Use getOrSet() — this was never a real Redis transaction.
     */
    async transaction<T = unknown>(
        keys: string[] | string,
        callback: () => Promise<T>,
        options?: { ttl?: number; logging?: boolean },
    ): Promise<T> {
        return this.getOrSet<T>(keys, callback, options);
    }
}
