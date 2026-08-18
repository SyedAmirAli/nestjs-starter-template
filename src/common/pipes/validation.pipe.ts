import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { groupValidationErrors } from '@/common/utils/validation-errors.util';

export const appValidationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
        enableImplicitConversion: true,
    },
    exceptionFactory: (errors) =>
        new BadRequestException({
            message: 'Validation failed',
            code: 'VALIDATION_ERROR',
            status: 'warn',
            statusCode: 400,
            errors: groupValidationErrors(errors),
        }),
});
