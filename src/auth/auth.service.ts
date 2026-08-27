import { HttpStatus, Injectable } from '@nestjs/common';
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { isAPIError } from 'better-auth/api';
import { auth } from '@/auth/auth';
import { RegisterDto } from '@/auth/dto/register.dto';
import { ApiException } from '@/common/errors/api.exception';
import { isDuplicateUserError, resolveHttpStatus } from '@/common/utils/api-error-status.util';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService, AuditAction, AUDIT_RESOURCES } from '@/modules/admin/audit';
import { isProtectedEmail } from '@/auth/protected-users';

/**
 * Better Auth's own messages are developer-facing and inconsistent in tone. These are the
 * strings that reach a log or a developer — the mobile app switches on `code` and supplies
 * its own user-facing copy, per the API conventions.
 */
const AUTH_ERROR_MESSAGES: Record<string, string> = {
    USER_ALREADY_EXISTS: 'An account with this email already exists.',
    USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'An account with this email already exists.',
    EMAIL_ALREADY_IN_USE: 'An account with this email already exists.',
    INVALID_EMAIL: 'Please provide a valid email address.',
    INVALID_PASSWORD: 'Password does not meet the requirements.',
    WEAK_PASSWORD: 'Password is too weak. Use at least 8 characters.',
};

@Injectable()
export class AuthService {
    constructor(
        private readonly betterAuthService: BetterAuthService<typeof auth>,
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) {}

    /**
     * The current user plus their settings, in one round trip.
     *
     * Read from the database rather than returned from `session.user`: the session snapshot
     * is whatever was true when the session was issued, which can be weeks old, and this is
     * the endpoint the app calls on launch to find out what is true *now*.
     */
    async getCurrentUser(session: UserSession<typeof auth>) {
        const user = await this.prisma.user.findUnique({
            where: { id: session.user.id },
            select: {
                id: true,
                name: true,
                email: true,
                emailVerified: true,
                image: true,
                role: true,
                createdAt: true,
                meta: true,
            },
        });
        if (!user) return null;
        return { ...user, isSuperAdmin: isProtectedEmail(user.email) };
    }

    /**
     * Registration is audited here rather than by the auth-audit middleware.
     *
     * That middleware watches Better Auth's mounted HTTP routes, and this path calls
     * `signUpEmail` in-process — so a sign-up through this endpoint would otherwise leave no
     * trace at all, while the same action through /api/auth/sign-up/email would. Failures are
     * recorded too: a burst of failed sign-ups against one address is the signal worth having.
     */
    async register(dto: RegisterDto) {
        // Lowercased at the boundary so "Sam@x.com" and "sam@x.com" cannot become two
        // accounts. Better Auth's uniqueness check is a plain column lookup.
        const email = dto.email.trim().toLowerCase();

        try {
            const result = await this.betterAuthService.api.signUpEmail({
                body: { email, password: dto.password, name: dto.name.trim() },
            });

            this.audit.logAsync({
                actorId: result.user?.id ?? null,
                actorEmail: email,
                action: AuditAction.CREATE,
                resource: AUDIT_RESOURCES.AUTH,
                resourceId: result.user?.id ?? null,
                summary: `Email sign-up succeeded — ${email}`,
                meta: { event: 'Email sign-up', success: true, via: 'POST /v1/auth/register' },
            });

            return { message: 'Registration successful', data: result };
        } catch (error) {
            const apiError = this.toApiException(error);

            this.audit.logAsync({
                actorEmail: email,
                action: AuditAction.CREATE,
                resource: AUDIT_RESOURCES.AUTH,
                summary: `Email sign-up failed (${apiError.getStatus()}) — ${email}`,
                meta: { event: 'Email sign-up', success: false, statusCode: apiError.getStatus() },
            });

            throw apiError;
        }
    }

    /**
     * Translates a Better Auth APIError into this app's error envelope.
     *
     * The duplicate-email case is singled out because Better Auth reports it with a status
     * that varies by path, and the client needs one stable signal — `409 USER_ALREADY_EXISTS`
     * — to route the user to sign-in instead of showing a generic failure.
     */
    private toApiException(error: unknown): ApiException {
        if (isAPIError(error)) {
            const code =
                typeof error.body === 'object' && error.body && 'code' in error.body
                    ? String((error.body as { code?: string }).code)
                    : null;

            const message =
                (typeof error.body === 'object' && error.body && 'message' in error.body
                    ? String((error.body as { message?: string }).message)
                    : undefined) ??
                (code ? AUTH_ERROR_MESSAGES[code] : undefined) ??
                'Registration failed. Please check your details and try again.';

            if (isDuplicateUserError(code)) {
                return new ApiException({
                    statusCode: HttpStatus.CONFLICT,
                    message: AUTH_ERROR_MESSAGES[code ?? ''] ?? message,
                    code: 'USER_ALREADY_EXISTS',
                    status: 'warn',
                });
            }

            const statusCode = resolveHttpStatus(error.status, error.statusCode);

            return new ApiException({
                statusCode,
                message,
                code,
                status: statusCode >= 500 ? 'critical' : 'warn',
            });
        }

        return new ApiException({
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: 'Something went wrong during registration. Please try again later.',
            code: 'INTERNAL_SERVER_ERROR',
            status: 'critical',
        });
    }
}
