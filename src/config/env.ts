/**
 * Typed, validated reads of numeric environment variables.
 *
 * Problems are recorded rather than thrown, so `assertConfig()` can report every
 * misconfiguration at once from a single place at boot instead of failing on
 * whichever module happened to be imported first. Callers always receive a usable
 * value (the fallback) so module initialisation stays total.
 */

const configErrors: string[] = [];

/** Records a configuration problem for `assertConfig()` to report at boot. */
export function recordConfigError(message: string): void {
    configErrors.push(message);
}

/** Every configuration problem recorded so far. */
export function getConfigErrors(): readonly string[] {
    return configErrors;
}

/** Test-only: clears recorded problems between cases. */
export function resetConfigErrors(): void {
    configErrors.length = 0;
}

export interface IntEnvRange {
    min: number;
    max: number;
}

/**
 * Reads an integer env var, falling back when unset, empty, or invalid.
 *
 * Rejects non-integers (including `12.5`, `1e3`, `NaN`, and `""`) and values outside
 * `range`, recording the reason. A bare `Number()` would silently accept `"  "` as 0
 * and `"1e9"` as a billion, so both are screened explicitly.
 */
export function readIntEnv(key: string, fallback: number, range: IntEnvRange): number {
    const raw = process.env[key];
    if (raw === undefined || raw.trim() === '') return fallback;

    // Number() accepts whitespace, hex and exponent forms; require plain digits so a
    // typo like "50MB" or "1e9" is reported instead of being silently reinterpreted.
    if (!/^-?\d+$/.test(raw.trim())) {
        recordConfigError(`${key} must be a plain integer (got ${JSON.stringify(raw)})`);
        return fallback;
    }

    const parsed = Number(raw.trim());
    if (!Number.isSafeInteger(parsed)) {
        recordConfigError(`${key} is not a safe integer (got ${JSON.stringify(raw)})`);
        return fallback;
    }
    if (parsed < range.min || parsed > range.max) {
        recordConfigError(`${key} must be between ${range.min} and ${range.max} (got ${parsed})`);
        return fallback;
    }

    return parsed;
}
