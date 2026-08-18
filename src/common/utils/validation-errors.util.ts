import { ValidationError } from 'class-validator';
import { ApiErrorFieldMap } from '@/common/errors/api-error.types';

function formatConstraintMessage(property: string, key: string, message: string): string {
    if (key === 'whitelistValidation') {
        return `The field "${property}" is not allowed.`;
    }

    return message;
}

export function groupValidationErrors(errors: ValidationError[], parentKey = ''): ApiErrorFieldMap {
    const grouped: ApiErrorFieldMap = {};

    for (const error of errors) {
        const field = parentKey ? `${parentKey}.${error.property}` : error.property;

        if (error.constraints) {
            grouped[field] = Object.entries(error.constraints).map(([key, message]) =>
                formatConstraintMessage(error.property, key, message),
            );
        }

        if (error.children?.length) {
            const nested = groupValidationErrors(error.children, field);
            for (const [nestedField, messages] of Object.entries(nested)) {
                grouped[nestedField] = [...(grouped[nestedField] ?? []), ...messages];
            }
        }
    }

    return grouped;
}

export function normalizeFieldErrors(value: unknown): ApiErrorFieldMap | null {
    if (!value) {
        return null;
    }

    if (Array.isArray(value)) {
        const grouped: ApiErrorFieldMap = {};

        for (const item of value) {
            if (!item || typeof item !== 'object') {
                continue;
            }

            const field = 'field' in item ? String((item as { field?: string }).field ?? '') : '';
            const message = 'message' in item ? String((item as { message?: string }).message ?? '') : '';

            if (!field || !message) {
                continue;
            }

            grouped[field] = [...(grouped[field] ?? []), message];
        }

        return Object.keys(grouped).length ? grouped : null;
    }

    if (typeof value === 'object') {
        const grouped: ApiErrorFieldMap = {};

        for (const [field, messages] of Object.entries(value as Record<string, unknown>)) {
            if (Array.isArray(messages)) {
                grouped[field] = messages.map(String);
                continue;
            }

            if (typeof messages === 'string') {
                grouped[field] = [messages];
            }
        }

        return Object.keys(grouped).length ? grouped : null;
    }

    return null;
}
