import { SetMetadata } from '@nestjs/common';
import {
    API_SUCCESS_META_KEY,
    ApiSuccessMetaOptions,
    SKIP_SUCCESS_TRANSFORM_KEY,
} from '@/common/responses/api-success.types';

export const ApiSuccessMeta = (meta: ApiSuccessMetaOptions) => SetMetadata(API_SUCCESS_META_KEY, meta);

export const SkipSuccessTransform = () => SetMetadata(SKIP_SUCCESS_TRANSFORM_KEY, true);
