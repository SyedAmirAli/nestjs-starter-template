import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT, REDIS_DB, REDIS_HOST, REDIS_PASSWORD, REDIS_PORT, REDIS_USERNAME } from '@/config/dotenv';
import { infoBool, infoNum, infoStr, keyspaceFor, parseRedisInfo, type RedisInfo } from './redis-info.parser';

/**
 * Three states, not two. "connecting" matters on its own: right after a restart the shared
 * client spends a second or two reconnecting, and reporting that as `down` would make the
 * panel flash a scary red banner every single time Redis comes back.
 */
export type RedisState = 'up' | 'connecting' | 'down';

export interface RedisStatus {
    state: RedisState;
    /** ioredis' own view of the shared client (`ready`, `reconnecting`, `end`, …). */
    clientStatus: string;
    /** Round-trip time of the PING that produced this reading. `null` when unreachable. */
    latencyMs: number | null;
    connection: { host: string; port: number; db: number; username: string | null };
    /** Why it's down, in the words of the failed connection attempt (ECONNREFUSED, NOAUTH, …). */
    error: string | null;
    checkedAt: string;
    server: {
        version: string | null;
        mode: string | null;
        os: string | null;
        uptimeSeconds: number | null;
        processId: number | null;
        configFile: string | null;
    } | null;
    memory: {
        usedBytes: number | null;
        usedHuman: string | null;
        peakBytes: number | null;
        rssBytes: number | null;
        /** 0 means "no limit configured" in Redis' own reporting — kept as-is, not nulled. */
        maxBytes: number | null;
        maxPolicy: string | null;
        fragmentationRatio: number | null;
    } | null;
    clients: { connected: number | null; blocked: number | null; max: number | null } | null;
    stats: {
        opsPerSec: number | null;
        totalConnections: number | null;
        totalCommands: number | null;
        keyspaceHits: number | null;
        keyspaceMisses: number | null;
        /** Hit ratio 0–1 over the server's lifetime. `null` until there's at least one lookup. */
        hitRate: number | null;
        expiredKeys: number | null;
        evictedKeys: number | null;
    } | null;
    persistence: {
        aofEnabled: boolean | null;
        loading: boolean | null;
        changesSinceLastSave: number | null;
        lastSaveAt: string | null;
    } | null;
    /** Key counts for the DB this app is configured to use, not the whole server. */
    keyspace: { db: number; keys: number; expires: number } | null;
}

const PROBE_TIMEOUT = 2_000;

@Injectable()
export class RedisStatusService {
    private readonly logger = new Logger(RedisStatusService.name);

    /**
     * Last error the shared client emitted. ioredis reconnects forever in the background, so by
     * the time an admin opens the page the connection attempt that failed is long gone — without
     * remembering it, a down Redis would report "down" with no reason attached.
     */
    private lastError: string | null = null;

    constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
        this.redis.on('error', (err: Error) => {
            this.lastError = err.message;
        });
        this.redis.on('ready', () => {
            this.lastError = null;
        });
    }

    /** Cheap synchronous check — no I/O. Use to fail fast before issuing commands. */
    isReady(): boolean {
        return this.redis.status === 'ready';
    }

    /**
     * Wait out a brief reconnect window before declaring failure. Without this, every request
     * that lands during the ~1s gap after a Redis restart would 503 even though the connection
     * is milliseconds from being usable.
     */
    async waitForReady(timeoutMs = 2_000): Promise<boolean> {
        if (this.isReady()) return true;
        if (this.redis.status === 'end') return false;

        return new Promise<boolean>((resolve) => {
            const done = (result: boolean) => {
                clearTimeout(timer);
                this.redis.off('ready', onReady);
                resolve(result);
            };
            const onReady = () => done(true);
            const timer = setTimeout(() => done(false), timeoutMs);

            this.redis.once('ready', onReady);
        });
    }

    async probe(): Promise<RedisStatus> {
        const connection = {
            host: REDIS_HOST,
            port: REDIS_PORT,
            db: REDIS_DB,
            username: REDIS_USERNAME ?? null,
        };

        const base: RedisStatus = {
            state: 'down',
            clientStatus: this.redis.status,
            latencyMs: null,
            connection,
            error: this.lastError,
            checkedAt: new Date().toISOString(),
            server: null,
            memory: null,
            clients: null,
            stats: null,
            persistence: null,
            keyspace: null,
        };

        // Reuse the live connection when it's healthy; only pay for a throwaway socket when it
        // isn't. A separate probe is what makes a truthful reading possible at all — the shared
        // client sits in an endless reconnect loop when Redis is off and would never answer.
        const reading = this.isReady()
            ? await this.readVia(this.redis)
            : await this.readViaProbe(this.redis.status === 'wait' || this.redis.status === 'connecting');

        if (!reading.ok) {
            return {
                ...base,
                state: reading.connecting ? 'connecting' : 'down',
                error: reading.error ?? this.lastError,
            };
        }

        return { ...base, state: 'up', latencyMs: reading.latencyMs, error: null, ...this.describe(reading.info) };
    }

    /** PING for latency + INFO for everything else, both bounded so a wedged socket can't hang the request. */
    private async readVia(client: Redis): Promise<ProbeReading> {
        try {
            const startedAt = Date.now();
            await this.withTimeout(client.ping(), 'PING');
            const latencyMs = Date.now() - startedAt;
            const raw = await this.withTimeout(client.info(), 'INFO');
            return { ok: true, latencyMs, info: parseRedisInfo(raw) };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err), connecting: false };
        }
    }

    /**
     * One-shot connection with every retry disabled, so a refused connect surfaces the real
     * errno immediately instead of being swallowed by ioredis' backoff.
     */
    private async readViaProbe(connecting: boolean): Promise<ProbeReading> {
        const probe = new Redis({
            host: REDIS_HOST,
            port: REDIS_PORT,
            username: REDIS_USERNAME,
            password: REDIS_PASSWORD,
            db: REDIS_DB,
            lazyConnect: true,
            connectTimeout: PROBE_TIMEOUT,
            commandTimeout: PROBE_TIMEOUT,
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
            enableReadyCheck: true,
            retryStrategy: () => null,
            reconnectOnError: () => false,
        });

        // Two jobs for this listener. An EventEmitter with no 'error' listener rethrows as an
        // uncaught exception and takes the process down — and, less obviously, the event is the
        // ONLY place the real cause appears. `connect()` itself rejects with a flat
        // "Connection is closed.", which tells an admin nothing; the event carries
        // "connect ECONNREFUSED …" (Redis is off) or "WRONGPASS …" (Redis is fine, the password
        // isn't) — the difference between "press the button" and "the button won't help".
        let socketError: string | null = null;
        probe.on('error', (err: Error) => {
            socketError ??= err.message;
        });

        try {
            await this.withTimeout(probe.connect(), 'CONNECT');
            return await this.readVia(probe);
        } catch (err) {
            const error = socketError ?? (err instanceof Error ? err.message : String(err));
            this.logger.debug(`Redis probe failed: ${error}`);
            return { ok: false, error, connecting };
        } finally {
            probe.disconnect();
        }
    }

    private withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Redis ${label} timed out after ${PROBE_TIMEOUT}ms`)), PROBE_TIMEOUT);
            promise.then(
                (value) => {
                    clearTimeout(timer);
                    resolve(value);
                },
                (err: unknown) => {
                    clearTimeout(timer);
                    reject(err instanceof Error ? err : new Error(String(err)));
                },
            );
        });
    }

    private describe(info: RedisInfo) {
        const hits = infoNum(info, 'stats', 'keyspace_hits');
        const misses = infoNum(info, 'stats', 'keyspace_misses');
        const lookups = (hits ?? 0) + (misses ?? 0);
        const lastSave = infoNum(info, 'persistence', 'rdb_last_save_time');
        const { keys, expires } = keyspaceFor(info, REDIS_DB);

        return {
            server: {
                version: infoStr(info, 'server', 'redis_version'),
                mode: infoStr(info, 'server', 'redis_mode'),
                os: infoStr(info, 'server', 'os'),
                uptimeSeconds: infoNum(info, 'server', 'uptime_in_seconds'),
                processId: infoNum(info, 'server', 'process_id'),
                configFile: infoStr(info, 'server', 'config_file'),
            },
            memory: {
                usedBytes: infoNum(info, 'memory', 'used_memory'),
                usedHuman: infoStr(info, 'memory', 'used_memory_human'),
                peakBytes: infoNum(info, 'memory', 'used_memory_peak'),
                rssBytes: infoNum(info, 'memory', 'used_memory_rss'),
                maxBytes: infoNum(info, 'memory', 'maxmemory'),
                maxPolicy: infoStr(info, 'memory', 'maxmemory_policy'),
                fragmentationRatio: infoNum(info, 'memory', 'mem_fragmentation_ratio'),
            },
            clients: {
                connected: infoNum(info, 'clients', 'connected_clients'),
                blocked: infoNum(info, 'clients', 'blocked_clients'),
                max: infoNum(info, 'clients', 'maxclients'),
            },
            stats: {
                opsPerSec: infoNum(info, 'stats', 'instantaneous_ops_per_sec'),
                totalConnections: infoNum(info, 'stats', 'total_connections_received'),
                totalCommands: infoNum(info, 'stats', 'total_commands_processed'),
                keyspaceHits: hits,
                keyspaceMisses: misses,
                hitRate: lookups > 0 ? (hits ?? 0) / lookups : null,
                expiredKeys: infoNum(info, 'stats', 'expired_keys'),
                evictedKeys: infoNum(info, 'stats', 'evicted_keys'),
            },
            persistence: {
                aofEnabled: infoBool(info, 'persistence', 'aof_enabled'),
                loading: infoBool(info, 'persistence', 'loading'),
                changesSinceLastSave: infoNum(info, 'persistence', 'rdb_changes_since_last_save'),
                // Redis reports this as unix seconds; 0 means "never saved in this lifetime".
                lastSaveAt: lastSave && lastSave > 0 ? new Date(lastSave * 1000).toISOString() : null,
            },
            keyspace: { db: REDIS_DB, keys, expires },
        };
    }
}

type ProbeReading =
    | { ok: true; latencyMs: number; info: RedisInfo }
    | { ok: false; error: string | null; connecting: boolean };
