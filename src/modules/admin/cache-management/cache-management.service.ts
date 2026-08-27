import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@/shared/redis/redis.service';
import { RedisStatusService, type RedisStatus } from '@/shared/redis/redis-status.service';
import { RedisControlService, type RedisControlAction, type RedisControlCapability } from '@/shared/redis/control';
import { AuditAction, AuditService, AUDIT_RESOURCES } from '@/modules/admin/audit';
import { ApiException } from '@/common/errors/api.exception';
import { BulkDeleteCacheDto, SetCacheDto } from './dto/cache-management.dto';

export type RedisKeyType = 'string' | 'hash' | 'list' | 'set' | 'zset' | 'stream' | 'none';

export type CacheEntryMeta = {
    key: string;
    type: RedisKeyType;
    /** Redis does not store creation time for most key types — always null. */
    createdAt: null;
    /** Value size in bytes (MEMORY USAGE when available, else a type-safe fallback). */
    size: number;
    /** Remaining TTL in seconds. `null` means no expiry (-1). */
    duration: number | null;
    /** ISO timestamp when the key expires / will revalidate. `null` if no TTL. */
    revalidatesAt: string | null;
    /** Seconds since last access (OBJECT IDLETIME). Best age proxy Redis offers. */
    idleSeconds: number | null;
};

/** What the panel needs to render the whole page header: health plus what can be done about it. */
export type CacheStatus = RedisStatus & { control: RedisControlCapability };

export type Actor = { id: string; email: string } | null;

@Injectable()
export class CacheManagementService {
    private readonly logger = new Logger(CacheManagementService.name);

    constructor(
        private readonly redis: RedisService,
        private readonly status: RedisStatusService,
        private readonly control: RedisControlService,
        private readonly audit: AuditService,
    ) {}

    private get client() {
        return this.redis.client;
    }

    /**
     * Health + control capability in one call. Never throws on a down Redis — reporting the
     * outage *is* the job here, so an error response would defeat the purpose.
     */
    async getStatus(): Promise<CacheStatus> {
        return { ...(await this.status.probe()), control: this.control.capability };
    }

    /**
     * Start or restart Redis through whichever control driver is configured.
     * Audited unconditionally: this is the most privileged thing the panel can do.
     */
    async runControl(action: RedisControlAction, actor: Actor) {
        try {
            const result = await this.control.run(action);

            await this.audit.log({
                actorId: actor?.id,
                actorEmail: actor?.email,
                action: AuditAction.STATUS_CHANGE,
                resource: AUDIT_RESOURCES.SYSTEM,
                resourceId: 'redis',
                summary: `Redis ${action} via "${result.driver}" driver`,
                meta: { ...result },
            });

            return {
                message: `Redis ${action} completed`,
                data: {
                    ...result,
                    // ioredis reconnects on its own within ~2s, so the caller should re-poll
                    // rather than trust a status read taken microseconds after the restart.
                    status: await this.status.probe(),
                },
            };
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);

            await this.audit.log({
                actorId: actor?.id,
                actorEmail: actor?.email,
                action: AuditAction.STATUS_CHANGE,
                resource: AUDIT_RESOURCES.SYSTEM,
                resourceId: 'redis',
                summary: `Redis ${action} FAILED`,
                meta: { action, driver: this.control.capability.driver, error: detail },
            });

            this.logger.error(`Redis ${action} failed: ${detail}`);
            throw new ApiException({
                statusCode: HttpStatus.BAD_GATEWAY,
                message: detail,
                code: 'REDIS_CONTROL_FAILED',
                status: 'critical',
            });
        }
    }

    /**
     * Every key operation below goes through here first.
     *
     * The shared client is built with `maxRetriesPerRequest: null`, which means a command
     * issued while Redis is down is queued indefinitely rather than rejected — the request
     * would hang until the client timed out, and the panel could never even render the
     * "Redis is down" state it exists to show. Failing fast with a 503 is what makes the
     * outage visible.
     */
    private async ensureReachable(): Promise<void> {
        if (await this.status.waitForReady()) return;

        throw new ApiException({
            statusCode: HttpStatus.SERVICE_UNAVAILABLE,
            message: 'Redis is unavailable, so cache keys cannot be read or written.',
            code: 'REDIS_UNAVAILABLE',
            status: 'critical',
        });
    }

    /** List all keys with size / remaining TTL / revalidate time. No pagination (SCAN is cheap enough for admin). */
    async findAll(pattern = '*'): Promise<{ total: number; data: CacheEntryMeta[] }> {
        await this.ensureReachable();
        const keys = await this.scanKeys(pattern);
        const data: CacheEntryMeta[] = [];

        for (const key of keys) {
            data.push(await this.metaFor(key));
        }

        data.sort((a, b) => a.key.localeCompare(b.key));
        return { total: data.length, data };
    }

    async getOne(key: string) {
        await this.ensureReachable();
        const type = await this.client.type(key);
        if (type === 'none') this.notFound(key);

        const meta = await this.metaFor(key, type);
        const value = await this.readByType(key, type);
        return { ...meta, value };
    }

    async set(dto: SetCacheDto) {
        await this.ensureReachable();

        if (dto.value === undefined) {
            throw new ApiException({
                statusCode: HttpStatus.BAD_REQUEST,
                message: 'Cache value is required (use null for an empty JSON null).',
                code: 'CACHE_VALUE_REQUIRED',
                status: 'warn',
            });
        }

        const existingType = await this.client.type(dto.key);
        if (existingType !== 'none' && existingType !== 'string') {
            throw new ApiException({
                statusCode: HttpStatus.CONFLICT,
                message: `Key "${dto.key}" exists as Redis type "${existingType}". Delete it first before setting a string value.`,
                code: 'CACHE_WRONG_TYPE',
                status: 'warn',
            });
        }

        const ok = await this.redis.set(dto.key, dto.value, dto.ttl);
        if (!ok) {
            throw new ApiException({
                statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
                message: `Failed to set cache key: ${dto.key}`,
                code: 'CACHE_SET_FAILED',
                status: 'critical',
            });
        }
        return {
            message: 'Cache key set successfully',
            data: await this.metaFor(dto.key),
        };
    }

    async remove(key: string) {
        await this.ensureReachable();

        const exists = await this.client.exists(key);
        if (!exists) this.notFound(key);

        await this.client.del(key);
        return { message: 'Cache key deleted successfully', data: { key } };
    }

    async bulkDelete(dto: BulkDeleteCacheDto) {
        await this.ensureReachable();

        const unique = [...new Set(dto.keys.map((k) => k.trim()).filter(Boolean))];
        if (!unique.length) {
            throw new ApiException({
                statusCode: HttpStatus.BAD_REQUEST,
                message: 'At least one cache key is required.',
                code: 'CACHE_KEYS_REQUIRED',
                status: 'warn',
            });
        }

        const deleted = await this.client.del(...unique);
        return {
            message: 'Cache keys deleted',
            data: {
                requested: unique.length,
                deleted,
                keys: unique,
            },
        };
    }

    private async metaFor(key: string, knownType?: string): Promise<CacheEntryMeta> {
        const now = Date.now();
        const type = knownType ?? (await this.client.type(key));
        const [ttl, idle, size] = await Promise.all([
            this.client.ttl(key),
            this.safeIdle(key),
            this.safeSize(key, type),
        ]);

        const duration = ttl >= 0 ? ttl : null;
        const revalidatesAt = duration != null ? new Date(now + duration * 1000).toISOString() : null;

        return {
            key,
            type: type as RedisKeyType,
            createdAt: null,
            size,
            duration,
            revalidatesAt,
            idleSeconds: idle,
        };
    }

    /** Read value with the correct Redis command for the key's type (BullMQ keys are often hashes). */
    private async readByType(key: string, type: string): Promise<unknown> {
        switch (type) {
            case 'string':
                return this.parseValue(await this.client.get(key));
            case 'hash':
                return this.parseHash(await this.client.hgetall(key));
            case 'list':
                return (await this.client.lrange(key, 0, -1)).map((v) => this.parseValue(v));
            case 'set':
                return (await this.client.smembers(key)).map((v) => this.parseValue(v));
            case 'zset': {
                const flat = await this.client.zrange(key, 0, -1, 'WITHSCORES');
                const out: Array<{ member: unknown; score: number }> = [];
                for (let i = 0; i < flat.length; i += 2) {
                    out.push({ member: this.parseValue(flat[i] ?? ''), score: Number(flat[i + 1]) });
                }
                return out;
            }
            case 'stream': {
                // Cap stream reads so huge BullMQ/event streams don't blow the response.
                const entries = await this.client.xrange(key, '-', '+', 'COUNT', 100);
                return entries.map(([id, fields]) => ({
                    id,
                    fields: this.fieldsToObject(fields),
                }));
            }
            default:
                return {
                    unsupported: true,
                    type,
                    message: `Reading Redis type "${type}" is not supported by this endpoint.`,
                };
        }
    }

    private async scanKeys(pattern: string): Promise<string[]> {
        const keys: string[] = [];
        let cursor = '0';
        do {
            const [next, batch] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
            cursor = next;
            keys.push(...batch);
        } while (cursor !== '0');
        return keys;
    }

    private async safeSize(key: string, type: string): Promise<number> {
        try {
            const usage = await this.client.call('MEMORY', 'USAGE', key);
            if (typeof usage === 'number') return usage;
            if (typeof usage === 'string' && usage !== '') return Number(usage) || 0;
        } catch (err) {
            this.logger.debug(`MEMORY USAGE unavailable for "${key}": ${String(err)}`);
        }

        // Never call GET on non-string keys (BullMQ / hashes → WRONGTYPE).
        try {
            switch (type) {
                case 'string': {
                    const raw = await this.client.get(key);
                    return raw == null ? 0 : Buffer.byteLength(raw, 'utf8');
                }
                case 'hash':
                    return await this.client.hlen(key);
                case 'list':
                    return await this.client.llen(key);
                case 'set':
                    return await this.client.scard(key);
                case 'zset':
                    return await this.client.zcard(key);
                case 'stream':
                    return await this.client.xlen(key);
                default:
                    return 0;
            }
        } catch {
            return 0;
        }
    }

    private async safeIdle(key: string): Promise<number | null> {
        try {
            const idle = await this.client.object('IDLETIME', key);
            return typeof idle === 'number' ? idle : null;
        } catch {
            return null;
        }
    }

    private parseHash(hash: Record<string, string>): Record<string, unknown> {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(hash)) {
            out[k] = this.parseValue(v);
        }
        return out;
    }

    private fieldsToObject(fields: string[]): Record<string, unknown> {
        const out: Record<string, unknown> = {};
        for (let i = 0; i < fields.length; i += 2) {
            const k = fields[i];
            if (k == null) continue;
            out[k] = this.parseValue(fields[i + 1] ?? null);
        }
        return out;
    }

    private parseValue(raw: string | null): unknown {
        if (raw == null) return null;
        try {
            return JSON.parse(raw);
        } catch {
            return raw;
        }
    }

    private notFound(key: string): never {
        throw new ApiException({
            statusCode: HttpStatus.NOT_FOUND,
            message: `Cache key not found: ${key}`,
            code: 'CACHE_KEY_NOT_FOUND',
            status: 'warn',
        });
    }
}
