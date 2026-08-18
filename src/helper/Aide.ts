// Aide.ts — general-purpose application helper (ported/curated from HelperClass).
// HelperClass <=> Aide

import { randomInt } from 'node:crypto';
import slugify from './Slug';

const DEFAULT_SEPARATORS = [',', '|', ';', ':', '\t', '\n', '\r'] as const;

/** Loose Prisma-ish shape so Aide stays decoupled from the generated client. */
type PrismaLike = Record<string, { findFirst: (args: any) => Promise<any>; count: (args?: any) => Promise<number> }>;

export default class Aide {
    public static BOOL_TRUE = ['true', 'yes', 'y', '1', 'on', 'enable', 'enabled'] as const;
    public static BOOL_FALSE = ['false', 'no', 'n', '0', 'off', 'disable', 'disabled'] as const;
    public static BOOL = [...Aide.BOOL_TRUE, ...Aide.BOOL_FALSE] as const;

    // ---------------------------------------------------------------------
    // Boolean coercion
    // ---------------------------------------------------------------------

    static isTrue(value: any): boolean {
        return (Aide.BOOL_TRUE as readonly string[]).includes(String(value).toLowerCase().trim());
    }

    static isFalse(value: any): boolean {
        return (Aide.BOOL_FALSE as readonly string[]).includes(String(value).toLowerCase().trim());
    }

    static isBool(value: any): boolean {
        return Aide.isTrue(value) || Aide.isFalse(value);
    }

    static toJson<T = any>(value: unknown): T {
        if (!value) return {} as T;
        if (typeof value === 'object') return value as T;

        if (typeof value === 'string') {
            try {
                return JSON.parse(value) as T;
            } catch {
                return {} as T;
            }
        }
        return {} as T;
    }

    static toArray<T = unknown>(values: unknown, separators: string | readonly string[] = DEFAULT_SEPARATORS): T[] {
        if (!values) return [];
        if (Array.isArray(values)) return values as T[];

        if (typeof values === 'string') {
            const separatorList = Array.isArray(separators) ? separators : [separators];

            // Escape regex special characters
            const pattern = separatorList
                .map((separator) => separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                .join('|');

            return values
                .split(new RegExp(pattern, 'g'))
                .map((item) => item.trim())
                .filter((item) => item.length > 0) as T[];
        }

        return [values as T];
    }

    // ---------------------------------------------------------------------
    // Param / string validity
    // ---------------------------------------------------------------------

    /** Wraps a search term for SQL LIKE, or returns '' when absent. */
    static getSearchQuery(search?: string | null): string {
        return search ? `%${search}%` : '';
    }

    /** True when the value is one of the many "empty/placeholder" forms. */
    static invalidParam(param: any = null): boolean {
        if (typeof param === 'string') param = param.toLowerCase();
        const types: any[] = [
            'undefined',
            'null',
            'all',
            '',
            '0',
            0,
            'nan',
            'n/a',
            '[]',
            'none',
            '{}',
            '[{}]',
            null,
            false,
            'false',
            'NaN',
            undefined,
        ];
        if (Array.isArray(param)) return param.length === 0;
        if (param && typeof param === 'object') return Object.keys(param as Record<string, unknown>).length === 0;
        return types.includes(param);
    }

    static isValidParam(param: any = null): boolean {
        return !Aide.invalidParam(param);
    }

    static isSameString(str1?: string | null, str2?: string | null): boolean {
        if (!str1 || !str2) return false;
        return str1.trim().toLowerCase() === str2.trim().toLowerCase();
    }

    static isDifferentString(str1?: string | null, str2?: string | null): boolean {
        return !Aide.isSameString(str1, str2);
    }

    // ---------------------------------------------------------------------
    // JSON
    // ---------------------------------------------------------------------

    static parseJson<T = any>(json: any): T {
        if (!json) return {} as T;
        if (typeof json === 'string') {
            try {
                return JSON.parse(json) as T;
            } catch {
                return {} as T;
            }
        }
        if (typeof json === 'object') return json as T;
        return {} as T;
    }

    /** Parses one or more stringified JSON fields on an object into real objects. */
    static parseJsonField<T = any>(field: string | string[], item?: T | null): T {
        if (!item || typeof item !== 'object') return item as T;
        const fields = Array.isArray(field) ? field : [field];
        const src = item as Record<string, unknown>;
        const result: Record<string, unknown> = { ...src };
        for (const f of fields) {
            const value = src[f];
            if (typeof value === 'string') {
                try {
                    result[f] = JSON.parse(value);
                } catch {
                    result[f] = null;
                }
            }
        }
        return result as T;
    }

    // ---------------------------------------------------------------------
    // Slug / ids
    // ---------------------------------------------------------------------

    /** Slugify a string (multi-language, Bengali-aware). */
    static slug(str: string): string {
        return slugify(str);
    }

    /**
     * Slugify, and (when a Prisma model is given) guarantee uniqueness by appending
     * an incrementing suffix (`-2`, `-3`, ...) until no row matches `filterKey`.
     */
    static async createUniqueSlug(
        str: string,
        prisma?: PrismaLike | null,
        model?: string | null,
        filterKey: string = 'slug',
    ): Promise<string> {
        const MAX_SLUG_LENGTH = 240;
        let slugValue = slugify(str).slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, '');
        if (!prisma || !model) return slugValue;

        const match = slugValue.match(/^(.*?)(-(\d+))?$/);
        const baseSlug = match ? match[1] : slugValue;
        let count = match?.[3] ? parseInt(match[3], 10) + 1 : 1;

        while (await prisma[model].findFirst({ where: { [filterKey]: slugValue } })) {
            const suffix = `-${count}`;
            const maxBaseLength = Math.max(1, MAX_SLUG_LENGTH - suffix.length);
            slugValue = `${baseSlug.slice(0, maxBaseLength).replace(/-+$/g, '')}${suffix}`;
            count++;
        }
        return slugValue;
    }

    /** Cryptographically-random short id over a configurable alphabet (no external dep). */
    static nanoid(
        size: number = 8,
        opts?: {
            lower?: boolean;
            upper?: boolean;
            numbers?: boolean;
            symbols?: boolean;
            extra?: string;
            prefix?: string;
        },
    ): string {
        const { lower = true, upper = true, numbers = true, symbols = false, extra = '', prefix = '' } = opts ?? {};
        let alphabet = '';
        if (lower) alphabet += 'abcdefghijklmnopqrstuvwxyz';
        if (upper) alphabet += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        if (numbers) alphabet += '0123456789';
        if (symbols) alphabet += '!@#$%^&*()_+-=[]{}|;:,.<>?';
        if (extra) alphabet += extra;
        if (!alphabet) throw new Error('Aide.nanoid: empty alphabet');

        let id = '';
        for (let i = 0; i < size; i++) id += alphabet[randomInt(alphabet.length)];
        return prefix + id;
    }

    // ---------------------------------------------------------------------
    // Dates
    // ---------------------------------------------------------------------

    /** 'L' -> MM/DD/YYYY, 'LLLL' -> "Thursday, January 29, 2026 9:03 AM". */
    static formatDate(date?: Date | string | number, format: 'L' | 'LLLL' = 'LLLL'): string {
        const d = new Date(date ?? Date.now());

        if (format === 'L') {
            const month = (d.getMonth() + 1).toString().padStart(2, '0');
            const day = d.getDate().toString().padStart(2, '0');
            return `${month}/${day}/${d.getFullYear()}`;
        }

        const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const months = [
            'January',
            'February',
            'March',
            'April',
            'May',
            'June',
            'July',
            'August',
            'September',
            'October',
            'November',
            'December',
        ];
        const hour = d.getHours();
        const displayHour = hour % 12 || 12;
        const displayMinute = d.getMinutes().toString().padStart(2, '0');
        const ampm = hour >= 12 ? 'PM' : 'AM';
        return `${weekdays[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${displayHour}:${displayMinute} ${ampm}`;
    }

    // ---------------------------------------------------------------------
    // File mime validation
    // ---------------------------------------------------------------------

    static readonly ALLOWED_MIME_BY_TYPE: Record<string, string[]> = {
        IMAGE: [
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/gif',
            'image/webp',
            'image/avif',
            'image/svg+xml',
            'image/heic',
            'image/heif',
            'image/heic-sequence',
            'image/heif-sequence',
        ],
        VIDEO: [
            'video/mp4',
            'video/mpeg',
            'video/quicktime',
            'video/x-msvideo',
            'video/x-matroska',
            'video/webm',
            'video/ogg',
            'video/mpg',
            'video/mov',
            'video/avi',
            'video/x-flv',
            'video/x-ms-wmv',
            'video/m4v',
        ],
        AUDIO: [
            'audio/mpeg',
            'audio/mp3',
            'audio/mp4',
            'audio/m4a',
            'audio/m4b',
            'audio/m4p',
            'audio/ogg',
            'audio/wav',
            'audio/webm',
            'audio/x-wav',
        ],
        DOCUMENT: [
            'text/csv',
            'application/pdf',
            'application/msword',
            'application/vnd.ms-excel',
            'application/vnd.ms-powerpoint',
            'application/vnd.oasis.opendocument.text',
            'application/vnd.oasis.opendocument.spreadsheet',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        ],
        DATA: ['text/plain', 'application/json', 'application/sql', 'text/x-sql', 'text/csv'],
    };

    /** True when `mimetype` is allowed for the given file `type` bucket. */
    static isAllowedMime(mimetype: string, type: keyof typeof Aide.ALLOWED_MIME_BY_TYPE): boolean {
        return Aide.ALLOWED_MIME_BY_TYPE[type]?.includes((mimetype || '').toLowerCase()) ?? false;
    }
}
