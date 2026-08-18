import '@/config/dotenv';
import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { expo } from '@better-auth/expo';
import { bearer } from 'better-auth/plugins';
import { emailOTP } from 'better-auth/plugins/email-otp';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
    APP_NAME,
    BETTER_AUTH_SECRET,
    BETTER_AUTH_URL,
    DATABASE_PROVIDER,
    DATABASE_URL,
    DEVELOPMENT,
    EXPO_SCHEME,
    GOOGLE_CLIENT_IDS,
    GOOGLE_OAUTH_CLIENT_SECRET,
    PRODUCTION,
} from '@/config/dotenv';
import { DEFAULT_USER_ROLE } from '@/auth/user-role';
import { rejectDisallowedSignUpFields } from '@/auth/hooks/reject-disallowed-sign-up-fields';
import { sendOtpEmail } from '@/shared/mail/mail-sender';
import type { UserSession } from '@thallesp/nestjs-better-auth';

/** Must match the `emailOTP()` plugin's `expiresIn` below (seconds there, minutes in the copy). */
const EMAIL_OTP_EXPIRES_IN_SECONDS = 300;

/** Locale a brand-new account starts with, until the user picks one in Settings. */
const DEFAULT_USER_LOCALE = 'en';

/**
 * Better Auth owns its own PrismaClient rather than sharing PrismaService.
 *
 * PrismaService is a Nest provider, and this module is evaluated at import time to build the
 * `auth` instance that AppModule then registers — there is no DI container yet. Two clients
 * against the same database is fine (each holds its own small pool); the alternative is
 * deferring auth construction into a factory, which the Nest adapter does not support.
 */
const adapter = new PrismaPg({ connectionString: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

export const auth = betterAuth({
    appName: APP_NAME,
    secret: BETTER_AUTH_SECRET ?? undefined,
    baseURL: BETTER_AUTH_URL,
    database: prismaAdapter(prisma, { provider: DATABASE_PROVIDER }),
    emailAndPassword: {
        enabled: true,
        minPasswordLength: 8,
    },
    socialProviders: {
        google: {
            // An array, so ID tokens minted for the Expo app's iOS/Android client ids verify —
            // not just the web client used for the redirect flow. Native Google Sign-In returns
            // a token signed for the platform client, which a single web id would reject.
            clientId: GOOGLE_CLIENT_IDS,
            clientSecret: GOOGLE_OAUTH_CLIENT_SECRET ?? '',
        },
    },
    account: {
        accountLinking: {
            enabled: true,
            // Google verifies email ownership, so it is safe to auto-link a Google sign-in to a
            // pre-existing account with the same email (e.g. one created with a password).
            // Without this, Better Auth returns "account not linked" to guard against takeover.
            trustedProviders: ['google'],
            // Without this, linking still fails whenever the *pre-existing* local account has
            // emailVerified=false, even though trustedProviders already vouches for the
            // incoming Google identity's email.
            requireLocalEmailVerified: false,
        },
    },
    user: {
        additionalFields: {
            role: {
                type: ['USER', 'ADMIN'],
                required: false,
                defaultValue: DEFAULT_USER_ROLE,
                // input: false is the actual defence against privilege escalation — it strips
                // `role` from anything a client sends. rejectDisallowedSignUpFields below turns
                // the silent strip into a loud 400, but this is what makes it safe.
                input: false,
            },
        },
    },
    databaseHooks: {
        user: {
            create: {
                // eslint-disable-next-line @typescript-eslint/require-await
                before: async (user) => ({ data: { ...user, role: DEFAULT_USER_ROLE } }),
                // Seeds UserMeta up front so the account has settings from the moment it
                // exists, rather than leaving them null until the user first opens Settings.
                // Upsert (not create) so a hook re-run cannot clobber a preference the user
                // has already set.
                after: async (user) => {
                    await prisma.userMeta.upsert({
                        where: { userId: user.id },
                        create: { id: randomUUID(), userId: user.id, locale: DEFAULT_USER_LOCALE },
                        update: {},
                    });
                },
            },
        },
        session: {
            create: {
                // Method-agnostic login gate: fires whenever a session is about to be created
                // (email, social, token exchange), so a deactivated or soft-deleted user can
                // never obtain one — and no per-request isActive check is needed anywhere else.
                // Deactivation force-logs-out existing users by purging their session rows.
                before: async (session) => {
                    const user = await prisma.user.findUnique({
                        where: { id: session.userId },
                        select: { isActive: true, deletedAt: true },
                    });
                    if (user && (!user.isActive || user.deletedAt)) {
                        throw new APIError('FORBIDDEN', {
                            message: 'This account has been deactivated. Please contact support.',
                            code: 'USER_DEACTIVATED',
                        });
                    }
                    return { data: session };
                },
            },
        },
    },
    advanced: {
        useSecureCookies: PRODUCTION,
        // Dev only: Expo Go serves from a rotating LAN IP, so origin validation has nothing
        // stable to check against. CSRF must be opted out explicitly — disableOriginCheck
        // alone will not do it in a future Better Auth release.
        disableOriginCheck: DEVELOPMENT,
        disableCSRFCheck: DEVELOPMENT,
    },
    trustedOrigins: [
        BETTER_AUTH_URL,
        `${EXPO_SCHEME}://`,
        // Expo Go / dev client on a local network IP.
        'exp://192.168.*.*:*/**',
    ],
    hooks: {
        before: rejectDisallowedSignUpFields,
    },
    plugins: [
        expo(),
        // bearer(): lets clients authenticate with `Authorization: Bearer <session-token>`
        // instead of only a session cookie — which is what the Expo app uses, since a native
        // app has no cookie jar shared with the OS browser. The token comes back in the
        // `set-auth-token` response header on sign-in (exposed via CORS in main.ts).
        bearer(),
        // emailOTP(): the passwordless flow — POST /email-otp/send-verification-otp
        // (type: "sign-in") then POST /sign-in/email-otp. disableSignUp stays false so a
        // first-time email auto-creates the account.
        emailOTP({
            otpLength: 6,
            expiresIn: EMAIL_OTP_EXPIRES_IN_SECONDS,
            allowedAttempts: 5,
            sendVerificationOTP: async ({ email, otp, type }) => {
                await sendOtpEmail(email, otp, type, EMAIL_OTP_EXPIRES_IN_SECONDS / 60);
            },
        }),
    ],
});

export type Session = typeof auth.$Infer.Session;
export type AuthSession = UserSession<typeof auth>;

/**
 * The shape every feature module may assume is present once a request reaches a handler.
 * `id` is a stable identifier that never changes for the life of the account — every
 * user-owned table's `userId` references it.
 */
export interface AuthUser {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
    createdAt: Date;
}
