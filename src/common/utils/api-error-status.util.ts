const STATUS_NAME_TO_CODE: Record<string, number> = {
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    UNPROCESSABLE_ENTITY: 422,
    INTERNAL_SERVER_ERROR: 500,
};

export function resolveHttpStatus(status: unknown, statusCode?: unknown): number {
    if (typeof statusCode === 'number' && statusCode > 0) {
        return statusCode;
    }

    if (typeof status === 'number' && status > 0) {
        return status;
    }

    if (typeof status === 'string' && STATUS_NAME_TO_CODE[status]) {
        return STATUS_NAME_TO_CODE[status];
    }

    return 400;
}

export function isDuplicateUserError(code: string | null): boolean {
    if (!code) {
        return false;
    }

    return code === 'EMAIL_ALREADY_IN_USE' || code.includes('USER_ALREADY_EXISTS');
}
