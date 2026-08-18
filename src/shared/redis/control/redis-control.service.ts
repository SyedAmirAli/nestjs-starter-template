import { Injectable, Logger } from '@nestjs/common';
import {
    REDIS_CONTROL_AGENT_URL,
    REDIS_CONTROL_COOLDOWN,
    REDIS_CONTROL_DOCKER_SOCKET,
    REDIS_CONTROL_DRIVER,
} from '@/config/dotenv';
import { AgentDriver } from './agent.driver';
import { CommandDriver } from './command.driver';
import { DockerDriver } from './docker.driver';
import type {
    RedisControlAction,
    RedisControlCapability,
    RedisControlDriver,
    RedisControlResult,
} from './redis-control.types';

/**
 * Turns REDIS_CONTROL_DRIVER into a working driver, or into a plain-language explanation of
 * why there isn't one. The panel renders that explanation next to a disabled button, so an
 * unconfigured deploy tells the admin what to do instead of silently offering nothing.
 */
@Injectable()
export class RedisControlService {
    private readonly logger = new Logger(RedisControlService.name);

    private readonly driver: RedisControlDriver | null;
    private readonly disabledReason: string | null;

    /** Serialises actions across every admin: two overlapping restarts would fight each other. */
    private inFlight: Promise<RedisControlResult> | null = null;
    private lastRunAt = 0;

    constructor() {
        const resolved = this.resolve();
        this.driver = resolved.driver;
        this.disabledReason = resolved.reason;

        if (this.driver) {
            this.logger.log(`Redis control enabled via "${this.driver.name}" driver`);
        } else {
            this.logger.log(`Redis control disabled: ${this.disabledReason}`);
        }
    }

    get capability(): RedisControlCapability {
        return {
            driver: REDIS_CONTROL_DRIVER,
            enabled: this.driver !== null,
            reason: this.driver?.describe ?? this.disabledReason ?? 'Redis control is not configured.',
        };
    }

    async run(action: RedisControlAction): Promise<RedisControlResult> {
        const driver = this.driver;
        if (!driver) throw new Error(this.disabledReason ?? 'Redis control is not configured on this deployment.');

        // Join the in-flight action rather than queueing a second one — a double-click should
        // return the first result, not restart Redis twice.
        if (this.inFlight) return this.inFlight;

        const sinceLast = Date.now() - this.lastRunAt;
        if (sinceLast < REDIS_CONTROL_COOLDOWN) {
            const wait = Math.ceil((REDIS_CONTROL_COOLDOWN - sinceLast) / 1000);
            throw new Error(`Redis was just acted on. Wait ${wait}s before trying again.`);
        }

        this.inFlight = this.execute(driver, action);
        try {
            return await this.inFlight;
        } finally {
            this.inFlight = null;
            this.lastRunAt = Date.now();
        }
    }

    private async execute(driver: RedisControlDriver, action: RedisControlAction): Promise<RedisControlResult> {
        const startedAt = Date.now();
        this.logger.warn(`Redis ${action} requested via "${driver.name}" driver`);

        const detail = await driver.run(action);
        const durationMs = Date.now() - startedAt;

        this.logger.log(`Redis ${action} finished in ${durationMs}ms: ${detail}`);
        return { action, driver: driver.name, detail, durationMs };
    }

    /**
     * A driver is only handed back when its prerequisites are actually present. Returning a
     * half-configured driver would move the failure to the moment an admin presses the button
     * during an outage — the worst possible time to discover a missing env var.
     */
    private resolve(): { driver: RedisControlDriver | null; reason: string | null } {
        switch (REDIS_CONTROL_DRIVER) {
            case 'command':
                return { driver: new CommandDriver(), reason: null };

            case 'docker':
                return DockerDriver.isConfigured()
                    ? { driver: new DockerDriver(), reason: null }
                    : {
                          driver: null,
                          reason: `REDIS_CONTROL_DRIVER=docker but ${REDIS_CONTROL_DOCKER_SOCKET} is not present. Bind-mount the Docker socket into this container.`,
                      };

            case 'agent':
                return AgentDriver.isConfigured()
                    ? { driver: new AgentDriver(), reason: null }
                    : {
                          driver: null,
                          reason: REDIS_CONTROL_AGENT_URL
                              ? 'REDIS_CONTROL_DRIVER=agent but REDIS_CONTROL_AGENT_TOKEN is not set.'
                              : 'REDIS_CONTROL_DRIVER=agent but REDIS_CONTROL_AGENT_URL is not set.',
                      };

            default:
                return {
                    driver: null,
                    reason: 'Redis control is turned off (REDIS_CONTROL_DRIVER=none). See docs/REDIS-CONTROL-FROM-DOCKER.md to enable it.',
                };
        }
    }
}
