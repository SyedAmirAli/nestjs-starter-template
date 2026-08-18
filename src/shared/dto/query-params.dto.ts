/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

/**
 * Parse a query string into a tri-state boolean. Returns undefined for absent/blank so a
 * filter can mean "both". Kept separate from `toBoolean` (which defaults unknown → its
 * fallback) because a filter must not silently turn an unrecognized value into a match.
 */
const toTriBoolean = (value: unknown): boolean | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    const v = String(value as any).toLowerCase();
    if (['true', '1', 'yes', 'active', 'on', 'enable', 'enabled'].includes(v)) return true;
    if (['false', '0', 'no', 'inactive', 'off', 'disable', 'disabled'].includes(v)) return false;
    return undefined;
};

const toNumber = (value: unknown, fallback?: number): number | undefined => {
    if (value === undefined || value === null || value === '') return fallback;
    const num = Number(value);
    return Number.isNaN(num) ? fallback : num;
};

const toBoolean = (value: unknown, fallback = true): boolean => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    return ['true', '1', 'yes', 'active', 'on', 'enable', 'enabled'].includes(
        String(value as unknown as string).toLowerCase(),
    );
};

const toObject = (value: unknown): Record<string, any> => {
    if (!value) return {};

    if (typeof value === 'object') {
        return value as Record<string, any>;
    }

    if (typeof value === 'string') {
        try {
            return JSON.parse(value) as Record<string, any>;
        } catch {
            return value
                .split(',')
                .map((item: string) => item.trim())
                .filter(Boolean)
                .reduce<Record<string, true>>((acc, key) => {
                    acc[key] = true;
                    return acc;
                }, {});
        }
    }

    return {};
};

export class QueryParamsDto {
    @ApiPropertyOptional({
        description: 'Current page number for pagination.',
        example: 1,
        default: 1,
        minimum: 1,
    })
    @Transform(({ value }) => toNumber(value, 1))
    @IsOptional()
    @IsInt()
    @Min(1)
    page = 1;

    @ApiPropertyOptional({
        description: 'Number of records per page.',
        example: 10,
        default: 10,
        minimum: 1,
    })
    @Transform(({ value }) => toNumber(value, 10))
    @IsOptional()
    @IsInt()
    @Min(1)
    limit = 10;

    @ApiPropertyOptional({
        description:
            'Opaque keyset cursor for cursor-paginated endpoints (the feed and notifications). ' +
            'Base64 of { c, i } — echo back the `nextCursor` from the previous page verbatim. ' +
            'Ignored by offset-paginated routes.',
        example: 'eyJjIjoiMjAyNi0wNy0yNlQxMTowMDowMFoiLCJpIjoicF84MjEifQ==',
        nullable: true,
    })
    // Declared HERE, on the shared DTO, rather than on a feed-specific query DTO: the global
    // pipe runs with `forbidNonWhitelisted: true`, so an undeclared `?cursor=` is a 400. See
    // .agents/project-conventions.md — feed routes still take QueryParamsDto, they just call
    // paginateCursor() instead of paginate().
    @Transform(({ value }) => (value as string) || null)
    @IsOptional()
    @IsString()
    cursor: string | null = null;

    @ApiPropertyOptional({
        description: 'Database field name used for sorting.',
        example: 'createdAt',
        default: 'createdAt',
    })
    @IsOptional()
    @IsString()
    orderBy = 'createdAt';

    @ApiPropertyOptional({
        description: 'Sorting direction.',
        enum: ['asc', 'desc'],
        example: 'desc',
        default: 'desc',
    })
    @Transform(({ value }) => String(value || 'desc').toLowerCase())
    @IsOptional()
    @IsIn(['asc', 'desc'])
    order: 'asc' | 'desc' = 'desc';

    @ApiPropertyOptional({
        description: 'Search keyword. If q is provided, q can be used as fallback search text.',
        example: 'rice',
    })
    @Transform(({ value, obj }) => (value as string) || (obj.q as string) || '')
    @IsOptional()
    @IsString()
    search = '';

    @ApiPropertyOptional({
        description: 'Alternative search keyword.',
        example: 'rice',
    })
    @Transform(({ value, obj }) => (value as string) || (obj.search as string) || '')
    @IsOptional()
    @IsString()
    q?: string;

    @ApiPropertyOptional({
        description:
            'Filter by active status. Accepts true, false, 1, 0, yes, active. Omit to return both active and inactive.',
        example: true,
    })
    // `@Type(() => String)` is load-bearing: the global pipe has enableImplicitConversion,
    // which would coerce the raw "false" to `true` (non-empty string) BEFORE this @Transform
    // runs. Forcing the reflected type to String makes that coercion a no-op, so the transform
    // receives the real "false"/"true" and parses it correctly.
    @Transform(({ value }) => toTriBoolean(value))
    @Type(() => String)
    @IsOptional()
    @IsBoolean()
    active?: boolean;

    @ApiPropertyOptional({
        description: 'Enable or disable pagination. Accepts true, false, 1, 0.',
        example: true,
        default: true,
    })
    // Same enableImplicitConversion trap as `active` — @Type(() => String) keeps "false"
    // from being coerced to true before the transform parses it.
    @Transform(({ value }) => toBoolean(value, true))
    @Type(() => String)
    @IsOptional()
    @IsBoolean()
    paginate = true;

    @ApiPropertyOptional({
        description: 'Fields to select. Accepts comma-separated string or JSON object.',
        examples: {
            comma: { value: 'id,name,email' },
            json: { value: '{"id":true,"name":true}' },
        },
    })
    @Transform(({ value }) => toObject(value))
    @IsOptional()
    select: Record<string, any> = {};

    @ApiPropertyOptional({
        description: 'Relations to include. Accepts comma-separated string or JSON object.',
        examples: {
            comma: { value: 'user,category' },
            json: { value: '{"user":true,"category":true}' },
        },
    })
    @Transform(({ value }) => toObject(value))
    @IsOptional()
    include: Record<string, any> = {};

    @ApiPropertyOptional({
        description: 'Base URL used for pagination links or metadata.',
        example: 'https://api.example.com/products',
        nullable: true,
    })
    @Transform(({ value }) => value as string | null)
    @IsOptional()
    @IsString()
    baseUrl: string | null = null;

    @ApiPropertyOptional({
        description: 'Page name used for custom pagination or frontend metadata.',
        example: 'products',
        nullable: true,
    })
    @Transform(({ value }) => value as string | null)
    @IsOptional()
    @IsString()
    pageName: string | null = null;

    @ApiPropertyOptional({
        description: 'Filter records by user ID.',
        example: 'clx123abc',
        nullable: true,
    })
    @Transform(({ value }) => value as string | null)
    @IsOptional()
    @IsString()
    userId: string | null = null;

    @ApiPropertyOptional({
        description: 'Generic type filter. Can be number or string depending on module.',
        example: 1,
        nullable: true,
    })
    @Transform(({ value }) => value as number | string | null)
    @IsOptional()
    type: number | string | null = null;

    @ApiPropertyOptional({
        description: 'Start date filter. Recommended format: YYYY-MM-DD.',
        example: '2026-07-01',
        nullable: true,
    })
    @Transform(({ value }) => value as string | null)
    @IsOptional()
    @IsString()
    fromDate: string | null = null;

    @ApiPropertyOptional({
        description: 'End date filter. Recommended format: YYYY-MM-DD.',
        example: '2026-07-31',
        nullable: true,
    })
    @Transform(({ value }) => value as string | null)
    @IsOptional()
    @IsString()
    toDate: string | null = null;

    @ApiPropertyOptional({
        description: 'Filter by publisher UUID (source documents).',
        example: '019f34fa-8498-7594-a20a-f0603a8c468a',
        nullable: true,
    })
    @Transform(({ value }) => value as string | null)
    @IsOptional()
    @IsUUID('all')
    publisherId: string | null = null;

    @ApiPropertyOptional({
        description: 'Filter by coupon UUID (redemption history).',
        example: '019f34fa-8498-7594-a20a-f0603a8c468a',
        nullable: true,
    })
    @Transform(({ value }) => value as string | null)
    @IsOptional()
    @IsUUID('all')
    couponId: string | null = null;

    @ApiPropertyOptional({
        description: 'Filter by marketplace store UUID (admin product/order listings).',
        example: '019f34fa-8498-7594-a20a-f0603a8c468a',
        nullable: true,
    })
    @Transform(({ value }) => value as string | null)
    @IsOptional()
    @IsUUID('all')
    storeId: string | null = null;

    @ApiPropertyOptional({
        description: 'Filter by editorial status (e.g. DRAFT, ACTIVE for source documents).',
        example: 'DRAFT',
        nullable: true,
    })
    @Transform(({ value }) => value as string | null)
    @IsOptional()
    @IsString()
    status: string | null = null;

    @ApiPropertyOptional({
        description: 'Filter publishers by authority tier (TIER_A, TIER_B, TIER_C).',
        example: 'TIER_A',
        nullable: true,
    })
    @Transform(({ value }) => value as string | null)
    @IsOptional()
    @IsString()
    sourceTier: string | null = null;

    @ApiPropertyOptional({
        description: 'Filter users by role (CUSTOMER, ADMIN).',
        example: 'ADMIN',
        nullable: true,
    })
    @Transform(({ value }) => value as string | null)
    @IsOptional()
    @IsString()
    role: string | null = null;

    @ApiPropertyOptional({
        description: 'Filter by resource name (audit logs), e.g. publisher, sourceDocument, cache.',
        example: 'publisher',
        nullable: true,
    })
    @Transform(({ value }) => value as string | null)
    @IsOptional()
    @IsString()
    resource: string | null = null;

    @ApiPropertyOptional({
        description: 'Filter by audit action (CREATE, UPDATE, DELETE, …).',
        example: 'DELETE',
        nullable: true,
    })
    @Transform(({ value }) => value as string | null)
    @IsOptional()
    @IsString()
    action: string | null = null;

    @ApiPropertyOptional({
        description: 'Filter by resource id (audit logs).',
        example: '019f34fa-8498-7594-a20a-f0603a8c468a',
        nullable: true,
    })
    @Transform(({ value }) => value as string | null)
    @IsOptional()
    @IsString()
    resourceId: string | null = null;

    // items
    @ApiPropertyOptional({
        description: 'Filter by items. Accepts comma-separated string array.',
        example: ['id', 'name', 'email'],
        nullable: true,
    })
    @Transform(({ value }) => {
        if (value === undefined || value === null || value === '') return [];
        // Already an array (e.g. ?items=a&items=b) — trim entries.
        if (Array.isArray(value)) {
            return value
                .flatMap((v) => String(v).split(','))
                .map((item) => item.trim())
                .filter(Boolean);
        }
        // Comma-separated string: ?items=en,bn,ar — must stay a flat string[], not [[...]].
        return String(value)
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    })
    @IsOptional()
    @IsArray()
    items: string[] = [];

    // ---- Crop knowledge (Phase 17) -------------------------------------------------------
    // These live here, not on a module DTO: the global pipe runs `forbidNonWhitelisted`, so a
    // param it does not know about is a 400 rather than an ignored extra.

    @ApiPropertyOptional({
        description:
            'Language for translated content, ISO 639-1. Falls back per field to the row’s own ' +
            'default-language column, so a partial translation still renders.',
        example: 'bn',
        nullable: true,
    })
    @Transform(({ value }) => (value ? String(value).toLowerCase().trim() : null))
    @IsOptional()
    @IsString()
    lang: string | null = null;

    @ApiPropertyOptional({
        description: 'Filter crops by category id or slug, e.g. vegetable.',
        example: 'vegetable',
        nullable: true,
    })
    @Transform(({ value }) => (value ? String(value).trim() : null))
    @IsOptional()
    @IsString()
    category: string | null = null;

    @ApiPropertyOptional({
        description: 'Filter varieties by cultivation season, e.g. Rabi.',
        example: 'Rabi',
        nullable: true,
    })
    @Transform(({ value }) => (value ? String(value).trim() : null))
    @IsOptional()
    @IsString()
    season: string | null = null;

    @ApiPropertyOptional({
        description: 'Filter by crop id or slug.',
        example: 'rice',
        nullable: true,
    })
    @Transform(({ value }) => (value ? String(value).trim() : null))
    @IsOptional()
    @IsString()
    crop: string | null = null;

    // ---- Marketplace product list/search filters --------------------------------------

    @ApiPropertyOptional({ description: 'Minimum price, whole currency units (e.g. taka, not poisha).', example: 100, nullable: true })
    @Transform(({ value }) => toNumber(value))
    @IsOptional()
    priceMin?: number;

    @ApiPropertyOptional({ description: 'Maximum price, whole currency units (e.g. taka, not poisha).', example: 5000, nullable: true })
    @Transform(({ value }) => toNumber(value))
    @IsOptional()
    priceMax?: number;

    @ApiPropertyOptional({
        description: 'Filter by derived stock availability.',
        enum: ['in_stock', 'limited', 'sold_out', 'pre_order', 'unavailable'],
        nullable: true,
    })
    @Transform(({ value }) => (value ? String(value).trim() : null))
    @IsOptional()
    @IsString()
    availability: string | null = null;

    @ApiPropertyOptional({ description: 'true = only products currently discounted (originalPriceAmount set).', example: true, nullable: true })
    @Transform(({ value }) => toTriBoolean(value))
    @Type(() => String)
    @IsOptional()
    @IsBoolean()
    discount?: boolean;

    @ApiPropertyOptional({
        description: 'Result ordering for product list/search.',
        enum: ['latest', 'popular', 'price_asc', 'price_desc', 'best_selling'],
        default: 'latest',
        nullable: true,
    })
    @Transform(({ value }) => (value ? String(value).trim() : null))
    @IsOptional()
    @IsString()
    sort: string | null = null;

    @ApiPropertyOptional({
        description: 'Brand filter — accepted for forward-compatibility with the mobile contract; ' +
            'not yet backed by a schema column (brand lives in the free-form `specs` JSON today), so this is currently a no-op.',
        example: 'ACI',
        nullable: true,
    })
    @Transform(({ value }) => (value ? String(value).trim() : null))
    @IsOptional()
    @IsString()
    brand: string | null = null;

    @ApiPropertyOptional({
        description: 'Location filter — accepted for forward-compatibility with the mobile contract; ' +
            'not yet backed by a schema column on products (only stores have `location`), so this is currently a no-op.',
        example: 'Bogura',
        nullable: true,
    })
    @Transform(({ value }) => (value ? String(value).trim() : null))
    @IsOptional()
    @IsString()
    location: string | null = null;
}
