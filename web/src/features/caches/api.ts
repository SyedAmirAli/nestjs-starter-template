import { apiFetch, apiMutate, toQuery } from '../../lib/api'

export type RedisKeyType = 'string' | 'hash' | 'list' | 'set' | 'zset' | 'stream' | 'none'

export interface CacheEntryMeta {
  key: string
  type: RedisKeyType
  createdAt: null
  size: number
  duration: number | null
  revalidatesAt: string | null
  idleSeconds: number | null
}

export interface CacheEntry extends CacheEntryMeta {
  value: unknown
}

export type RedisState = 'up' | 'connecting' | 'down'

export interface RedisStatus {
  state: RedisState
  clientStatus: string
  latencyMs: number | null
  connection: { host: string; port: number; db: number; username: string | null }
  error: string | null
  checkedAt: string
  server: {
    version: string | null
    mode: string | null
    os: string | null
    uptimeSeconds: number | null
    processId: number | null
    configFile: string | null
  } | null
  memory: {
    usedBytes: number | null
    usedHuman: string | null
    peakBytes: number | null
    rssBytes: number | null
    maxBytes: number | null
    maxPolicy: string | null
    fragmentationRatio: number | null
  } | null
  clients: { connected: number | null; blocked: number | null; max: number | null } | null
  stats: {
    opsPerSec: number | null
    totalConnections: number | null
    totalCommands: number | null
    keyspaceHits: number | null
    keyspaceMisses: number | null
    hitRate: number | null
    expiredKeys: number | null
    evictedKeys: number | null
  } | null
  persistence: {
    aofEnabled: boolean | null
    loading: boolean | null
    changesSinceLastSave: number | null
    lastSaveAt: string | null
  } | null
  keyspace: { db: number; keys: number; expires: number } | null
  control: { driver: string; enabled: boolean; reason: string }
}

export interface RedisControlResult {
  action: 'start' | 'restart'
  driver: string
  detail: string
  durationMs: number
  status: RedisStatus
}

const BASE = '/admin/caches'

const keyPath = (key: string) => `${BASE}/${encodeURIComponent(key)}`

export function fetchRedisStatus(signal?: AbortSignal) {
  return apiFetch<RedisStatus>(`${BASE}/status`, { signal })
}

export function listCacheKeys(pattern: string, signal?: AbortSignal) {
  return apiFetch<{ total: number; data: Array<CacheEntryMeta> }>(
    `${BASE}${toQuery({ pattern })}`,
    { signal },
  )
}

export function getCacheEntry(key: string, signal?: AbortSignal) {
  return apiFetch<CacheEntry>(keyPath(key), { signal })
}

export function startRedis() {
  return apiMutate<RedisControlResult>(`${BASE}/redis/start`, { method: 'POST' })
}

export function restartRedis() {
  return apiMutate<RedisControlResult>(`${BASE}/redis/restart`, { method: 'POST' })
}

export function setCacheEntry(input: { key: string; value: unknown; ttl?: number }) {
  return apiMutate<CacheEntryMeta>(BASE, { method: 'POST', body: JSON.stringify(input) })
}

export function deleteCacheEntry(key: string) {
  return apiMutate<{ key: string }>(keyPath(key), { method: 'DELETE' })
}

export function bulkDeleteCacheEntries(keys: Array<string>) {
  return apiMutate<{ requested: number; deleted: number }>(`${BASE}/bulk-delete`, {
    method: 'POST',
    body: JSON.stringify({ keys }),
  })
}
