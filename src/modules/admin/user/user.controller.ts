import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles, Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { auth } from '@/auth/auth';
import { ADMIN_ROLES } from '@/auth/user-role';
import { QueryParamsDto } from '@/shared/dto/query-params.dto';
import { UpdateActiveStatusDto } from '@/shared/dto/update-active-status.dto';
import { ApiSuccessMeta } from '@/common/responses';
import { UserService, type Actor } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@ApiTags('Users')
@Controller('admin/users')
@Roles(ADMIN_ROLES)
export class UserController {
    constructor(private readonly userService: UserService) {}

    private actor(session: UserSession<typeof auth>): Actor {
        return { id: session.user.id, email: session.user.email };
    }

    @Get()
    @ApiOperation({
        summary: 'List users',
        description: 'Paginated, searchable by name/email, filterable by active and role. Excludes soft-deleted.',
    })
    @ApiQuery({ type: QueryParamsDto })
    findAll(@Query() query: QueryParamsDto) {
        return this.userService.findAll(query);
    }

    @Get('deleted')
    @ApiOperation({
        summary: 'List soft-deleted users',
        description: 'Recoverable accounts. Restore or permanently purge from this list.',
    })
    @ApiQuery({ type: QueryParamsDto })
    findDeleted(@Query() query: QueryParamsDto) {
        return this.userService.findDeleted(query);
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get user by ID' })
    @ApiParam({ name: 'id', description: 'User id.' })
    @ApiResponse({ status: 404, description: 'User not found.' })
    findOne(@Param('id') id: string) {
        return this.userService.findOne(id);
    }

    @Post()
    @ApiOperation({ summary: 'Create a user' })
    @ApiBody({ type: CreateUserDto })
    @ApiResponse({ status: 409, description: 'Email already in use.' })
    @ApiSuccessMeta({ message: 'User created successfully', localeKey: 'created.user.success' })
    create(@Body() dto: CreateUserDto, @Session() session: UserSession<typeof auth>) {
        return this.userService.create(dto, this.actor(session));
    }

    @Put(':id')
    @ApiOperation({ summary: 'Update a user', description: 'Updates name / role. Email is immutable.' })
    @ApiParam({ name: 'id', description: 'User id.' })
    @ApiBody({ type: UpdateUserDto })
    @ApiSuccessMeta({ message: 'User updated successfully', localeKey: 'updated.user.success' })
    update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Session() session: UserSession<typeof auth>) {
        return this.userService.update(id, dto, this.actor(session));
    }

    @Patch(':id/active')
    @ApiOperation({
        summary: 'Activate / deactivate a user',
        description: 'Sets isActive when provided, else toggles. Deactivation invalidates all sessions.',
    })
    @ApiParam({ name: 'id', description: 'User id.' })
    @ApiBody({ type: UpdateActiveStatusDto })
    @ApiSuccessMeta({ message: 'User active status updated successfully', localeKey: 'updated.user.active' })
    setActive(
        @Param('id') id: string,
        @Body() dto: UpdateActiveStatusDto,
        @Session() session: UserSession<typeof auth>,
    ) {
        return this.userService.setActive(id, dto.isActive, this.actor(session));
    }

    @Post(':id/password')
    @ApiOperation({ summary: 'Reset a user’s password', description: 'Super-admin only.' })
    @ApiParam({ name: 'id', description: 'User id.' })
    @ApiBody({ type: ChangePasswordDto })
    @ApiSuccessMeta({ message: 'Password reset successfully', localeKey: 'updated.user.password' })
    resetPassword(
        @Param('id') id: string,
        @Body() dto: ChangePasswordDto,
        @Session() session: UserSession<typeof auth>,
    ) {
        return this.userService.resetPassword(id, dto.password, this.actor(session));
    }

    @Post(':id/restore')
    @ApiOperation({ summary: 'Restore a soft-deleted user' })
    @ApiParam({ name: 'id', description: 'User id.' })
    @ApiSuccessMeta({ message: 'User restored successfully', localeKey: 'updated.user.restore' })
    restore(@Param('id') id: string, @Session() session: UserSession<typeof auth>) {
        return this.userService.restore(id, this.actor(session));
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Soft-delete a user', description: 'Recoverable — marks deletedAt and purges sessions.' })
    @ApiParam({ name: 'id', description: 'User id.' })
    @ApiSuccessMeta({ message: 'User deleted successfully', localeKey: 'deleted.user.success' })
    softDelete(@Param('id') id: string, @Session() session: UserSession<typeof auth>) {
        return this.userService.softDelete(id, this.actor(session));
    }

    @Delete(':id/permanent')
    @ApiOperation({
        summary: 'Permanently delete a user',
        description: 'Super-admin only. Snapshots to the audit log, then hard-deletes with cascade.',
    })
    @ApiParam({ name: 'id', description: 'User id.' })
    @ApiSuccessMeta({ message: 'User permanently deleted successfully', localeKey: 'deleted.user.permanent' })
    permanentDelete(@Param('id') id: string, @Session() session: UserSession<typeof auth>) {
        return this.userService.permanentDelete(id, this.actor(session));
    }
}
