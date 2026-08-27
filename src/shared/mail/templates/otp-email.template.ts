/** Optional. An <img> with an empty src renders as a broken-image icon in most mail clients,
 *  so the wordmark below is used until a real asset URL is configured. */
const LOGO_URL = process.env['MAIL_LOGO_URL'] ?? '';

export type OtpType = 'sign-in' | 'email-verification' | 'forget-password' | 'change-email' | 'account-deletion';

const OTP_PURPOSE_COPY: Record<OtpType, string> = {
    'sign-in': 'Use the code below to sign in to your base-app account.',
    'email-verification': 'Use the code below to verify your email address.',
    'forget-password': 'Use the code below to reset your password.',
    'change-email': 'Use the code below to confirm your new email address.',
    'account-deletion':
        'Use the code below to confirm permanent deletion of your base-app account. This cannot be undone.',
};

/** `account-deletion` gets a red header + explicit warning banner instead of the standard green. */
const DESTRUCTIVE_TYPES: ReadonlySet<OtpType> = new Set(['account-deletion']);

export interface OtpEmailInput {
    otp: string;
    type: OtpType;
    expiresInMinutes: number;
}

/** Branded HTML for the Better Auth `emailOTP` plugin's `sendVerificationOTP` callback (and self-service flows reusing the same mailer). */
export function renderOtpEmail({ otp, type, expiresInMinutes }: OtpEmailInput): string {
    const destructive = DESTRUCTIVE_TYPES.has(type);
    const headerColor = destructive ? '#991B1B' : '#166534';
    const accentColor = destructive ? '#DC2626' : '#16A34A';
    const digitBg = destructive ? '#FEF2F2' : '#ECFDF3';
    const digitBorder = destructive ? '#FECACA' : '#BBF7D0';
    const digitColor = destructive ? '#991B1B' : '#166534';
    const eyebrow = destructive ? 'Account deletion' : 'Verification code';
    const heading = destructive ? 'Confirm account deletion' : "Confirm it's you";

    const otpDigits = otp
        .split('')
        .map(
            (digit) =>
                `<td style="width:44px;height:52px;background:${digitBg};border:1px solid ${digitBorder};border-radius:8px;text-align:center;vertical-align:middle;font-family:'Courier New',monospace;font-size:24px;font-weight:700;color:${digitColor};">${digit}</td>`,
        )
        .join('<td style="width:8px;"></td>');

    const warningBanner = destructive
        ? `<tr>
              <td style="padding:0 32px 24px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;">
                  <tr>
                    <td style="padding:14px 16px;">
                      <p style="margin:0;font-size:13px;line-height:1.6;color:#991B1B;font-weight:600;">
                        ⚠ This will permanently delete your account, profile, résumés, applications, and every record tied to it. There is no recovery after this step.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`
        : '';

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${destructive ? 'Confirm app account deletion' : 'Your app verification code'}</title>
  </head>
  <body style="margin:0;padding:0;background:#F1F5F9;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #E2E8F0;">
            <tr>
              <td style="background:${headerColor};padding:24px 32px;">
                ${
                    LOGO_URL
                        ? `<img src="${LOGO_URL}" alt="app" height="28" style="display:block;height:28px;width:auto;" />`
                        : `<span style="display:block;font-size:20px;font-weight:700;letter-spacing:0.02em;color:#FFFFFF;">app</span>`
                }
              </td>
            </tr>
            <tr>
              <td style="padding:40px 32px 8px;">
                <p style="margin:0 0 4px;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${accentColor};">${eyebrow}</p>
                <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#081220;">${heading}</h1>
                <p style="margin:0 0 28px;font-size:15px;line-height:1.5;color:#475569;">${OTP_PURPOSE_COPY[type]}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0" align="center">
                  <tr>${otpDigits}</tr>
                </table>
              </td>
            </tr>
            ${warningBanner}
            <tr>
              <td style="padding:24px 32px 8px;">
                <p style="margin:0;font-size:14px;line-height:1.5;color:#64748B;text-align:center;">
                  This code expires in <strong style="color:#081220;">${expiresInMinutes} minutes</strong>.
                  If you didn't request this, you can safely ignore this email${destructive ? ' — your account will stay exactly as it is' : ''}.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <hr style="border:none;border-top:1px solid #E2E8F0;margin:0 0 20px;" />
                <p style="margin:0;font-size:12px;line-height:1.6;color:#94A3B8;text-align:center;">
                  base-app — your AI career operating system.<br />
                  This is an automated message, please don't reply to this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
