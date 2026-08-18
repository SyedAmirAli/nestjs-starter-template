/* eslint-disable @typescript-eslint/require-await -- createAuthMiddleware's signature requires
   an async callback, and this check is entirely synchronous. */
import { createAuthMiddleware, APIError } from 'better-auth/api';

const DISALLOWED_SIGN_UP_FIELDS = ['role'] as const;

export const rejectDisallowedSignUpFields = createAuthMiddleware(async (ctx) => {
    if (ctx.path !== '/sign-up/email') {
        return;
    }

    const body = ctx.body as Record<string, unknown> | null | undefined;
    if (!body) {
        return;
    }

    const disallowedFields = DISALLOWED_SIGN_UP_FIELDS.filter((field) => field in body);
    if (!disallowedFields.length) {
        return;
    }

    const errors = Object.fromEntries(
        disallowedFields.map((field) => [field, [`The field "${field}" is not allowed.`]]),
    );

    throw new APIError('BAD_REQUEST', {
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        errors,
    });
});
