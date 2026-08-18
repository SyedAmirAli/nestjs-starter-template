import { HttpStatus, Injectable } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { auth } from '@/auth/auth';
import { isProtectedEmail } from '@/auth/protected-users';
import { PrismaService } from '@/prisma/prisma.service';
import { ApiException } from '@/common/errors/api.exception';
import { AuditService } from '@/modules/admin/audit';
import { AuditAction, AUDIT_RESOURCES } from '@/modules/admin/audit/audit.constants';
import { sendOtpEmail } from '@/shared/mail/mail-sender';
import { StorageService } from '@/shared/storage';

const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

interface VerificationValue {
    otp: string;
    attempts: number;
}

/**
 * Self-service "delete my account" — OTP-gated (the user must prove they still control the
 * inbox before an irreversible action fires), then a hard delete mirroring the admin-only
 * `UserService.permanentDelete` (same cascade + audit-log snapshot), just self-targeted.
 *
 * Reuses the `Verification` table directly rather than Better Auth's `emailOTP` plugin: that
 * plugin's `type` is a fixed 4-value enum with no "account-deletion" option, and this needs
 * its own (scarier) email copy — see `renderOtpEmail`'s `account-deletion` branch.
 */
@Injectable()
export class AccountDeletionService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly storage: StorageService,
    ) {}

    async requestOtp(session: UserSession<typeof auth>): Promise<{ message: string; data: null }> {
        const { user } = session;
        this.assertNotProtected(user.email);

        const identifier = this.identifier(user.id);
        const existing = await this.prisma.verification.findFirst({
            where: { identifier, isActive: true, expiresAt: { gt: new Date() } },
            orderBy: { createdAt: 'desc' },
        });
        if (existing && Date.now() - existing.createdAt.getTime() < RESEND_COOLDOWN_MS) {
            throw new ApiException({
                statusCode: HttpStatus.TOO_MANY_REQUESTS,
                message: 'Please wait a minute before requesting another code.',
                code: 'ACCOUNT_DELETE_OTP_COOLDOWN',
                status: 'warn',
            });
        }

        // A fresh request invalidates any code already in flight.
        await this.prisma.verification.deleteMany({ where: { identifier } });

        const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');
        await this.prisma.verification.create({
            data: {
                id: randomUUID(),
                identifier,
                value: JSON.stringify({ otp, attempts: 0 } satisfies VerificationValue),
                expiresAt: new Date(Date.now() + OTP_TTL_MS),
            },
        });

        await sendOtpEmail(user.email, otp, 'account-deletion', OTP_TTL_MS / 60_000);

        return { message: 'Verification code sent to your email.', data: null };
    }

    async confirmAndDelete(
        session: UserSession<typeof auth>,
        otp: string,
    ): Promise<{ message: string; data: { id: string; deleted: true } }> {
        const { user } = session;
        this.assertNotProtected(user.email);

        const identifier = this.identifier(user.id);
        const record = await this.prisma.verification.findFirst({
            where: { identifier, isActive: true, expiresAt: { gt: new Date() } },
            orderBy: { createdAt: 'desc' },
        });
        if (!record) {
            throw new ApiException({
                statusCode: HttpStatus.BAD_REQUEST,
                message: 'This code has expired or was never requested. Request a new one.',
                code: 'ACCOUNT_DELETE_OTP_INVALID',
                status: 'warn',
            });
        }

        const parsed = this.parseValue(record.value);
        if (parsed.attempts >= MAX_ATTEMPTS) {
            await this.prisma.verification.delete({ where: { id: record.id } });
            throw new ApiException({
                statusCode: HttpStatus.TOO_MANY_REQUESTS,
                message: 'Too many incorrect attempts. Request a new code.',
                code: 'ACCOUNT_DELETE_OTP_LOCKED',
                status: 'warn',
            });
        }

        if (parsed.otp !== otp.trim()) {
            await this.prisma.verification.update({
                where: { id: record.id },
                data: {
                    value: JSON.stringify({ ...parsed, attempts: parsed.attempts + 1 } satisfies VerificationValue),
                },
            });
            throw new ApiException({
                statusCode: HttpStatus.BAD_REQUEST,
                message: 'Incorrect code. Please try again.',
                code: 'ACCOUNT_DELETE_OTP_MISMATCH',
                status: 'warn',
            });
        }

        // Consume the code before touching any user data — a failure below must never leave
        // a still-valid code lying around for a retried request to reuse.
        await this.prisma.verification.delete({ where: { id: record.id } });
        await this.permanentlyDeleteSelf(user.id, user.email);

        return {
            message: 'Your account and all associated data have been permanently deleted.',
            data: { id: user.id, deleted: true },
        };
    }

    /**
     * Hard delete: the audit snapshot, then the stored objects, then the row.
     *
     * That order is deliberate. The snapshot goes first so a failure anywhere below still
     * leaves a record that the deletion was attempted. Storage goes before the database
     * because the row is what tells us the prefix to sweep — delete the user first and any
     * surviving object becomes an orphan nothing points at, which is a privacy problem, not
     * just a bookkeeping one. A crash between the two leaves rows with no objects, which the
     * app already tolerates, rather than objects with no rows, which it cannot detect.
     */
    private async permanentlyDeleteSelf(id: string, email: string): Promise<void> {
        const user = await this.prisma.user.findUnique({
            where: { id },
            include: { meta: true, sessions: true, accounts: true },
        });
        if (!user) return;

        await this.audit.log({
            actorId: id,
            actorEmail: email,
            action: AuditAction.PURGE,
            resource: AUDIT_RESOURCES.USER,
            resourceId: id,
            summary: `User ${email} permanently deleted their own account (self-service, OTP-verified)`,
            before: { user },
            meta: { selfService: true },
        });

        // Every object this user owns lives under one prefix precisely so this is a single
        // sweep rather than a join across every table that might hold a file reference.
        let objectsDeleted = 0;
        try {
            objectsDeleted = await this.storage.deletePrefix(this.storage.userPrefix(id));
        } catch (error) {
            // A storage outage must not block the user from exercising deletion. The row goes
            // regardless; the audit entry below records that the sweep did not complete, so
            // the leftovers can be reconciled against the (now absent) user id later.
            await this.audit.log({
                actorId: id,
                actorEmail: email,
                action: AuditAction.PURGE,
                resource: AUDIT_RESOURCES.FILE,
                resourceId: id,
                summary: `Storage sweep failed during account deletion for ${email} — objects may remain`,
                meta: { error: error instanceof Error ? error.message : String(error) },
            });
        }

        // meta / sessions / accounts and every user-owned feature table cascade via
        // onDelete: Cascade, so this single delete is the whole data removal.
        await this.prisma.user.delete({ where: { id } });

        await this.audit.log({
            actorId: null,
            actorEmail: email,
            action: AuditAction.PURGE,
            resource: AUDIT_RESOURCES.USER,
            resourceId: id,
            summary: `Account ${email} deleted — ${objectsDeleted} stored object(s) removed`,
            meta: { objectsDeleted, selfService: true },
        });
    }

    private identifier(userId: string): string {
        return `account-deletion:${userId}`;
    }

    private parseValue(raw: string): VerificationValue {
        try {
            const parsed = JSON.parse(raw) as Partial<VerificationValue>;
            return { otp: typeof parsed.otp === 'string' ? parsed.otp : '', attempts: parsed.attempts ?? 0 };
        } catch {
            return { otp: '', attempts: MAX_ATTEMPTS };
        }
    }

    /** A protected system account can never be self-deleted through this flow either. */
    private assertNotProtected(email: string): void {
        if (isProtectedEmail(email)) {
            throw new ApiException({
                statusCode: HttpStatus.FORBIDDEN,
                message: 'This is a protected system account and cannot be deleted.',
                code: 'PROTECTED_USER',
                status: 'warn',
            });
        }
    }
}
