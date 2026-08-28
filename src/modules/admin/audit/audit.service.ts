import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditLog, Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ApiException } from '@/common/errors/api.exception';
import PrismaQueryBuilder from '@/common/prisma-query-builder.service';
import { QueryParamsDto } from '@/shared/dto/query-params.dto';
import { AuditAction } from './audit.constants';
import { BulkDeleteAuditDto, CreateAuditLogDto, PurgeAuditDto } from './dto/audit.dto';

@Injectable()
export class AuditService {
    private readonly logger = new Logger(AuditService.name);

    constructor(private readonly prisma: PrismaService) {}

    /**
     * Primary write API for other modules. Never throws to callers — audit must not
     * break the business action. Failures are logged only.
     */

    async log(input: CreateAuditLogDto): Promise<AuditLog | null> {
        try {
            return await this.prisma.auditLog.create({
                data: {
                    actorId: input.actorId ?? null,
                    actorEmail: input.actorEmail ?? null,
                    action: input.action,
                    resource: input.resource,
                    resourceId: input.resourceId ?? null,
                    summary: input.summary ?? null,
                    beforeJson: this.toJson(input.before),
                    afterJson: this.toJson(input.after),
                    metaJson: this.toJson(input.meta),
                    ip: input.ip ?? null,
                    userAgent: input.userAgent ?? null,
                },
            });
        } catch (error) {
            this.logger.error(
                `Failed to write audit log (${input.action} ${input.resource}): ${error instanceof Error ? error.message : String(error)}`,
            );
            return null;
        }
    }

    /** Same as `log`, but fire-and-forget (does not await). Use in hot paths. */
    logAsync(input: CreateAuditLogDto): void {
        void this.log(input);
    }

    async findAll(query: QueryParamsDto) {
        const {
            page,
            limit,
            order,
            search,
            select,
            orderBy,
            baseUrl,
            userId,
            resource,
            action,
            resourceId,
            fromDate,
            toDate,
        } = query;

        const qb = PrismaQueryBuilder.create<AuditLog>(this.prisma, 'auditLog').orderBy(
            orderBy ?? 'createdAt',
            order ?? 'desc',
        );

        if (userId) qb.where('actorId', userId);
        if (resource) qb.where('resource', resource);
        if (resourceId) qb.where('resourceId', resourceId);
        if (action && Object.values(AuditAction).includes(action as AuditAction)) {
            qb.where('action', action);
        }
        if (fromDate) qb.where('createdAt', '>=', new Date(fromDate));
        if (toDate) qb.where('createdAt', '<=', new Date(toDate));
        if (search) qb.search(search, ['summary', 'resource', 'resourceId', 'actorEmail', 'actorId']);

        return qb.paginate({ page, limit, baseUrl, columns: select as Array<keyof AuditLog> });
    }

    async findOne(id: string) {
        const row = await this.prisma.auditLog.findUnique({ where: { id } });
        if (!row) this.notFound(id);
        return { data: row };
    }

    /** Admin-only manual note / backfill entry (goes through the same write path). */
    async create(dto: CreateAuditLogDto) {
        const row = await this.log(dto);
        if (!row) {
            throw new ApiException({
                statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
                message: 'Failed to create audit log entry.',
                code: 'AUDIT_CREATE_FAILED',
                status: 'critical',
            });
        }
        return { message: 'Audit log created successfully', data: row };
    }

    async remove(id: string) {
        await this.ensureExists(id);
        await this.prisma.auditLog.delete({ where: { id } });
        return { message: 'Audit log deleted successfully', data: null };
    }

    async bulkDelete(dto: BulkDeleteAuditDto) {
        const ids = [...new Set(dto.ids.map((id) => id.trim()).filter(Boolean))];
        if (!ids.length) {
            throw new ApiException({
                statusCode: HttpStatus.BAD_REQUEST,
                message: 'At least one audit log id is required.',
                code: 'AUDIT_IDS_REQUIRED',
                status: 'warn',
            });
        }

        const result = await this.prisma.auditLog.deleteMany({ where: { id: { in: ids } } });
        return {
            message: 'Audit logs deleted successfully',
            data: { requested: ids.length, deleted: result.count },
        };
    }

    /** Retention helper — delete rows older than `before`. */
    async purgeBefore(dto: PurgeAuditDto) {
        const before = new Date(dto.before);
        if (Number.isNaN(before.getTime())) {
            throw new ApiException({
                statusCode: HttpStatus.BAD_REQUEST,
                message: 'Invalid `before` date. Use an ISO-8601 timestamp.',
                code: 'AUDIT_INVALID_DATE',
                status: 'warn',
            });
        }

        const limit = dto.limit ?? 5000;
        const old = await this.prisma.auditLog.findMany({
            where: { createdAt: { lt: before } },
            select: { id: true },
            take: limit,
            orderBy: { createdAt: 'asc' },
        });

        if (!old.length) {
            return { message: 'No audit logs to purge', data: { deleted: 0, before: before.toISOString() } };
        }

        const result = await this.prisma.auditLog.deleteMany({
            where: { id: { in: old.map((r) => r.id) } },
        });

        return {
            message: 'Audit logs purged successfully',
            data: { deleted: result.count, before: before.toISOString(), cappedAt: limit },
        };
    }

    private async ensureExists(id: string) {
        const exists = await this.prisma.auditLog.findUnique({ where: { id }, select: { id: true } });
        if (!exists) this.notFound(id);
    }

    private notFound(id: string): never {
        throw new ApiException({
            statusCode: HttpStatus.NOT_FOUND,
            message: `Audit log not found: ${id}`,
            code: 'AUDIT_LOG_NOT_FOUND',
            status: 'warn',
        });
    }

    private toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
        if (value === undefined) return undefined;
        if (value === null) return Prisma.JsonNull;
        return value;
    }
}
