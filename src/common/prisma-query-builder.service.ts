/* eslint-disable @typescript-eslint/no-unsafe-function-type */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import { Logger } from '@nestjs/common';
import { plainToInstance, ClassConstructor } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service';

interface SearchRelationConfig {
    columns: string[];
    type?: 'some' | 'every' | 'direct';
}

type SearchRelations = Record<string, string[] | SearchRelationConfig>;

/** `contains` → LIKE '%x%' (fuzzy, non-sargable); `startsWith` → LIKE 'x%' (index-friendly). */
export type SearchMode = 'contains' | 'startsWith';

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

/** Clamp a user-supplied page size into a safe range so a client can't request a huge page. */
function clampLimit(limit: number | string | null | undefined): number {
    const n = Number(limit);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_PAGE_SIZE;
    return Math.min(Math.floor(n), MAX_PAGE_SIZE);
}

/** Parse common truthy representations into a boolean. */
function parseBool(value: unknown): boolean {
    return value === true || value === 1 || value === '1' || value === 'true' || value === 'True' || value === 'TRUE';
}

/** Single source of truth for operator → Prisma filter mapping. */
function buildOperatorCondition(operator: any, value: any): any {
    switch (operator) {
        case '=':
            return value;
        case '!=':
            return { not: value };
        case '>':
            return { gt: value };
        case '>=':
            return { gte: value };
        case '<':
            return { lt: value };
        case '<=':
            return { lte: value };
        case 'in':
            return { in: value };
        case 'not in':
            return { notIn: value };
        case 'like': {
            const v = typeof value === 'string' ? value.replace(/^%+|%+$/g, '') : value;
            return { contains: v };
        }
        default:
            return value;
    }
}

/**
 * Build a fuzzy-search condition: tokens are AND-ed, each token must match at least
 * one column/relation (OR). Returns null when the query is empty.
 */
function buildSearchCondition(
    query: string,
    columns: string[],
    relations?: SearchRelations,
    mode: SearchMode = 'contains',
): any {
    if (!query || !query.trim()) return null;

    const sanitized = query.trim().replace(/^%+|%+$/g, '');
    if (!sanitized) return null;

    const tokens = sanitized.split(/\s+/).filter(Boolean);

    const tokenConditions = tokens.map((token) => {
        const match = { [mode]: token };
        const orConditions: any[] = columns.map((col) => ({ [col]: match }));

        if (relations) {
            for (const [relation, config] of Object.entries(relations)) {
                const cols = Array.isArray(config) ? config : config.columns;
                const relType = Array.isArray(config) ? 'some' : config.type || 'some';

                for (const col of cols) {
                    const colFilter = { [col]: match };
                    orConditions.push(
                        relType === 'direct' ? { [relation]: colFilter } : { [relation]: { [relType]: colFilter } },
                    );
                }
            }
        }

        return { OR: orConditions };
    });

    return tokenConditions.length === 1 ? tokenConditions[0] : { AND: tokenConditions };
}

// Helper class for building nested where conditions
class WhereBuilder {
    private conditions: any[] = [];
    public logicalOperator: 'AND' | 'OR' = 'AND';

    isTrue(param: any = null) {
        return parseBool(param);
    }

    where(field: string | ((subQuery: WhereBuilder) => void), operator?: any, value?: any): this {
        if (typeof field === 'function') {
            const subQuery = new WhereBuilder();
            field(subQuery);
            const groupedConditions = subQuery.build();
            if (Object.keys(groupedConditions).length > 0) {
                this.conditions.push(groupedConditions);
            }
            return this;
        }

        let condition: any;
        if (arguments.length === 2) {
            condition = { [field]: operator };
        } else {
            condition = {
                [field]: this.buildCondition(operator, value),
            };
        }

        this.conditions.push(condition);
        return this;
    }

    whereActive(value?: boolean | string, field: string = 'isActive'): this {
        if (typeof value === 'undefined') return this;
        return this.where(field, this.isTrue(value));
    }

    orWhere(field: string | ((subQuery: WhereBuilder) => void), operator?: any, value?: any): this {
        this.logicalOperator = 'OR';
        return this.where(field, operator, value);
    }

    whereNull(field: string): this {
        this.conditions.push({ [field]: null });
        return this;
    }

    whereNotNull(field: string): this {
        this.conditions.push({ [field]: { not: null } });
        return this;
    }

    whereIn(field: string, values: any[]): this {
        this.conditions.push({ [field]: { in: values } });
        return this;
    }

    whereNotIn(field: string, values: any[]): this {
        this.conditions.push({ [field]: { notIn: values } });
        return this;
    }

    whereHas(relation: string, callback?: (subQuery: WhereBuilder) => void): this {
        if (callback) {
            const subQuery = new WhereBuilder();
            callback(subQuery);
            const relationConditions = subQuery.build();
            this.conditions.push({
                [relation]: relationConditions,
            });
        } else {
            this.conditions.push({
                [relation]: { isNot: null },
            });
        }
        return this;
    }

    orWhereHas(relation: string, callback?: (subQuery: WhereBuilder) => void): this {
        this.logicalOperator = 'OR';
        return this.whereHas(relation, callback);
    }

    search(query: string, columns: string[], relations?: SearchRelations, mode: SearchMode = 'contains'): this {
        const condition = buildSearchCondition(query, columns, relations, mode);
        if (condition) this.conditions.push(condition);
        return this;
    }

    private buildCondition(operator: any, value: any): any {
        return buildOperatorCondition(operator, value);
    }

    build(): any {
        if (this.conditions.length === 0) return {};

        if (this.conditions.length === 1) {
            return this.conditions[0];
        }

        return {
            [this.logicalOperator]: this.conditions,
        };
    }
}

/**
 * Laravel-style Prisma Query Builder
 *
 * Usage examples:
 *
 * Basic where:
 * query().where('name', 'John').where('age', '>', 18)
 *
 * Grouped conditions:
 * query().where(q => {
 *   q.where('name', 'John').orWhere('name', 'Jane')
 * })
 *
 * Relation queries:
 * query().whereHas('posts', q => {
 *   q.where('published', true)
 * })
 *
 * Fuzzy search:
 * query().search('john doe', ['name', 'email'])
 *
 * Fuzzy search with relation columns:
 * query().search('amir', ['name'], {
 *   posts: ['title', 'body'],
 *   profile: { columns: ['bio'], type: 'direct' },
 * })
 */
// NOTE: stateful, per-query builder — always create a fresh instance via `create()`
// (NOT a shared DI singleton, or concurrent requests would corrupt each other's state).

/**
 * The names of the Prisma models this builder can be pointed at.
 *
 * An allowlist derived from the shape of each member, not a blocklist of client internals.
 * The blocklist version of this was wrong in both directions: it had to be extended by hand
 * every time Prisma added a `$`-method, and it still admitted PrismaService's own
 * `onModuleInit` / `queryBuilder` as if they were models — `create(prisma, 'onModuleInit')`
 * typechecked and failed at runtime. Selecting on "has a findMany" makes exactly the model
 * delegates assignable and nothing else.
 */
export type Model = {
    [K in keyof PrismaService]: PrismaService[K] extends { findMany: (...args: any) => any } ? K : never;
}[keyof PrismaService];

/**
 * The delegate surface this builder actually uses, described structurally.
 *
 * Deliberately NOT one of the generated `<Model>Delegate` types. Picking an arbitrary model's
 * delegate to stand for "any delegate" compiles, but couples every query in the app to that
 * one model continuing to exist — rename or drop it and this file stops compiling for reasons
 * that have nothing to do with it. Three methods is the whole contract; state it directly.
 *
 * `any` on the arguments is load-bearing rather than lazy: each generated delegate has its
 * own mutually-incompatible `where`/`orderBy`/`select` argument types, and the builder is
 * generic over all of them by construction. Type safety for callers comes from the `<T>`
 * parameter on the builder itself, which is what `create<Resume>(...)` narrows.
 */
export type PrismaModel = {
    findMany: (args?: any) => Promise<any[]>;
    findFirst: (args?: any) => Promise<any>;
    count: (args?: any) => Promise<number>;
};

/**
 * An orderable column. `keyof T` drives autocomplete when the builder is created with a
 * model type (`create<Publisher>`), while `string & {}` keeps a runtime `?orderBy=` value
 * assignable — every list service forwards one straight from QueryParamsDto, and widening
 * those to `keyof T` would only buy casts. The real guard is runtime; see orderableFields().
 */
export type OrderableField<T> = (keyof T & string) | (string & {});

/** The slice of Prisma's internal `_runtimeDataModel` that orderableFields() reads. */
type RuntimeDataModel = {
    models?: Record<string, { fields?: Array<{ name: string; kind: string }> }>;
};

/**
 * Columns a model can actually be ordered by, cached per model.
 *
 * `orderBy` arrives as a client-supplied string (`?orderBy=`), and Prisma throws a
 * PrismaClientValidationError — surfacing as a 500 — on any name the model doesn't have.
 * That is reachable on every list endpoint: `QueryParamsDto` defaults `orderBy` to
 * `createdAt`, but `TreatmentStepIngredient` (a join table) has no timestamps at all, so
 * even a plain page load crashed.
 *
 * `_runtimeDataModel` is internal to Prisma, so a `null` return means "can't tell" and
 * callers must leave the field untouched — a rename in a future Prisma release then
 * degrades to today's behaviour instead of breaking every query. Delegates are camelCase;
 * the datamodel is keyed by PascalCase model name.
 */
const orderableCache = new Map<string, Set<string> | null>();

/** Module-level: the builder is per-query, so a per-instance logger would churn. */
const logger = new Logger('PrismaQueryBuilder');

function orderableFields(prisma: PrismaService, modelName: string): Set<string> | null {
    const cached = orderableCache.get(modelName);
    if (cached !== undefined) return cached;

    const key = modelName.charAt(0).toUpperCase() + modelName.slice(1);
    const datamodel = (prisma as unknown as { _runtimeDataModel?: RuntimeDataModel })._runtimeDataModel;
    const fields = datamodel?.models?.[key]?.fields;

    // Scalars and enums are sortable; relation fields (kind 'object') are not.
    const result = fields
        ? new Set(fields.filter((f) => f.kind === 'scalar' || f.kind === 'enum').map((f) => f.name))
        : null;

    orderableCache.set(modelName, result);
    return result;
}

export default class PrismaQueryBuilder<T = any> {
    private model: PrismaModel;
    private whereConditions: any = {};
    private orderByConditions: any[] = [];
    private selectFields: any = undefined;
    private includeRelations: any = undefined;

    /** Kept for orderBy validation — the delegate itself doesn't expose its model name. */
    private readonly modelName: Model;

    constructor(
        private prisma: PrismaService,
        modelName: Model,
    ) {
        this.model = this.prisma[modelName] as PrismaModel;
        this.modelName = modelName;
    }

    // Static factory method to create builder instances
    static create<T>(prisma: PrismaService, modelName: Model): PrismaQueryBuilder<T> {
        return new PrismaQueryBuilder<T>(prisma, modelName);
    }

    // Add where conditions
    where(field: keyof T | ((subQuery: WhereBuilder) => void), operator?: any, value?: any): this {
        // Handle callback function (Laravel-style grouped conditions)
        if (typeof field === 'function') {
            const subQuery = new WhereBuilder();
            field(subQuery);
            const groupedConditions = subQuery.build();

            if (Object.keys(groupedConditions).length > 0) {
                // If we already have conditions, wrap them in AND
                if (Object.keys(this.whereConditions).length > 0) {
                    const currentConditions = { ...this.whereConditions };
                    this.whereConditions = {
                        AND: [currentConditions, groupedConditions],
                    };
                } else {
                    this.whereConditions = groupedConditions;
                }
            }
            return this;
        }

        // Handle regular where conditions
        if (arguments.length === 2) {
            // where(field, value)
            this.addWhereCondition(field as string, operator);
        } else if (arguments.length === 3) {
            // where(field, operator, value)
            this.addWhereCondition(field as string, operator, value);
        }
        return this;
    }

    // Helper method to add individual where conditions
    private addWhereCondition(field: string, operator: any, value?: any): void {
        // where(field, value) → 2 args; where(field, operator, value) → 3 args
        this.whereConditions[field as string] =
            arguments.length === 2 ? operator : buildOperatorCondition(operator, value);
    }

    // Laravel-style orWhere method
    orWhere(field: keyof T | ((subQuery: WhereBuilder) => void), operator?: any, value?: any): this {
        if (typeof field === 'function') {
            const subQuery = new WhereBuilder();
            subQuery.logicalOperator = 'OR';
            field(subQuery);
            const groupedConditions = subQuery.build();

            if (Object.keys(groupedConditions).length > 0) {
                if (Object.keys(this.whereConditions).length > 0) {
                    const currentConditions = { ...this.whereConditions };
                    this.whereConditions = {
                        OR: [currentConditions, groupedConditions],
                    };
                } else {
                    this.whereConditions = groupedConditions;
                }
            }
            return this;
        }

        // Handle regular orWhere conditions by wrapping in OR
        let condition: any;
        if (arguments.length === 2) {
            condition = { [field as string]: operator };
        } else {
            condition = {
                [field as string]: this.buildCondition(operator, value),
            };
        }

        if (Object.keys(this.whereConditions).length > 0) {
            const currentConditions = { ...this.whereConditions };
            this.whereConditions = {
                OR: [currentConditions, condition],
            };
        } else {
            Object.assign(this.whereConditions, condition);
        }

        return this;
    }

    // Add multiple where conditions with object
    whereIn(field: keyof T, values: any[]): this {
        this.whereConditions[field] = { in: values };
        return this;
    }

    whereNotIn(field: keyof T, values: any[]): this {
        this.whereConditions[field] = { notIn: values };
        return this;
    }

    whereNull(field: keyof T): this {
        this.whereConditions[field] = null;
        return this;
    }

    whereNotNull(field: keyof T): this {
        this.whereConditions[field] = { not: null };
        return this;
    }

    whereActive(value?: boolean | string, field: string = 'isActive'): this {
        if (typeof value === 'undefined') return this;
        this.whereConditions[field] = parseBool(value);
        return this;
    }

    // Laravel-style whereHas for relations
    whereHas(relation: string, callback?: Function): this {
        if (callback) {
            const subQuery = new WhereBuilder();
            callback(subQuery);
            const relationConditions = subQuery.build();
            this.whereConditions[relation] = relationConditions;
        } else {
            this.whereConditions[relation] = { isNot: null };
        }
        return this;
    }

    // Laravel-style orWhereHas for relations
    orWhereHas(relation: string, callback?: Function): this {
        const relationCondition: any = {};

        if (callback) {
            const subQuery = new WhereBuilder();
            callback(subQuery);
            const relationConditions = subQuery.build();
            relationCondition[relation] = relationConditions;
        } else {
            relationCondition[relation] = { isNot: null };
        }

        if (Object.keys(this.whereConditions).length > 0) {
            const currentConditions = { ...this.whereConditions };
            this.whereConditions = {
                OR: [currentConditions, relationCondition],
            };
        } else {
            Object.assign(this.whereConditions, relationCondition);
        }

        return this;
    }

    /**
     * Fuzzy search across multiple columns and optional relations.
     *
     * Splits the search query into tokens and builds an AND of OR conditions
     * so every token must appear in at least one of the searched columns/relations.
     *
     * @example
     * // Search direct columns
     * query.search('john doe', ['name', 'email'])
     *
     * // Search with has-many relation (uses `some`)
     * query.search('amir', ['name'], { posts: ['title', 'body'] })
     *
     * // Search with has-one / belongs-to relation (uses direct nesting)
     * query.search('amir', ['name'], {
     *   profile: { columns: ['bio', 'address'], type: 'direct' },
     * })
     */
    search(query: string, columns: Array<keyof T>, relations?: SearchRelations, mode: SearchMode = 'contains'): this {
        const searchCondition = buildSearchCondition(query, columns as string[], relations, mode);
        if (!searchCondition) return this;

        if (Object.keys(this.whereConditions).length > 0) {
            this.whereConditions = { AND: [{ ...this.whereConditions }, searchCondition] };
        } else {
            this.whereConditions = searchCondition;
        }

        return this;
    }

    // Helper method for building condition objects
    private buildCondition(operator: any, value: any): any {
        return buildOperatorCondition(operator, value);
    }

    // Order by latest (descending)
    latest(field: OrderableField<T> = 'createdAt'): this {
        return this.orderBy(field, 'desc');
    }

    // Order by oldest (ascending)
    oldest(field: OrderableField<T> = 'createdAt'): this {
        return this.orderBy(field, 'asc');
    }

    /**
     * Order by a column, ignoring one the model doesn't have.
     *
     * Sorting is a display preference, so an unknown column falls back instead of throwing:
     * a caller listing rows should get rows, not a 500, because the default sort doesn't
     * apply to that model. `id` is the last resort — it's uuid(7), so it's time-ordered and
     * carries createdAt's intent while still guaranteeing a stable page order.
     */
    orderBy(field: OrderableField<T>, direction: OrderDirection = 'asc'): this {
        const resolved = this.resolveOrderField(String(field));
        if (resolved) this.orderByConditions.push({ [resolved]: direction });
        return this;
    }

    private resolveOrderField(field: string): string | null {
        // `Model` derives from `keyof PrismaService`, so it admits symbol keys in theory.
        const fields = orderableFields(this.prisma, String(this.modelName));
        // Introspection unavailable — pass through and let Prisma be the judge, as before.
        if (!fields || fields.has(field)) return field;

        const fallback = fields.has('createdAt') ? 'createdAt' : fields.has('id') ? 'id' : null;
        logger.warn(
            `${String(this.modelName)} has no column '${field}' to order by; ` +
                `${fallback ? `falling back to '${fallback}'` : 'leaving the query unordered'}.`,
        );
        return fallback;
    }

    // Select specific fields
    select(fields: any): this {
        if (!fields || typeof fields !== 'object') return this;

        const normalized: Record<string, any> = Array.isArray(fields)
            ? fields.reduce(
                  (acc, field) => {
                      acc[field] = true;
                      return acc as any;
                  },
                  {} as Record<string, boolean>,
              )
            : fields;

        // Ignore an empty select ({} / []) — Prisma rejects an empty `select`.
        if (Object.keys(normalized).length === 0) return this;

        this.selectFields = normalized;
        return this;
    }

    // Include relations
    with(relations: string[] | Record<string, any>): this {
        if (Array.isArray(relations)) {
            const relationObject: Record<string, boolean> = {};
            relations.forEach((relation) => {
                relationObject[relation] = true;
            });
            this.includeRelations = relationObject;
        } else {
            this.includeRelations = relations;
        }
        return this;
    }

    private buildWhere(): any {
        return Object.keys(this.whereConditions).length > 0 ? this.whereConditions : undefined;
    }

    private buildOrderBy(): any {
        return this.orderByConditions.length > 0 ? this.orderByConditions : undefined;
    }

    /** Apply select/include. Prisma forbids both at once, so merge include into select when both are set. */
    private applyShape(query: any): any {
        const hasSelect = this.selectFields && Object.keys(this.selectFields).length > 0;
        const hasInclude = this.includeRelations && Object.keys(this.includeRelations).length > 0;

        if (hasSelect) {
            query.select = hasInclude ? { ...this.selectFields, ...this.includeRelations } : this.selectFields;
        } else if (hasInclude) {
            query.include = this.includeRelations;
        }
        return query;
    }

    private toDto<DTO>(raw: any, dtoClass?: ClassConstructor<DTO>): any {
        if (!raw || !dtoClass) return raw;
        return plainToInstance(dtoClass, raw, { excludeExtraneousValues: true, enableImplicitConversion: true });
    }

    // Get all records without pagination
    async get<DTO = T>(dtoClass?: ClassConstructor<DTO>): Promise<DTO[]> {
        const query = this.applyShape({ where: this.buildWhere(), orderBy: this.buildOrderBy() });
        const rawResults = await this.model.findMany(query);
        return this.toDto(rawResults, dtoClass);
    }

    // Get first record (respects chained where/orderBy)
    async first<DTO = T>(dtoClass?: ClassConstructor<DTO>): Promise<DTO | null> {
        const query = this.applyShape({ where: this.buildWhere(), orderBy: this.buildOrderBy() });
        const rawResult = await this.model.findFirst(query);
        return this.toDto(rawResult, dtoClass);
    }

    // Find by ID (merges any chained where conditions, e.g. tenant scoping)
    async find<DTO = T>(id: string | number, dtoClass?: ClassConstructor<DTO>): Promise<DTO | null> {
        const query = this.applyShape({ where: { ...this.whereConditions, id } });
        const rawResult = await this.model.findFirst(query);
        return this.toDto(rawResult, dtoClass);
    }

    // Count records (ignores select/include — count never needs them)
    async count(): Promise<number> {
        return await this.model.count({ where: this.buildWhere() });
    }

    // Paginate results (Laravel-style)
    async paginate<DTO = T>({
        limit,
        columns,
        pageName,
        page,
        baseUrl,
        dtoClass,
    }: PaginateProps & {
        dtoClass?: ClassConstructor<DTO>;
    } = {}): Promise<PaginatedResult<DTO>> {
        if (!limit) limit = '10';
        if (!columns) columns = ['*'];
        if (!pageName) pageName = 'page';
        if (!page) page = '1';
        if (!baseUrl) baseUrl = 'http://localhost';

        const pageNumber = Math.max(1, Number(page) || 1);
        const limitNumber = clampLimit(limit);

        const skip = (pageNumber - 1) * limitNumber;

        // Handle select fields
        if (Array.isArray(columns) && columns[0] !== '*' && columns[0] !== '#') {
            this.selectFields = columns.reduce<Record<string, boolean>>(
                (acc: Record<string, boolean>, field: string) => {
                    acc[field] = true;
                    return acc;
                },
                {},
            );
        } else if (!Array.isArray(columns) && typeof columns === 'object' && Object.keys(columns).length > 0) {
            // A real Prisma `select` object was passed. Arrays like ['*'] / ['#'] are sentinels
            // (whole row) and must NOT become the select — that yields an invalid `select: ["*"]`.
            this.selectFields = columns;
        }

        const query = this.applyShape({
            where: this.buildWhere(),
            orderBy: this.buildOrderBy(),
            skip,
            take: limitNumber,
        });

        // Execute data + count in parallel
        const [rawData, total] = await Promise.all([this.model.findMany(query), this.count()]);

        const data = this.toDto(rawData, dtoClass);

        // Calculate pagination metadata
        const lastPage = Math.ceil(total / limitNumber);
        const from = skip + 1;
        const to = Math.min(skip + limitNumber, total);

        const buildUrl = (pageNum: number | null) => {
            if (pageNum === null) return null;

            // Build URL with current query parameters preserved
            const url = new URL(baseUrl);
            url.searchParams.set(pageName, pageNum.toString());

            // Add limit parameter if it's not the default
            if (limitNumber !== 10) {
                url.searchParams.set('limit', limitNumber.toString());
            }

            return url.toString();
        };

        // Build pagination links (Laravel-style)
        const links: PaginationLink[] = [
            {
                url: pageNumber > 1 ? buildUrl(pageNumber - 1) : null,
                label: '&laquo; Previous',
                active: false,
            },
        ];

        // Laravel-style pagination logic
        if (lastPage <= 7) {
            // If total pages is 7 or less, show all pages
            for (let i = 1; i <= lastPage; i++) {
                links.push({
                    url: buildUrl(i),
                    label: i.toString(),
                    active: i === pageNumber,
                });
            }
        } else {
            // Complex pagination for more than 7 pages
            // Always show first page
            links.push({
                url: buildUrl(1),
                label: '1',
                active: pageNumber === 1,
            });

            // Add ellipsis after first page if needed
            if (pageNumber > 4) {
                links.push({
                    url: null,
                    label: '...',
                    active: false,
                });
            }

            // Calculate the range around current page
            let start = Math.max(2, pageNumber - 1);
            let end = Math.min(lastPage - 1, pageNumber + 1);

            // Adjust the range to show at least 3 pages around current page if possible
            if (pageNumber <= 3) {
                // Near the beginning
                start = 2;
                end = Math.min(5, lastPage - 1);
            } else if (pageNumber >= lastPage - 2) {
                // Near the end
                start = Math.max(2, lastPage - 4);
                end = lastPage - 1;
            }

            // Add pages around current page (excluding first and last)
            for (let i = start; i <= end; i++) {
                links.push({
                    url: buildUrl(i),
                    label: i.toString(),
                    active: i === pageNumber,
                });
            }

            // Add ellipsis before last pages if there's a gap
            const gapToLastPages = lastPage - 2 - end; // Gap between end and start of last 3 pages
            if (gapToLastPages > 1) {
                links.push({
                    url: null,
                    label: '...',
                    active: false,
                });
            }

            // Show last 3 pages if there's enough space
            if (lastPage > 3) {
                const lastPagesStart = Math.max(end + 1, lastPage - 2);
                for (let i = lastPagesStart; i <= lastPage; i++) {
                    // Avoid duplicate pages
                    if (i > end) {
                        links.push({
                            url: buildUrl(i),
                            label: i.toString(),
                            active: i === pageNumber,
                        });
                    }
                }
            } else {
                // If lastPage <= 3, just show the remaining pages
                for (let i = Math.max(end + 1, 2); i <= lastPage; i++) {
                    links.push({
                        url: buildUrl(i),
                        label: i.toString(),
                        active: i === page,
                    });
                }
            }
        }

        links.push({
            url: pageNumber < lastPage ? buildUrl(pageNumber + 1) : null,
            label: 'Next &raquo;',
            active: false,
        });

        return {
            data,
            links,
            total,
            path: baseUrl,
            lastPage: lastPage,
            perPage: limitNumber,
            totalPages: lastPage,
            to: total > 0 ? to : 0,
            currentPage: pageNumber,
            firstPageUrl: buildUrl(1),
            currentTotal: data.length,
            from: total > 0 ? from : 0,
            lastPageUrl: buildUrl(lastPage),
            prevPageUrl: pageNumber > 1 ? buildUrl(pageNumber - 1) : null,
            nextPageUrl: pageNumber < lastPage ? buildUrl(pageNumber + 1) : null,
        };
    }

    // Simple paginate (without links)
    async simplePaginate<DTO = T>({
        limit = 10,
        columns = ['*'],
        pageName = 'page',
        page = 1,
        baseUrl = '',
        dtoClass,
    }: PaginateProps & {
        dtoClass?: ClassConstructor<DTO>;
    } = {}): Promise<SimplePaginatedResult<DTO>> {
        if (!limit) limit = 10;
        if (!columns) columns = ['*'];
        if (!pageName) pageName = 'page';
        if (!page) page = 1;
        if (!baseUrl) baseUrl = '';

        const pageNumber = Math.max(1, Number(page) || 1);
        const limitNumber = clampLimit(limit);

        const skip = (pageNumber - 1) * limitNumber;

        if (Array.isArray(columns) && columns[0] !== '*' && columns[0] !== '#') {
            this.selectFields = columns.reduce<Record<string, boolean>>(
                (acc: Record<string, boolean>, field: string) => {
                    acc[field] = true;
                    return acc;
                },
                {},
            );
        } else if (!Array.isArray(columns) && typeof columns === 'object' && Object.keys(columns).length > 0) {
            // A real Prisma `select` object was passed. Arrays like ['*'] / ['#'] are sentinels
            // (whole row) and must NOT become the select — that yields an invalid `select: ["*"]`.
            this.selectFields = columns;
        }

        const query = this.applyShape({
            where: this.buildWhere(),
            orderBy: this.buildOrderBy(),
            skip,
            take: limitNumber + 1, // one extra row to detect "has more" without a count
        });

        const rawResults = await this.model.findMany(query);
        const hasMore = rawResults.length > limitNumber;

        if (hasMore) {
            rawResults.pop(); // drop the probe record
        }

        const data = this.toDto(rawResults, dtoClass);

        return {
            data,
            hasMore,
            currentPage: pageNumber,
            perPage: limitNumber,
        };
    }

    // Reset query builder
    reset(): this {
        this.whereConditions = {};
        this.orderByConditions = [];
        this.selectFields = undefined;
        this.includeRelations = undefined;
        return this;
    }

    static parseParams(params: BasicQueryParams, defaults?: { orderBy?: string }): ParsedQueryParams {
        const page: number = Number(params?.page || 1);
        const limit: number = Number(params?.limit || 10);

        // default order is desc, make sure it's between asc and desc
        const order: SortDirection = (params?.order || 'desc').toLowerCase() === 'desc' ? 'desc' : 'asc';
        const orderBy: string = params?.orderBy || defaults?.orderBy || 'createdAt';

        const qSearch: string | null = params?.search || params?.q || null;
        const search: string = qSearch ? `%${qSearch.trim()}%` : '';

        const isBool = (value: any): boolean => BOOL.includes(value as bool);
        const active: boolean = isBool(params?.active);
        const paginate: boolean = isBool(params?.paginate);

        let select: Record<string, any> = {};
        if (params?.select && typeof params?.select === 'string') {
            try {
                select = JSON.parse(params.select);
            } catch {
                const selectStrings = params.select.split(',');
                selectStrings.forEach((s: string) => {
                    select[s.trim()] = true;
                });
            }
        }

        let include: Record<string, any> = {};
        if (params?.include && typeof params?.include === 'string') {
            try {
                include = JSON.parse(params.include);
            } catch {
                const includeStrings = params.include.split(',');
                includeStrings.forEach((s: string) => {
                    include[s.trim()] = true;
                });
            }
        }

        const fromDate: string | null = params?.fromDate || null;
        const toDate: string | null = params?.toDate || null;

        const baseUrl: string | null = params?.baseUrl || null;
        const pageName: string | null = params?.pageName || null;
        const userId: string | null = params?.userId || null;
        const type: number | string | null = params?.type || null;

        return {
            page,
            pageName,
            baseUrl,
            userId,
            type,
            fromDate,
            toDate,
            order,
            orderBy,
            search,
            active,
            paginate,
            select,
            include,
            limit,
        };
    }
}

/**
 * =========================================================================
 * Type Definitions
 * =========================================================================
 */

export const BOOL = [
    true,
    false,
    'true',
    'false',
    'TRUE',
    'FALSE',
    '0',
    '1',
    'on',
    'off',
    'ON',
    'OFF',
    'Yes',
    'No',
    'YES',
    'NO',
    0,
    1,
] as const;

export type SortDirection = 'asc' | 'desc' | 'ASC' | 'DESC';
export type bool = (typeof BOOL)[number];

export interface PaginatorOptions {
    page?: number;
    perPage?: number;
    pageName?: string;
    select?: string[];
}

export interface PaginatedResult<Model> {
    data: Array<Model>;
    currentPage: number;
    firstPageUrl: string | null;
    from: number;
    lastPage: number;
    lastPageUrl: string | null;
    links: Array<PaginationLink>;
    nextPageUrl: string | null;
    path: string;
    perPage: number;
    prevPageUrl: string | null;
    to: number;
    total: number;
    totalPages: number;
    currentTotal: number;
    categoryId?: string;
    subCategoryId?: string;
    gender?: 'male' | 'female';
}

export interface PaginationLink {
    url: string | null;
    label: string;
    active: boolean;
}

export type OrderDirection = 'asc' | 'desc';

export interface SimplePaginatedResult<Model> {
    data: Array<Model>;
    hasMore: boolean;
    currentPage: number;
    perPage: number;
}

export interface PaginateProps {
    limit?: number | string | null;
    columns?: any;
    pageName?: string | null;
    page?: number | string | null;
    baseUrl?: string | null;
}

export type BasicQueryParams = {
    page?: number;
    limit?: number;
    orderBy?: string;
    order?: string;
    pageName?: string;
    baseUrl?: string;
    search?: string;
    q?: string;
    select?: Array<string> | string;
    active?: boolean | string;
    paginate?: bool;
    include?: string;
    userId?: string;
    type?: number | string;
    fromDate?: string;
    toDate?: string;
};

export type ParsedQueryParams = {
    page: number;
    limit: number;
    order: 'asc' | 'desc';
    search: string;
    active: boolean;
    orderBy: string;
    select: Record<string, any>;
    include: Record<string, any>;
    paginate: boolean;
    fromDate: string | null;
    toDate: string | null;
    baseUrl: string | null;
    pageName: string | null;
    userId: string | null;
    type: number | string | null;
};
