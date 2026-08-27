/**
 * Generic list-route query state: page/limit/sort/search, all optional so a bare
 * `/users` link is valid and the URL only carries what differs from the defaults.
 * Extend this per-route by intersecting: `type UsersSearch = ListSearch & { role?: UserRole }`.
 */
export interface ListSearch {
    page?: number;
    limit?: number;
    orderBy?: string;
    order?: 'asc' | 'desc';
    search?: string;
    /** Generic active/inactive filter — omit the field entirely on routes that don't have one. */
    active?: boolean;
    /** Inclusive lower/upper bound on a route-chosen date field. ISO-8601. */
    fromDate?: string;
    toDate?: string;
}

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 10;
export const DEFAULT_ORDER_BY = 'createdAt';
export const DEFAULT_ORDER: 'asc' | 'desc' = 'desc';

/** Resolve a ListSearch to concrete values for rendering the table. */
export const listDefaults = (s: ListSearch) => ({
    page: s.page ?? DEFAULT_PAGE,
    limit: s.limit ?? DEFAULT_LIMIT,
    orderBy: s.orderBy ?? DEFAULT_ORDER_BY,
    order: s.order ?? DEFAULT_ORDER,
});

const num = (v: unknown, min = 1): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min ? Math.floor(n) : undefined;
};

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined);

/**
 * Validates URL search params for a list route. Keeps the URL as the source of truth for
 * pagination/sort/filters, so a refresh or a shared link reproduces the same view. Extend the
 * returned object per-route for extra filter keys — see the ListSearch doc comment.
 */
export const validateListSearch = (search: Record<string, unknown>): ListSearch => {
    const out: ListSearch = {};

    const page = num(search.page);
    if (page && page !== DEFAULT_PAGE) out.page = page;

    const limit = num(search.limit);
    if (limit && limit !== DEFAULT_LIMIT) out.limit = limit;

    const orderBy = str(search.orderBy);
    if (orderBy && orderBy !== DEFAULT_ORDER_BY) out.orderBy = orderBy;

    if (search.order === 'asc') out.order = 'asc';
    else if (search.order === 'desc') out.order = 'desc';

    const q = str(search.search);
    if (q) out.search = q;

    if (search.active === true || search.active === 'true') out.active = true;
    else if (search.active === false || search.active === 'false') out.active = false;

    const fromDate = str(search.fromDate);
    if (fromDate) out.fromDate = fromDate;

    const toDate = str(search.toDate);
    if (toDate) out.toDate = toDate;

    return out;
};

/** ListSearch -> API query params, with defaults applied. */
export const toApiParams = (s: ListSearch): Record<string, string | number | boolean> => {
    const d = listDefaults(s);
    const p: Record<string, string | number | boolean> = {
        page: d.page,
        limit: d.limit,
        orderBy: d.orderBy,
        order: d.order,
    };
    if (s.search) p.search = s.search;
    if (typeof s.active === 'boolean') p.active = s.active;
    if (s.fromDate) p.fromDate = s.fromDate;
    if (s.toDate) p.toDate = s.toDate;
    return p;
};

/**
 * Turns a route's `useNavigate()` into the `onSearchChange` patcher `ListTable` wants —
 * `{ search: (prev) => ({ ...prev, ...next }), replace: true }` is the same three lines on
 * every list route, so it lives here once. Call it directly in the route file (not from a
 * shared page component): TanStack types `useNavigate` against a *literal* route path, and
 * importing it into shared code would widen that type to `string`, losing the search param
 * types along with it.
 *
 *   const patch = makeSearchPatcher(useNavigate({ from: Route.fullPath }))
 */
export function makeSearchPatcher<S extends ListSearch>(
    navigate: (opts: { search: (prev: S) => S; replace: boolean }) => void,
): (next: Partial<S>) => void {
    return (next) => navigate({ search: (prev) => ({ ...prev, ...next }), replace: true });
}
