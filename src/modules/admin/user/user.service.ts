import { HttpStatus, Injectable } from '@nestjs/common';
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth';
import { isAPIError } from 'better-auth/api';
import { auth } from '@/auth/auth';
import { PrismaService } from '@/prisma/prisma.service';
import { Prisma, type User } from '@/generated/prisma/client';
import PrismaQueryBuilder from '@/common/prisma-query-builder.service';
import { ApiException } from '@/common/errors/api.exception';
import { QueryParamsDto } from '@/shared/dto/query-params.dto';
import { normalizeUserRole, USER_ROLES } from '@/auth/user-role';
import { isProtectedEmail } from '@/auth/protected-users';
import { StorageService } from '@/shared/storage';
import { AuditService } from '@/modules/admin/audit';
import { AuditAction, AUDIT_RESOURCES } from '@/modules/admin/audit/audit.constants';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

export interface Actor {
    id: string;
    email: string;
}

const RECOVERY_INCLUDE = {
    meta: true,
    sessions: true,
    accounts: true,
} satisfies Prisma.UserInclude;

const LIST_INCLUDE = {
    meta: true,
    _count: { select: { sessions: true } },
} satisfies Prisma.UserInclude;

@Injectable()
export class UserService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly betterAuth: BetterAuthService<typeof auth>,
        private readonly audit: AuditService,
        private readonly storage: StorageService,
    ) {}

    async findAll(dto: QueryParamsDto) {
        const { page, limit, order, search, active, select, orderBy, baseUrl, role } = dto;

        const qb = PrismaQueryBuilder.create<User>(this.prisma, 'user')
            .search(search, ['name', 'email'])
            .whereActive(active)
            .where('deletedAt', null)
            .orderBy(orderBy, order);

        if (role && (USER_ROLES as ReadonlyArray<string>).includes(role)) {
            qb.where('role', role);
        }

        if (!Object.keys(select ?? {}).length) {
            qb.with(LIST_INCLUDE);
        }

        return qb.paginate({ page, columns: select, limit, baseUrl });
    }

    /** Soft-deleted accounts — the Account delete screen. */
    async findDeleted(dto: QueryParamsDto) {
        const { page, limit, order, search, select, orderBy, baseUrl } = dto;

        const qb = PrismaQueryBuilder.create<User>(this.prisma, 'user')
            .search(search, ['name', 'email'])
            .where('deletedAt', '!=', null)
            .orderBy(orderBy || 'deletedAt', order);

        if (!Object.keys(select ?? {}).length) {
            qb.with(LIST_INCLUDE);
        }

        return qb.paginate({ page, columns: select, limit, baseUrl });
    }

    async findOne(id: string) {
        const user = await this.prisma.user.findUnique({
            where: { id },
            include: LIST_INCLUDE,
        });
        if (!user || user.deletedAt) throw this.notFound(id);
        return user;
    }

    async create(dto: CreateUserDto, actor: Actor) {
        const email = dto.email.trim().toLowerCase();
        this.assertTargetNotProtected(email);

        let userId: string;
        try {
            const result = await this.betterAuth.api.signUpEmail({
                body: { email, password: dto.password, name: dto.name.trim() },
            });
            userId = result.user.id;
        } catch (error) {
            throw this.toSignUpException(error);
        }

        const role = normalizeUserRole(dto.role);
        if (role !== 'USER') {
            await this.prisma.user.update({ where: { id: userId }, data: { role } });
        }

        const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { meta: true } });

        await this.audit.log({
            actorId: actor.id,
            actorEmail: actor.email,
            action: AuditAction.CREATE,
            resource: AUDIT_RESOURCES.USER,
            resourceId: userId,
            summary: `Created user ${email} (${role})`,
            after: user,
        });

        return { message: 'User created successfully', data: user };
    }

    async update(id: string, dto: UpdateUserDto, actor: Actor) {
        const before = await this.getActiveOrThrow(id);
        this.assertTargetNotProtected(before.email);

        const data: Prisma.UserUpdateInput = {};
        if (dto.name !== undefined) data.name = dto.name.trim();
        if (dto.role !== undefined) data.role = normalizeUserRole(dto.role);

        if (Object.keys(data).length) {
            await this.prisma.user.update({ where: { id }, data });
        }

        const after = await this.prisma.user.findUnique({ where: { id }, include: { meta: true } });

        await this.audit.log({
            actorId: actor.id,
            actorEmail: actor.email,
            action: AuditAction.UPDATE,
            resource: AUDIT_RESOURCES.USER,
            resourceId: id,
            summary: `Updated user ${before.email}`,
            before,
            after,
        });

        return { message: 'User updated successfully', data: after };
    }

    async setActive(id: string, isActive: boolean | undefined, actor: Actor) {
        const user = await this.getActiveOrThrow(id);
        this.assertTargetNotProtected(user.email);

        const next = isActive ?? !user.isActive;
        if (!next) this.assertNotSelf(actor, id, 'deactivate');

        await this.prisma.$transaction(async (tx) => {
            await tx.user.update({ where: { id }, data: { isActive: next } });
            if (!next) await tx.session.deleteMany({ where: { userId: id } });
        });

        await this.audit.log({
            actorId: actor.id,
            actorEmail: actor.email,
            action: AuditAction.STATUS_CHANGE,
            resource: AUDIT_RESOURCES.USER,
            resourceId: id,
            summary: `${next ? 'Activated' : 'Deactivated'} user ${user.email}`,
            before: { isActive: user.isActive },
            after: { isActive: next },
        });

        return { message: `User ${next ? 'activated' : 'deactivated'} successfully`, data: { id, isActive: next } };
    }

    async resetPassword(id: string, password: string, actor: Actor) {
        this.assertSuperAdmin(actor);
        const user = await this.getActiveOrThrow(id);
        this.assertTargetNotProtected(user.email);

        const account = await this.prisma.account.findFirst({
            where: { userId: id, providerId: 'credential' },
            select: { id: true },
        });
        if (!account) {
            throw new ApiException({
                statusCode: HttpStatus.CONFLICT,
                message: 'This user has no email/password credentials to reset (social login only).',
                code: 'NO_CREDENTIAL_ACCOUNT',
                status: 'warn',
            });
        }

        const ctx = await auth.$context;
        const hash = await ctx.password.hash(password);

        await this.prisma.$transaction(async (tx) => {
            await tx.account.update({ where: { id: account.id }, data: { password: hash } });
            await tx.session.deleteMany({ where: { userId: id } });
        });

        await this.audit.log({
            actorId: actor.id,
            actorEmail: actor.email,
            action: AuditAction.STATUS_CHANGE,
            resource: AUDIT_RESOURCES.USER,
            resourceId: id,
            summary: `Reset password for user ${user.email}`,
            meta: { credentialAccountId: account.id },
        });

        return { message: 'Password reset successfully', data: { id } };
    }

    async softDelete(id: string, actor: Actor) {
        const user = await this.getActiveOrThrow(id);
        this.assertTargetNotProtected(user.email);
        this.assertNotSelf(actor, id, 'delete');

        await this.prisma.$transaction(async (tx) => {
            await tx.user.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
            await tx.session.deleteMany({ where: { userId: id } });
        });

        await this.audit.log({
            actorId: actor.id,
            actorEmail: actor.email,
            action: AuditAction.DELETE,
            resource: AUDIT_RESOURCES.USER,
            resourceId: id,
            summary: `Soft-deleted user ${user.email}`,
            before: user,
        });

        return { message: 'User deleted successfully', data: { id, deleted: true } };
    }

    async restore(id: string, actor: Actor) {
        const user = await this.prisma.user.findUnique({ where: { id } });
        if (!user) throw this.notFound(id);
        if (!user.deletedAt) {
            throw new ApiException({
                statusCode: HttpStatus.CONFLICT,
                message: 'This account is not deleted.',
                code: 'USER_NOT_DELETED',
                status: 'warn',
            });
        }
        this.assertTargetNotProtected(user.email);

        await this.prisma.user.update({ where: { id }, data: { deletedAt: null, isActive: true } });

        await this.audit.log({
            actorId: actor.id,
            actorEmail: actor.email,
            action: AuditAction.STATUS_CHANGE,
            resource: AUDIT_RESOURCES.USER,
            resourceId: id,
            summary: `Restored user ${user.email}`,
            before: { deletedAt: user.deletedAt },
            after: { deletedAt: null, isActive: true },
        });

        return { message: 'User restored successfully', data: { id, restored: true } };
    }

    async permanentDelete(id: string, actor: Actor) {
        this.assertSuperAdmin(actor);
        const user = await this.prisma.user.findUnique({ where: { id }, include: RECOVERY_INCLUDE });
        if (!user) throw this.notFound(id);
        this.assertTargetNotProtected(user.email);
        this.assertNotSelf(actor, id, 'permanently delete');

        await this.audit.log({
            actorId: actor.id,
            actorEmail: actor.email,
            action: AuditAction.PURGE,
            resource: AUDIT_RESOURCES.USER,
            resourceId: id,
            summary: `Permanently deleted user ${user.email} (recoverable from this entry)`,
            before: { user },
        });

        try {
            await this.storage.deletePrefix(this.storage.userPrefix(id));
        } catch {
            // Same trade-off as self-service deletion: leftovers can be reconciled later.
        }

        await this.prisma.user.delete({ where: { id } });

        return { message: 'User permanently deleted successfully', data: { id, purged: true } };
    }

    private async getActiveOrThrow(id: string) {
        const user = await this.prisma.user.findUnique({ where: { id } });
        if (!user || user.deletedAt) throw this.notFound(id);
        return user;
    }

    private assertTargetNotProtected(email: string) {
        if (isProtectedEmail(email)) {
            throw new ApiException({
                statusCode: HttpStatus.FORBIDDEN,
                message: 'This is a protected system account and cannot be modified.',
                code: 'PROTECTED_USER',
                status: 'warn',
            });
        }
    }

    private assertSuperAdmin(actor: Actor) {
        if (!isProtectedEmail(actor.email)) {
            throw new ApiException({
                statusCode: HttpStatus.FORBIDDEN,
                message: 'This action is restricted to protected system administrators.',
                code: 'SUPER_ADMIN_ONLY',
                status: 'warn',
            });
        }
    }

    private assertNotSelf(actor: Actor, targetId: string, action: string) {
        if (actor.id === targetId) {
            throw new ApiException({
                statusCode: HttpStatus.BAD_REQUEST,
                message: `You cannot ${action} your own account.`,
                code: 'CANNOT_TARGET_SELF',
                status: 'warn',
            });
        }
    }

    private notFound(id: string): ApiException {
        return new ApiException({
            statusCode: HttpStatus.NOT_FOUND,
            message: `User not found: ${id}`,
            code: 'USER_NOT_FOUND',
            status: 'warn',
        });
    }

    private toSignUpException(error: unknown): ApiException {
        if (isAPIError(error)) {
            const body = (typeof error.body === 'object' ? error.body : null) as {
                code?: string;
                message?: string;
            } | null;
            const code = body?.code ?? null;
            if (
                code &&
                ['USER_ALREADY_EXISTS', 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', 'EMAIL_ALREADY_IN_USE'].includes(code)
            ) {
                return new ApiException({
                    statusCode: HttpStatus.CONFLICT,
                    message: 'An account with this email already exists.',
                    code: 'USER_ALREADY_EXISTS',
                    status: 'warn',
                    errors: { email: ['An account with this email already exists.'] },
                });
            }
            return new ApiException({
                statusCode: HttpStatus.BAD_REQUEST,
                message: body?.message ?? 'Failed to create user.',
                code: code ?? 'USER_CREATE_FAILED',
                status: 'warn',
            });
        }
        return new ApiException({
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: 'Failed to create user.',
            code: 'INTERNAL_SERVER_ERROR',
            status: 'critical',
        });
    }
}
