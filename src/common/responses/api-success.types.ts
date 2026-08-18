import { ErrorStatus } from '@/common/errors/api-error.types';

export type SuccessStatus = ErrorStatus;

export interface ApiSuccessBody {
    message: string;
    localeKey: string | null;
    status: SuccessStatus;
    data: unknown;
}

export interface ApiSuccessMetaOptions {
    message?: string;
    localeKey?: string | null;
    status?: SuccessStatus;
}

export const API_SUCCESS_META_KEY = 'api:success:meta';
export const SKIP_SUCCESS_TRANSFORM_KEY = 'api:success:skip';

export const DEFAULT_SUCCESS_MESSAGE = 'Request completed successfully';
export const DEFAULT_SUCCESS_STATUS: SuccessStatus = 'normal';
