/**
 * Parser for the flat text blob returned by Redis `INFO`.
 *
 * The format is sections introduced by `# Name`, then `key:value` lines, CRLF-separated:
 *
 *     # Server
 *     redis_version:7.0.15
 *     ...
 *     # Keyspace
 *     db0:keys=412,expires=97,avg_ttl=0
 *
 * Everything is a string on the wire — the typed getters below are the only place that
 * coerces, so a field Redis stopped reporting (they do change between versions) degrades
 * to `null` rather than `NaN` leaking into the API response.
 */
export type RedisInfo = Record<string, Record<string, string>>;

export function parseRedisInfo(raw: string): RedisInfo {
    const info: RedisInfo = {};
    let section = 'other';

    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('#')) {
            section = trimmed.slice(1).trim().toLowerCase();
            info[section] ??= {};
            continue;
        }

        const idx = trimmed.indexOf(':');
        if (idx === -1) continue;

        info[section] ??= {};
        info[section][trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
    }

    return info;
}

export function infoStr(info: RedisInfo, section: string, key: string): string | null {
    const value = info[section]?.[key];
    return value === undefined || value === '' ? null : value;
}

export function infoNum(info: RedisInfo, section: string, key: string): number | null {
    const value = infoStr(info, section, key);
    if (value === null) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

export function infoBool(info: RedisInfo, section: string, key: string): boolean | null {
    const value = infoStr(info, section, key);
    return value === null ? null : value === '1' || value.toLowerCase() === 'yes';
}

/**
 * Per-database line from the `Keyspace` section: `db0:keys=412,expires=97,avg_ttl=0`.
 * A database with zero keys emits no line at all, hence the explicit zeroed fallback —
 * "empty" and "unknown" are different answers on a status page.
 */
export function keyspaceFor(info: RedisInfo, db: number): { keys: number; expires: number; avgTtl: number | null } {
    const line = infoStr(info, 'keyspace', `db${db}`);
    if (!line) return { keys: 0, expires: 0, avgTtl: null };

    const fields: Record<string, number> = {};
    for (const pair of line.split(',')) {
        const [key, value] = pair.split('=');
        if (key && value !== undefined) fields[key.trim()] = Number(value);
    }

    const finite = (name: string): number | null => (Number.isFinite(fields[name]) ? fields[name] : null);

    return {
        keys: finite('keys') ?? 0,
        expires: finite('expires') ?? 0,
        avgTtl: finite('avg_ttl'),
    };
}
