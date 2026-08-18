export const ERROR_STATUSES = ['critical', 'normal', 'warn'] as const;

export type ErrorStatus = (typeof ERROR_STATUSES)[number];

export type ApiErrorFieldMap = Record<string, string[]>;

export interface ApiErrorBody {
    message: string;
    statusCode: number;
    code?: string | null;
    localeKey?: string | null;
    status?: ErrorStatus | null;
    errors?: ApiErrorFieldMap | null;
    /** Extra top-level fields merged into the JSON response alongside the standard envelope —
     *  e.g. checkout's `conflicts: [{ lineId, title, available }]` on a 409 STOCK_CONFLICT, a
     *  shape the mobile app's error handler is already coded against. Rare: only use this when a
     *  specific documented contract needs a field outside the standard envelope. */
    meta?: Record<string, unknown> | null;
}

export interface ApiErrorMetaOptions {
    code?: string | null;
    localeKey?: string | null;
    status?: ErrorStatus | null;
}

export const API_ERROR_META_KEY = 'api:error:meta';

export const MUTATING_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
