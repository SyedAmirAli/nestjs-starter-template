import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Theme } from '@/generated/prisma/enums';

/** BCP-47 language tag, loosely: `en`, `en-GB`, `bn-BD`. Kept permissive on purpose — this
 *  is a display preference, not a security boundary. */
const LOCALE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Everything the user may write on their own settings row.
 *
 * Deliberately small. This is *account* preference, not profile content — a résumé's
 * headline, location and links belong to the profile module, which owns its own versioned
 * tables. Putting them here would give the same field two homes.
 *
 * PATCH semantics: an absent key means "leave alone", an explicit `null` means "clear it".
 * The validation pipe runs with `forbidNonWhitelisted`, so an unknown key is a 400 rather
 * than being silently dropped — a silently dropped field is a bug the mobile team would
 * chase for hours.
 */
export class UpsertUserMetaDto {
    @ApiPropertyOptional({ enum: Theme, description: 'Follows the OS by default.' })
    @IsOptional()
    @IsEnum(Theme)
    theme?: Theme;

    @ApiPropertyOptional({ example: 'en', description: 'BCP-47 language tag.' })
    @IsOptional()
    @Transform(trim)
    @IsString()
    @Matches(LOCALE_PATTERN, { message: 'locale must be a BCP-47 language tag, e.g. "en" or "en-GB".' })
    locale?: string;

    @ApiPropertyOptional({
        example: 'Asia/Dhaka',
        description:
            'IANA timezone. Stored server-side because backup and notification scheduling need it — ' +
            'it is the one time value the server keeps rather than leaving to the client.',
    })
    @IsOptional()
    @Transform(trim)
    @IsString()
    @MaxLength(64)
    timezone?: string;

    @ApiPropertyOptional({ example: 'A4', enum: ['A4', 'LETTER'], description: 'Default PDF page size.' })
    @IsOptional()
    @Transform(trim)
    @IsIn(['A4', 'LETTER'])
    pageSize?: 'A4' | 'LETTER';

    @ApiPropertyOptional({ description: 'Receive product and tips email. Off by default.' })
    @IsOptional()
    @IsBoolean()
    marketingEmails?: boolean;

    @ApiPropertyOptional({ description: 'Receive email for application reminders and job alerts.' })
    @IsOptional()
    @IsBoolean()
    notificationEmails?: boolean;
}
