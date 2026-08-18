import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { AuditAction } from '../audit.constants';

/** Input used by other modules via `AuditService.log()` (and optional admin POST). */
export class CreateAuditLogDto {
    @ApiPropertyOptional({ description: 'Better Auth user id. Null/omit = system actor.' })
    @IsOptional()
    @IsString()
    actorId?: string | null;

    @ApiPropertyOptional({ description: 'Denormalized actor email for history after user deletion.' })
    @IsOptional()
    @IsString()
    actorEmail?: string | null;

    @ApiProperty({ enum: AuditAction, example: AuditAction.CREATE })
    @IsEnum(AuditAction)
    action!: AuditAction;

    @ApiProperty({ example: 'publisher', description: 'Resource name, e.g. publisher, sourceDocument, cache.' })
    @IsString()
    @IsNotEmpty()
    @MinLength(1)
    resource!: string;

    @ApiPropertyOptional({ example: '019f34fa-8498-7594-a20a-f0603a8c468a' })
    @IsOptional()
    @IsString()
    resourceId?: string | null;

    @ApiPropertyOptional({ example: 'Created publisher BRRI' })
    @IsOptional()
    @IsString()
    summary?: string | null;

    @ApiPropertyOptional({ description: 'Snapshot before the change.' })
    @IsOptional()
    before?: unknown;

    @ApiPropertyOptional({ description: 'Snapshot after the change.' })
    @IsOptional()
    after?: unknown;

    @ApiPropertyOptional({ description: 'Extra context (requestId, reason, …).' })
    @IsOptional()
    @IsObject()
    meta?: Record<string, unknown>;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    ip?: string | null;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    userAgent?: string | null;
}

export class BulkDeleteAuditDto {
    @ApiProperty({ type: [String], description: 'Audit log UUIDs to delete.' })
    @IsArray()
    @IsString({ each: true })
    @MinLength(1, { each: true })
    ids!: string[];
}

export class PurgeAuditDto {
    @ApiProperty({
        description: 'Delete audit rows with createdAt strictly before this ISO date.',
        example: '2026-01-01T00:00:00.000Z',
    })
    @IsString()
    @IsNotEmpty()
    before!: string;

    @ApiPropertyOptional({
        description: 'Safety cap — max rows to delete in one call (default 5000).',
        example: 5000,
        minimum: 1,
    })
    @IsOptional()
    @IsInt()
    @Min(1)
    limit?: number;
}

/** Convenience type for callers that already have actor context. */
export type AuditLogInput = CreateAuditLogDto;
