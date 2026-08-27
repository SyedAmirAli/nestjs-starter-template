import { useMemo, useState } from 'react';
import { listDefaults, type ListSearch } from './listQuery';

export interface ClientListOptions<T> {
    /** Fields the search box matches against (case-insensitive `contains`). */
    searchFields?: Array<keyof T>;
    /** Initial sort/paging, same shape the URL would carry. */
    initial?: ListSearch;
    /**
     * Sort value for a column key, when the raw field isn't directly comparable
     * (a nested count, a date string, an enum you want ordered by pipeline stage).
     */
    sortValue?: (row: T, orderBy: string) => string | number | undefined;
}

/**
 * Drives `ListTable` from an array already in memory, matching the props a server-paginated
 * route supplies. For collections that arrive embedded in a parent payload (e.g. a document's
 * versions) — no endpoint, no URL state, so it never collides with the page's own search params.
 *
 * Same-shape contract as the server path: if a collection outgrows this, swap in a real
 * paginated endpoint and the table markup stays untouched.
 */
export function useClientList<T extends object>(rows: Array<T>, options: ClientListOptions<T> = {}) {
    const { searchFields = [], initial, sortValue } = options;
    const [search, setSearch] = useState<ListSearch>(initial ?? {});
    const applied = listDefaults(search);

    const filtered = useMemo(() => {
        const q = search.search?.trim().toLowerCase();
        if (!q || !searchFields.length) return rows;
        return rows.filter((row) =>
            searchFields.some((f) => {
                const v = row[f];
                return v != null && String(v).toLowerCase().includes(q);
            }),
        );
    }, [rows, search.search, searchFields]);

    const { orderBy, order, limit, page } = applied;

    const sorted = useMemo(() => {
        if (!orderBy) return filtered;
        const dir = order === 'asc' ? 1 : -1;
        const valueOf = (row: T) =>
            sortValue?.(row, orderBy) ?? (row[orderBy as keyof T] as string | number | undefined);

        // Copy first — Array.sort mutates, and `rows` may be cache data owned elsewhere.
        return [...filtered].sort((a, b) => {
            const av = valueOf(a);
            const bv = valueOf(b);
            // Missing values sort last regardless of direction.
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
            return String(av).localeCompare(String(bv)) * dir;
        });
    }, [filtered, orderBy, order, sortValue]);

    const total = sorted.length;
    // Filtering can strand the view past the last page.
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const currentPage = Math.min(page, totalPages);

    const paged = useMemo(
        () => sorted.slice((currentPage - 1) * limit, currentPage * limit),
        [sorted, currentPage, limit],
    );

    return {
        rows: paged,
        total,
        currentPage,
        perPage: limit,
        search,
        onSearchChange: (next: Partial<ListSearch>) => setSearch((prev) => ({ ...prev, ...next })),
    };
}
