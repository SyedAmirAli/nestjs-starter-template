import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { AppController } from './app.controller';
import { auth } from '@/auth/auth';
import { AuthApiModule } from '@/auth/auth-api.module';
import { authErrorFormatMiddleware } from '@/common/middleware/auth-error-format.middleware';
import { LoggingModule } from '@/common/logging/logging.module';
import { AuditModule } from '@/modules/admin/audit';
import { UserModule } from '@/modules/admin/user';
import { CacheManagementModule } from '@/modules/admin/cache-management';
import { PrismaModule } from '@/prisma/prisma.module';
import { RedisModule } from '@/shared/redis/redis.module';
import { QueueModule } from '@/shared/queue';
import { StorageModule } from '@/shared/storage';
import { TelemetryModule } from '@/shared/telemetry';

import { bullConnection } from '@/shared/queue/redis.connection';
import { CountriesModule } from '@/modules/general/countries/countries.module';

/**
 * Import order is not cosmetic:
 *
 *  - AuditModule before LoggingModule — LoggingModule injects AuditService in its
 *    constructor to mount the auth-audit middleware. It resolves either way (AuditModule is
 *    @Global), but stating the dependency in the order makes it visible.
 *  - LoggingModule early — it registers request-id, access-log and auth-audit middleware on
 *    the raw Express stack, and those must sit ahead of Better Auth's mounted router.
 *  - AuthModule.forRoot after the infrastructure modules, because its middleware wraps the
 *    request and everything above needs to have already claimed its position in the chain.
 *
 * Feature modules (profile, resumes, applications, assistant) are appended below as their
 * plans are executed; nothing here presumes their shape.
 */
@Module({
    imports: [
        PrismaModule,
        AuditModule,
        LoggingModule,
        RedisModule,
        StorageModule,
        TelemetryModule,
        QueueModule,
        BullModule.forRoot({ connection: bullConnection }),
        AuthModule.forRoot({
            auth,
            middleware: authErrorFormatMiddleware,
            bodyParser: {
                json: { enabled: true, limit: '1mb' },
                // urlencoded consumes the raw stream on some clients, and multipart must
                // reach multer untouched — the upload interceptor parses it itself.
                urlencoded: { enabled: false },
            },
        }),
        AuthApiModule,
        UserModule,
        CacheManagementModule,
        CountriesModule,
    ],
    controllers: [AppController],
})
export class AppModule {}
