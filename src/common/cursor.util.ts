/**
 * Keyset ("cursor") pagination for the feed.
 *
 * The one deliberate break from this repo's offset convention, and it is not optional for a
 * feed: `?page=2` on a list that grows at the head re-serves rows already rendered and skips
 * others, so the user sees duplicates and holes. See docs/FEED-API.md §1.
 *
 * The cursor is OPAQUE to the client — it only ever echoes back the `nextCursor` it was
 * given. That opacity is what lets the server key the feed on `publishedAt` (when a post
 * went live) while still serializing `createdAt` on the wire.
 */

import { ApiException } from '@/common/errors';

/** What a decoded cursor carries: the sort column value and the tiebreak id. */
export type Cursor = { c: string; i: string };

export type CursorPage<T> = { items: T[]; nextCursor: string | null };

export const encodeCursor = (value: Date | string | number, id: string): string =>
    Buffer.from(JSON.stringify({ c: value instanceof Date ? value.toISOString() : String(value), i: id })).toString(
        'base64url',
    );

export function decodeCursor(cursor: string | null | undefined): Cursor | null {
    if (!cursor) return null;

    try {
        const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (
            !parsed ||
            typeof parsed !== 'object' ||
            typeof (parsed as Cursor).c !== 'string' ||
            typeof (parsed as Cursor).i !== 'string'
        ) {
            throw new Error('malformed');
        }
        return parsed as Cursor;
    } catch {
        // A tampered or truncated cursor is a client bug, not a server error. Failing loudly
        // beats silently serving page 1 forever, which reads as "the feed is stuck".
        throw new ApiException({
            statusCode: 400,
            message: 'Invalid pagination cursor.',
            code: 'INVALID_CURSOR',
            localeKey: 'error.cursor.invalid',
        });
    }
}

/**
 * Prisma `where` fragment for "strictly after this cursor" in the given direction.
 *
 * The compound comparison is what makes the tiebreak stable for rows sharing a timestamp:
 * `(field < c) OR (field = c AND id < i)`. A naive `field < c` silently drops every row that
 * shares the boundary millisecond — which is exactly what happens when a burst of posts is
 * approved in one batch.
 *
 * `kind` picks how `cursor.c` (always stored as a string) is decoded back into the value the
 * field actually holds — `'date'` for timestamp columns (the default, every existing caller),
 * `'number'` for an `Int` column such as `sortOrder`. Ties on `sortOrder` are the common case
 * (most rows share the default), which is exactly what the `id` tiebreak is for.
 */
export function cursorWhere(
    cursor: Cursor | null,
    field: string,
    direction: 'asc' | 'desc' = 'desc',
    kind: 'date' | 'number' = 'date',
): Record<string, unknown> | undefined {
    if (!cursor) return undefined;

    const op = direction === 'desc' ? 'lt' : 'gt';
    const at: Date | number = kind === 'number' ? Number(cursor.c) : new Date(cursor.c);

    return {
        OR: [{ [field]: { [op]: at } }, { [field]: at, id: { [op]: cursor.i } }],
    };
}

/** `[field, id]` ordering — always include the id or the keyset has no stable tiebreak. */
export const cursorOrderBy = (field: string, direction: 'asc' | 'desc' = 'desc') => [
    { [field]: direction },
    { id: direction },
];

/** Clamped page size. The client asks for 15; anything past 50 is a scraper, not a phone. */
export const cursorLimit = (limit: number | undefined, fallback = 15): number =>
    Math.min(Math.max(Number(limit) || fallback, 1), 50);

/**
 * Turns an over-fetched row set into a page. Always query `limit + 1` rows: the extra row is
 * how you know another page exists WITHOUT a second COUNT query.
 */
export function toCursorPage<T, R>(
    rows: R[],
    limit: number,
    field: keyof R,
    map: (row: R) => T,
): CursorPage<T> {
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);

    return {
        items: page.map(map),
        nextCursor:
            hasMore && last
                ? encodeCursor(last[field] as unknown as Date | number, (last as unknown as { id: string }).id)
                : null,
    };
}
