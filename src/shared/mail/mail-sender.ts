import '@/config/dotenv';
import { createTransport, type Transporter } from 'nodemailer';
import { APP_NAME, MAIL_APP_PASSWORD, MAIL_FROM } from '@/config/dotenv';
import { renderOtpEmail, type OtpEmailInput } from '@/shared/mail/templates/otp-email.template';

/**
 * Plain (non-DI) SMTP sender. Exported as functions, not a Nest service, because
 * `src/auth/auth.ts` builds the Better Auth instance outside the Nest DI container (the same
 * reason it instantiates its own PrismaClient) — the `emailOTP` plugin's `sendVerificationOTP`
 * callback needs a directly-callable function, not an injectable.
 */

/**
 * Built lazily rather than at import time. `mail-sender` is imported transitively by
 * `auth.ts`, which the Nest bootstrap loads before `assertConfig()` can complain — so a
 * deployment with no mail credentials would otherwise construct a transport around
 * `undefined` at module load and fail in a place that has nothing to do with mail.
 */
let transport: Transporter | null = null;

function getTransport(): Transporter {
    if (transport) return transport;

    if (!MAIL_FROM || !MAIL_APP_PASSWORD) {
        throw new Error('MAIL_FROM and MAIL_APP_PASSWORD must be set to send email');
    }

    transport = createTransport({
        service: 'gmail',
        auth: { user: MAIL_FROM, pass: MAIL_APP_PASSWORD },
    });

    return transport;
}

export interface SendMailInput {
    to: string;
    subject: string;
    html: string;
}

export async function sendMail({ to, subject, html }: SendMailInput): Promise<void> {
    await getTransport().sendMail({
        from: `${APP_NAME} <${MAIL_FROM}>`,
        to,
        subject,
        html,
    });
}

const OTP_SUBJECT: Record<OtpEmailInput['type'], string> = {
    'sign-in': 'Your app sign-in code',
    'email-verification': 'Verify your app email',
    'forget-password': 'Reset your app password',
    'change-email': 'Confirm your new app email',
    'account-deletion': 'Confirm app account deletion',
};

export async function sendOtpEmail(
    to: string,
    otp: string,
    type: OtpEmailInput['type'],
    expiresInMinutes = 5,
): Promise<void> {
    await sendMail({
        to,
        subject: OTP_SUBJECT[type],
        html: renderOtpEmail({ otp, type, expiresInMinutes }),
    });
}
