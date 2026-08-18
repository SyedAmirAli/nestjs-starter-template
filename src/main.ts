import '@/config/dotenv';
import { CORS_ORIGINS, PORT, PRODUCTION } from '@/config/dotenv';
import '@/types';
import { assertConfig } from '@/config/validate';
import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { RequestMethod } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { applyServerTimeouts } from '@/common/http/server-timeouts';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from '@/common/filters/global-exception.filter';
import { GlobalSuccessInterceptor } from '@/common/interceptors/global-success.interceptor';
import { appValidationPipe } from '@/common/pipes/validation.pipe';
import { PrismaService } from '@/prisma/prisma.service';
import { printStartupBanner } from '@/shared/utils/startup-banner';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('../package.json') as { version: string };

/** Version lives in the path. v1 is frozen once the app ships — additive changes only. */
const API_PREFIX = 'v1';

async function bootstrap(): Promise<void> {
    // Before anything else: a misconfigured deploy should fail here, at boot, with the list
    // of what is wrong — not later, on a user's first upload.
    assertConfig();

    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
        bufferLogs: false,
        // Body parsing for /v1/* is owned by Better Auth's SkipBodyParsingMiddleware (see
        // AuthModule.forRoot's bodyParser). Adding express.json() here would run *after*
        // that middleware and double-parse JSON bodies.
        bodyParser: false,
    });

    enableCors(app);

    app.useGlobalPipes(appValidationPipe);
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new GlobalSuccessInterceptor(app.get(Reflector)));

    app.setGlobalPrefix(API_PREFIX, {
        // The probe must answer at a stable path across API versions — an orchestrator's
        // health check should not need updating when v2 ships.
        exclude: [{ path: 'health', method: RequestMethod.GET }],
    });

    const docsPath = setupSwagger(app);

    // Upload-friendly Node server timeouts. See server-timeouts.ts for why this has to be a
    // direct mutation of the http.Server and for the size budget it is matched to.
    applyServerTimeouts(app.getHttpServer());

    await app.listen(PORT);

    const dbConnected = await pingDb(app.get(PrismaService));
    const base = `http://localhost:${PORT}`;

    printStartupBanner({
        name: 'glowquest',
        version: pkg.version,
        env: process.env.NODE_ENV ?? 'development',
        url: `${base}/${API_PREFIX}`,
        health: `${base}/health`,
        docs: docsPath ? `${base}${docsPath}` : undefined,
        dbConnected,
        routes: [
            'GET   /health',
            'POST  /api/auth/*        (Better Auth — sign-in, session, OTP)',
            'POST  /v1/auth/register  GET /v1/auth/me',
            'GET   /v1/auth/me/settings',
        ],
    });
}

/**
 * Cross-origin access for browser clients.
 *
 * The production client is a native Expo app, which is not subject to CORS at all — this
 * exists for local tooling and any future web surface. That is precisely why the default
 * must not survive into production: reflecting every origin with credentials means any site
 * a signed-in user visits can call this API as them.
 */
function enableCors(app: NestExpressApplication): void {
    const origins = CORS_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
    const allowAll = origins.includes('*');

    if (allowAll && PRODUCTION) {
        // Not thrown: a misconfigured deploy should still boot rather than take the API down.
        // But it is worth shouting about.
        console.warn('[cors] CORS_ORIGINS=* in production — every origin can send credentialed requests.');
    }

    app.enableCors({
        // `true` reflects the caller's origin; NOT '*'. Clients send credentials, and
        // browsers reject a literal wildcard on credentialed requests — the response would
        // fail the very check it is meant to pass.
        origin: allowAll ? true : origins,
        credentials: true,
        // Better Auth's bearer() plugin returns the session token in `set-auth-token`. A
        // cross-origin caller cannot read a custom response header unless it is exposed
        // here — without this, sign-in appears to succeed while the token comes back
        // undefined.
        exposedHeaders: ['set-auth-token', 'x-request-id'],
        allowedHeaders: [
            'content-type',
            'authorization',
            'idempotency-key',
            'if-match',
            'x-request-id',
            'x-client-version',
            'x-client-platform',
        ],
    });
}

/**
 * OpenAPI, from which the mobile client is generated.
 *
 * Off in production by default: the spec enumerates every endpoint and every field, which is
 * a reconnaissance gift on a public host. Set SWAGGER_ENABLED=true to override for a staging
 * deploy that needs it.
 */
function setupSwagger(app: NestExpressApplication): string | null {
    const enabled = process.env.SWAGGER_ENABLED === 'true' || !PRODUCTION;
    if (!enabled) return null;

    const path = '/docs';
    const config = new DocumentBuilder()
        .setTitle('glowquest API')
        .setDescription('Backend for the glowquest AI Career OS mobile app.')
        .setVersion('1.0')
        .addBearerAuth()
        .build();

    SwaggerModule.setup(path, app, SwaggerModule.createDocument(app, config), {
        swaggerOptions: { persistAuthorization: true },
    });

    return path;
}

async function pingDb(prisma: PrismaService): Promise<boolean> {
    try {
        await prisma.$queryRaw`SELECT 1`;
        return true;
    } catch {
        return false;
    }
}

void bootstrap();
