import { SetMetadata } from '@nestjs/common';
import { API_ERROR_META_KEY, ApiErrorMetaOptions } from '@/common/errors/api-error.types';

export const ApiErrorMeta = (meta: ApiErrorMetaOptions) => SetMetadata(API_ERROR_META_KEY, meta);
