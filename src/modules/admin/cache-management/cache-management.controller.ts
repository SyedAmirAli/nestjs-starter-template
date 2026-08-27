import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { Roles, Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { auth } from '@/auth/auth';
import { ADMIN_ROLES } from '@/auth/user-role';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CacheManagementService, type Actor } from './cache-management.service';
import { BulkDeleteCacheDto, SetCacheDto } from './dto/cache-management.dto';
import { ApiSuccessMeta } from '@/common/responses';

@ApiTags('Cache Management')
@Controller('admin/caches')
@Roles(ADMIN_ROLES)
export class CacheManagementController {
    constructor(private readonly cache: CacheManagementService) {}

    private actor(session: UserSession<typeof auth>): Actor {
        return session?.user ? { id: session.user.id, email: session.user.email } : null;
    }

    @Get()
    @ApiOperation({
        summary: 'List cache keys',
        description:
            'Returns Redis keys (via SCAN) with type, size, remaining TTL (`duration`), and `revalidatesAt`.',
    })
    @ApiQuery({ name: 'pattern', required: false, description: 'Redis MATCH pattern (default `*`).', example: '*' })
    @ApiResponse({ status: 200, description: 'Cache key metadata list.' })
    @ApiResponse({ status: 503, description: 'Redis is unreachable — call GET /admin/caches/status for details.' })
    findAll(@Query('pattern') pattern?: string) {
        return this.cache.findAll(pattern?.trim() || '*');
    }

    @Get('status')
    @ApiOperation({
        summary: 'Redis health + control capability',
        description: 'Never fails on a down Redis — reporting the outage is the point.',
    })
    @ApiResponse({ status: 200, description: 'Redis status and control capability.' })
    status() {
        return this.cache.getStatus();
    }

    @Post('redis/start')
    @ApiOperation({ summary: 'Start Redis through the configured control driver.' })
    @ApiResponse({ status: 200, description: 'Start issued; response carries a fresh status probe.' })
    @ApiResponse({ status: 502, description: 'Control unavailable or the driver failed.' })
    @ApiSuccessMeta({ message: 'Redis start requested', localeKey: 'updated.redis.start' })
    startRedis(@Session() session: UserSession<typeof auth>) {
        return this.cache.runControl('start', this.actor(session));
    }

    @Post('redis/restart')
    @ApiOperation({ summary: 'Restart Redis through the configured control driver.' })
    @ApiResponse({ status: 200, description: 'Restart issued; response carries a fresh status probe.' })
    @ApiResponse({ status: 502, description: 'Control unavailable or the driver failed.' })
    @ApiSuccessMeta({ message: 'Redis restart requested', localeKey: 'updated.redis.restart' })
    restartRedis(@Session() session: UserSession<typeof auth>) {
        return this.cache.runControl('restart', this.actor(session));
    }

    @Post()
    @ApiOperation({ summary: 'Set a cache key', description: 'Stores a JSON-serializable value with optional TTL.' })
    @ApiBody({ type: SetCacheDto })
    @ApiSuccessMeta({ message: 'Cache key set successfully', localeKey: 'created.cache.success' })
    set(@Body() dto: SetCacheDto) {
        return this.cache.set(dto);
    }

    @Post('bulk-delete')
    @ApiOperation({ summary: 'Bulk delete cache keys' })
    @ApiBody({ type: BulkDeleteCacheDto })
    @ApiSuccessMeta({ message: 'Cache keys deleted successfully', localeKey: 'deleted.cache.bulk' })
    bulkDelete(@Body() dto: BulkDeleteCacheDto) {
        return this.cache.bulkDelete(dto);
    }

    @Get(':key')
    @ApiOperation({
        summary: 'Get cache value by key',
        description: 'URL-encode keys with special characters.',
    })
    @ApiParam({ name: 'key', description: 'Full Redis key (URL-encoded if needed).' })
    @ApiResponse({ status: 200, description: 'Key metadata + type-aware value.' })
    @ApiResponse({ status: 404, description: 'Key not found.' })
    getOne(@Param('key') key: string) {
        return this.cache.getOne(decodeURIComponent(key));
    }

    @Delete(':key')
    @ApiOperation({ summary: 'Delete one cache key' })
    @ApiParam({ name: 'key', description: 'Full Redis key (URL-encode if needed).' })
    @ApiSuccessMeta({ message: 'Cache key deleted successfully', localeKey: 'deleted.cache.success' })
    remove(@Param('key') key: string) {
        return this.cache.remove(decodeURIComponent(key));
    }
}
