import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { REDIS_CONTROL_AGENT_TOKEN, REDIS_CONTROL_AGENT_URL, REDIS_CONTROL_TIMEOUT } from '@/config/dotenv';
import type { RedisControlAction, RedisControlDriver } from './redis-control.types';

/**
 * Calls a small single-purpose helper that runs on the *host* (scripts/redis-control-agent),
 * which is the only component that actually holds the privilege to run `systemctl`.
 *
 * This is the recommended driver for this project's production layout — Redis is a host
 * systemd service, the API is a container — because it's the only option that doesn't grant
 * the API container host-root. The agent's entire vocabulary is "start redis" and "restart
 * redis"; there is no command parameter to smuggle anything through, so a compromised API
 * container gains exactly those two verbs and nothing else.
 *
 * Two transports, both handled here:
 *   REDIS_CONTROL_AGENT_URL=http://172.17.0.1:9099        (Docker bridge gateway — mirrors how
 *                                                          Redis/Postgres are already reached)
 *   REDIS_CONTROL_AGENT_URL=unix:/run/glowquest-control/agent.sock   (bind-mounted socket, no port)
 */
export class AgentDriver implements RedisControlDriver {
    readonly name = 'agent';

    get describe(): string {
        return `Asks the host control agent at ${REDIS_CONTROL_AGENT_URL} to manage the Redis service.`;
    }

    static isConfigured(): boolean {
        return Boolean(REDIS_CONTROL_AGENT_URL && REDIS_CONTROL_AGENT_TOKEN);
    }

    async run(action: RedisControlAction): Promise<string> {
        const { status, body } = await this.call(`/redis/${action}`);
        const parsed = this.parse(body);

        if (status === 401 || status === 403) {
            throw new Error(
                'Host control agent rejected the token — REDIS_CONTROL_AGENT_TOKEN does not match the agent.',
            );
        }
        if (status !== 200 || parsed.ok === false) {
            throw new Error(parsed.detail ?? `Host control agent returned ${status}.`);
        }

        return parsed.detail ?? `Redis ${action} requested.`;
    }

    /** Splits `unix:/path` from a normal origin and builds the matching Node request options. */
    private call(path: string): Promise<{ status: number; body: string }> {
        const base = REDIS_CONTROL_AGENT_URL;
        if (!base) throw new Error('REDIS_CONTROL_AGENT_URL is not set.');

        const isUnix = base.startsWith('unix:');
        const send = isUnix || base.startsWith('http://') ? httpRequest : httpsRequest;

        let options: RequestOptions;
        if (isUnix) {
            options = { socketPath: base.slice('unix:'.length), path };
        } else {
            const url = new URL(base);
            options = {
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port,
                path: `${url.pathname.replace(/\/$/, '')}${path}`,
            };
        }

        return new Promise((resolve, reject) => {
            const req = send(
                {
                    ...options,
                    method: 'POST',
                    timeout: REDIS_CONTROL_TIMEOUT,
                    headers: {
                        Host: isUnix ? 'glowquest-control' : new URL(base).host,
                        // Explicit zero-length body: without it Node picks chunked encoding for
                        // a bodyless POST, which the agent's stdlib HTTP server has to parse for
                        // no reason.
                        'Content-Length': '0',
                        Authorization: `Bearer ${REDIS_CONTROL_AGENT_TOKEN ?? ''}`,
                    },
                },
                (res) => {
                    let body = '';
                    res.setEncoding('utf8');
                    res.on('data', (chunk: string) => (body += chunk));
                    res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
                },
            );

            req.on('timeout', () =>
                req.destroy(new Error(`Host control agent did not respond within ${REDIS_CONTROL_TIMEOUT}ms`)),
            );
            req.on('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'ECONNREFUSED' || err.code === 'ENOENT') {
                    reject(
                        new Error(
                            `Host control agent unreachable at ${base}. Is glowquest-redis-control.service running on the host, and bound to an address the container can reach?`,
                        ),
                    );
                    return;
                }
                reject(err);
            });
            req.end();
        });
    }

    private parse(body: string): { ok?: boolean; detail?: string } {
        try {
            return JSON.parse(body) as { ok?: boolean; detail?: string };
        } catch {
            return { detail: body.trim() || undefined };
        }
    }
}
