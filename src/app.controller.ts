import { Controller, Get } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { APP_NAME, NODE_ENV } from '@/config/dotenv';

/**
 * The only anonymous surface in the entire API. Every other route requires a session —
 * default-deny, opted out of explicitly and nowhere else.
 */
@Controller()
@AllowAnonymous()
export class AppController {
    /**
     * Liveness probe. Deliberately does NOT touch Postgres or Redis: this endpoint answers
     * "is the process up", and a health check that fails during a brief database blip would
     * have the orchestrator kill a container that was about to recover on its own.
     * Dependency health belongs on a separate readiness endpoint.
     */
    @Get('health')
    getHealth(): { status: string; name: string; env: string; at: string } {
        return { status: 'ok', name: APP_NAME, env: NODE_ENV, at: new Date().toISOString() };
    }
}
