import { Module, NestModule } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { AuditService } from '@/modules/admin/audit';
import { requestIdMiddleware } from './request-id.middleware';
import { httpLogger } from './http-logger.middleware';
import { authAuditMiddleware } from './auth-audit.middleware';

/**
 * Registers the request-scoped observability middleware on the raw Express stack, before
 * other modules (notably Better Auth at /api/auth) mount their handlers.
 *
 * Order matters and is the whole reason this is a module rather than three registrations:
 *
 *  1. requestIdMiddleware — must run first so everything after it can log the same id.
 *  2. httpLogger          — must wrap the handler to time it.
 *  3. authAuditMiddleware — must sit ahead of Better Auth's handler to observe the final
 *                           status of every sign-in / sign-up / sign-out request.
 *
 * AuditService comes from the @Global AuditModule, so it resolves regardless of import order.
 */
@Module({})
export class LoggingModule implements NestModule {
    constructor(
        private readonly adapterHost: HttpAdapterHost,
        private readonly audit: AuditService,
    ) {}

    configure(): void {
        this.adapterHost.httpAdapter.use(requestIdMiddleware());
        this.adapterHost.httpAdapter.use(httpLogger());
        this.adapterHost.httpAdapter.use(authAuditMiddleware(this.audit));
    }
}
