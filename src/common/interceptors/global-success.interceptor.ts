import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable, map } from 'rxjs';
import { MUTATING_HTTP_METHODS } from '@/common/errors/api-error.types';
import {
    API_SUCCESS_META_KEY,
    ApiSuccessMetaOptions,
    SKIP_SUCCESS_TRANSFORM_KEY,
} from '@/common/responses/api-success.types';
import { mapPayloadToApiSuccess } from '@/common/utils/map-api-success.util';
import { isApiSuccessBody, serializeApiSuccessBody } from '@/common/utils/serialize-api-success.util';

@Injectable()
export class GlobalSuccessInterceptor implements NestInterceptor {
    constructor(private readonly reflector: Reflector) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const request = context.switchToHttp().getRequest<Request>();

        if (!MUTATING_HTTP_METHODS.has(request.method.toUpperCase())) {
            return next.handle();
        }

        const skipTransform = this.reflector.getAllAndOverride<boolean>(SKIP_SUCCESS_TRANSFORM_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (skipTransform) {
            return next.handle();
        }

        const meta = this.reflector.getAllAndOverride<ApiSuccessMetaOptions | undefined>(API_SUCCESS_META_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        return next.handle().pipe(
            map((data) => {
                if (isApiSuccessBody(data)) {
                    return serializeApiSuccessBody(data);
                }

                return serializeApiSuccessBody(mapPayloadToApiSuccess(data, meta));
            }),
        );
    }
}
