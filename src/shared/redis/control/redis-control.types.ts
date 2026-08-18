/**
 * Only two actions are exposed. `stop` is deliberately absent: an admin panel button that
 * takes the cache and the entire BullMQ queue offline has no legitimate use here, and
 * omitting it means no misconfiguration can ever produce one.
 */
export type RedisControlAction = 'start' | 'restart';

export interface RedisControlDriver {
    /** Matches REDIS_CONTROL_DRIVER, and is echoed to the panel so ops can see what's wired. */
    readonly name: string;
    /** One line describing how this driver reaches Redis — shown in the panel's tooltip. */
    readonly describe: string;
    /** Reject on failure; the message is surfaced verbatim to the admin who pressed the button. */
    run(action: RedisControlAction): Promise<string>;
}

export interface RedisControlCapability {
    driver: string;
    /** False when the driver is `none` or its required config is missing. */
    enabled: boolean;
    /** How the driver reaches Redis, or why it can't. Always populated. */
    reason: string;
}

export interface RedisControlResult {
    action: RedisControlAction;
    driver: string;
    detail: string;
    durationMs: number;
}
