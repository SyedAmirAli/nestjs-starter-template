import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Roles } from '@thallesp/nestjs-better-auth';
import { ADMIN_ROLES } from '@/auth/user-role';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiSuccessMeta } from '@/common/responses';
import { QueryParamsDto } from '@/shared/dto/query-params.dto';
import { AuditService } from './audit.service';
import { BulkDeleteAuditDto, CreateAuditLogDto, PurgeAuditDto } from './dto/audit.dto';

// TODO: guard with an admin role once RBAC is wired (Better Auth roles).
@ApiTags('Audit Logs')
@Controller('admin/audit')
@Roles(ADMIN_ROLES)
export class AuditController {
    constructor(private readonly audit: AuditService) {}

    @Get()
    @ApiOperation({
        summary: 'List audit logs',
        description:
            'Paginated human/admin action trail. Filter with `userId` (actor), `resource`, `action`, `resourceId`, `fromDate`, `toDate`, `search`.',
    })
    @ApiQuery({ type: QueryParamsDto })
    @ApiResponse({ status: 200, description: 'Paginated audit log list.' })
    findAll(@Query() query: QueryParamsDto) {
        return this.audit.findAll(query);
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get one audit log entry.' })
    @ApiParam({ name: 'id', format: 'uuid' })
    @ApiResponse({ status: 200, description: 'Audit log details.' })
    @ApiResponse({ status: 404, description: 'Not found.' })
    findOne(@Param('id', ParseUUIDPipe) id: string) {
        return this.audit.findOne(id);
    }

    @Post()
    @ApiOperation({
        summary: 'Create a manual audit note',
        description:
            'Prefer `AuditService.log()` from other modules for automatic trails. This endpoint is for admin backfill / manual notes.',
    })
    @ApiBody({ type: CreateAuditLogDto })
    @ApiSuccessMeta({ message: 'Audit log created successfully', localeKey: 'created.audit.success' })
    create(@Body() dto: CreateAuditLogDto) {
        return this.audit.create(dto);
    }

    @Post('bulk-delete')
    @ApiOperation({ summary: 'Bulk delete audit log entries by id.' })
    @ApiBody({ type: BulkDeleteAuditDto })
    @ApiSuccessMeta({ message: 'Audit logs deleted successfully', localeKey: 'deleted.audit.bulk' })
    bulkDelete(@Body() dto: BulkDeleteAuditDto) {
        return this.audit.bulkDelete(dto);
    }

    @Post('purge')
    @ApiOperation({
        summary: 'Purge audit logs older than a date',
        description: 'Retention helper. Deletes up to `limit` (default 5000) rows with createdAt < before.',
    })
    @ApiBody({ type: PurgeAuditDto })
    @ApiSuccessMeta({ message: 'Audit logs purged successfully', localeKey: 'deleted.audit.purge' })
    purge(@Body() dto: PurgeAuditDto) {
        return this.audit.purgeBefore(dto);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete one audit log entry.' })
    @ApiParam({ name: 'id', format: 'uuid' })
    @ApiSuccessMeta({ message: 'Audit log deleted successfully', localeKey: 'deleted.audit.success' })
    remove(@Param('id', ParseUUIDPipe) id: string) {
        return this.audit.remove(id);
    }
}
