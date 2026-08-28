import PrismaQueryBuilder from '@/common/prisma-query-builder.service';
import { Country, Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { QueryParamsDto } from '@/shared/dto/query-params.dto';
import { Injectable } from '@nestjs/common';
import { CountryType, Language, LanguageResult } from './countries';
import { ApiException } from '@/common/errors';
import { RedisService } from '@/shared/redis/redis.service';
import Aide from '@/helper/Aide';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Case-insensitive `equals` for a list of codes.
 *
 * Prisma's `in` has no `mode: 'insensitive'` — it compares byte-for-byte — so a caller
 * passing `bd` would silently miss the stored `BD`. An OR of insensitive `equals` is the
 * only way to accept `bd`, `BD` and `Bd` alike without trusting the column's casing.
 */
const codeMatchesAny = (field: 'code', codes: string[]): Prisma.CountryWhereInput[] =>
    codes.map((code) => ({ [field]: { equals: code, mode: 'insensitive' } }));

/**
 * Normalizes a caller-supplied code list: accepts an array or a comma-separated string,
 * trims, drops empties, and de-duplicates case-insensitively (`['bd','BD']` -> `['bd']`).
 */
const codeList = (value: unknown): string[] => {
    const seen = new Set<string>();
    return Aide.toArray<string>(value)
        .map((code) => String(code).trim())
        .filter((code) => {
            if (!code) return false;
            const key = code.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
};

/** Canonical cache-key fragment — `['BD','in']` and `['in','bd']` must be one cache entry. */
const codeKey = (codes: string[]): string =>
    codes.length
        ? codes
              .map((c) => c.toLowerCase())
              .sort()
              .join(',')
        : 'all';

@Injectable()
export class CountriesService {
    private readonly cache: RedisService;
    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
    ) {
        this.cache = this.redis.withPrefix('countries').withTtlMin(1440); // 1 day
    }

    get builder() {
        return new PrismaQueryBuilder<Country>(this.prisma, 'country');
    }

    async findAll(dto: QueryParamsDto): Promise<any> {
        const { page, limit, order, search, active, select, orderBy, baseUrl, items } = dto;

        // `items` is a country-code filter (?items=BD,in,Pk). Not `whereIn` — that compiles
        // to Prisma's case-sensitive `in`, so a lowercase code would return nothing.
        const codes = codeList(items);

        // baseUrl feeds directly into the response's pagination links (prev/next/first/last),
        // so it must be part of the key — otherwise two callers on different hosts would get
        // back each other's links.
        return await this.cache.getOrSet(
            [
                'findAll',
                `page:${page}`,
                `limit:${limit}`,
                `order:${order}`,
                `orderBy:${orderBy}`,
                `search:${search || ''}`,
                `active:${active === undefined ? 'any' : active}`,
                `select:${JSON.stringify(select ?? {})}`,
                `baseUrl:${baseUrl ?? ''}`,
                `items:${codeKey(codes)}`,
            ],
            async () => {
                const qb = this.builder
                    .search(search, [
                        'title',
                        'timezone',
                        'code',
                        'capital',
                        'dialCode',
                        'currency',
                        'continent',
                        'currencySymbol',
                        'currencyName',
                    ])
                    .whereActive(active)
                    .orderBy(orderBy, order);

                if (codes.length > 0) {
                    qb.where((sub) => {
                        for (const code of codes) sub.orWhere('code', { equals: code, mode: 'insensitive' });
                    });
                }
                return await qb.paginate({ page, columns: select as any, limit, baseUrl });
            },
        );
    }

    async findOne(identifier: string): Promise<CountryType | null> {
        // Case-insensitive so /countries/bd, /countries/BD and /countries/Bd all resolve —
        // a URL path shouldn't have to guess the column's casing. dialCode is digits/`+`,
        // so it has no case to normalize.
        const value = identifier.trim();
        const or: Prisma.CountryWhereInput[] = [
            { code: { equals: value, mode: 'insensitive' } },
            { capital: { equals: value, mode: 'insensitive' } },
            { dialCode: value },
        ];

        if (UUID_RE.test(identifier)) {
            or.unshift({ id: identifier });
        }

        const country = (await this.prisma.country.findFirst({
            where: { OR: or },
        })) as CountryType | null;

        if (!country) {
            throw new ApiException({
                statusCode: 404,
                code: 'COUNTRY_NOT_FOUND',
                message: `Country ${identifier} not found`,
            });
        }

        return country;
    }

    async flag(identifier: string, type: 'largeFlag' | 'flag' = 'flag'): Promise<string | null> {
        const country = await this.findOne(identifier);

        if (!country) return null;
        if (!country[type]) return null;

        return country[type];
    }

    /**
     * Languages across countries, de-duplicated by language code.
     *
     * Two independent, case-insensitive filters:
     * - `countries` (alias: `items`) — ISO 3166-1 alpha-2 country codes, e.g. `BD,IN,PK`.
     *   Narrows which countries are read, so the result is "languages spoken in these".
     * - `codes` — ISO 639-1 language codes, e.g. `bn,en`. Narrows the languages themselves.
     *
     * Both accept any casing. Country codes are stored uppercase and language codes
     * lowercase, but neither side is trusted: the query matches case-insensitively and
     * every code is re-normalized on read, so a mixed-case row can't produce a duplicate
     * entry (`bn` and `BN` must never both appear).
     */
    async languages(body: any) {
        const withFlag = Aide.isTrue(body?.flag);
        const countryCodes = codeList(body?.countries ?? body?.items);
        const languageCodes = codeList(body?.codes);

        return await this.cache.getOrSet(
            [
                'languages',
                withFlag ? 'withFlag' : 'withoutFlag',
                `countries:${codeKey(countryCodes)}`,
                `codes:${codeKey(languageCodes)}`,
            ],
            async () => {
                const where: Prisma.CountryWhereInput = {};
                if (countryCodes.length > 0) {
                    where.OR = codeMatchesAny('code', countryCodes);
                }

                const countries = (await this.prisma.country.findMany({
                    where,
                    select: { languages: true, id: true, code: true, emoji: true, flag: withFlag },
                })) as unknown as CountryType[];

                // A language spoken in several countries is kept once, attributed to the
                // first country that claims it — so the order countries are visited in
                // decides which flag `en` gets. Postgres returns rows in no guaranteed
                // order, which would let that flag change between identical requests.
                // Follow the caller's `countries` order (falling back to code order) so the
                // answer is deterministic: list GB before AU and `en` is reliably 🇬🇧.
                const priority = new Map(countryCodes.map((code, i) => [code.toLowerCase(), i]));
                const rank = (country: CountryType) =>
                    priority.get((country.code ?? '').toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
                countries.sort((a, b) => rank(a) - rank(b) || (a.code ?? '').localeCompare(b.code ?? ''));

                const wanted = new Set(languageCodes.map((code) => code.toLowerCase()));
                const langs: Record<string, LanguageResult> = {};

                for (const country of countries) {
                    for (const lang of Aide.toJson<Language[]>(country.languages)) {
                        // Normalize on read — the key, the filter and the output all use the
                        // canonical lowercase form regardless of how the row was written.
                        const code = String(lang?.code ?? '')
                            .trim()
                            .toLowerCase();
                        if (!code) continue;
                        if (wanted.size > 0 && !wanted.has(code)) continue;
                        if (langs[code]) continue;

                        langs[code] = {
                            ...lang,
                            code,
                            countryCode: (country.code ?? lang.countryCode ?? '').toUpperCase(),
                            countryId: country.id,
                            emoji: country.emoji ?? null,
                            ...(withFlag ? { flag: country.flag ?? undefined } : {}),
                        };
                    }
                }

                // Stable, predictable order — the map's insertion order follows whatever
                // order Postgres returned the countries in.
                return Object.values(langs).sort((a, b) => a.name.localeCompare(b.name));
            },
        );
    }
}
