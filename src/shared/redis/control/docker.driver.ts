import { request } from 'node:http';
import { existsSync } from 'node:fs';
import {
    REDIS_CONTROL_DOCKER_CONTAINER,
    REDIS_CONTROL_DOCKER_SOCKET,
    REDIS_CONTROL_TIMEOUT,
} from '@/config/dotenv';
import type { RedisControlAction, RedisControlDriver } from './redis-control.types';

/**
 * Starts/restarts a Redis *container* through the Docker Engine API on a bind-mounted
 * `/var/run/docker.sock`. Use this when Redis runs as a container alongside the API.
 *
 * Two things to be clear-eyed about before enabling it:
 *
 * 1. Handing a container the Docker socket is equivalent to giving it root on the host —
 *    anything that can talk to that socket can start a privileged container with the host
 *    filesystem mounted. If the API is ever compromised, so is the host. The `agent` driver
 *    exists precisely to avoid this trade-off.
 * 2. The socket is `root:docker` mode 660, so the API container must run as a user that can
 *    read it (`user: root` in compose, or a matching `group_add`). This image runs as `node`
 *    by default.
 *
 * Spoken over the socket by hand rather than through dockerode: two endpoints and no auth
 * doesn't justify a dependency, and the Engine API is version-stable here.
 */
export class DockerDriver implements RedisControlDriver {
    readonly name = 'docker';

    get describe(): string {
        return `Starts the "${REDIS_CONTROL_DOCKER_CONTAINER}" container via the Docker Engine API on ${REDIS_CONTROL_DOCKER_SOCKET}.`;
    }

    static isConfigured(): boolean {
        return existsSync(REDIS_CONTROL_DOCKER_SOCKET);
    }

    async run(action: RedisControlAction): Promise<string> {
        const container = encodeURIComponent(REDIS_CONTROL_DOCKER_CONTAINER);
        // `t=5` gives Redis five seconds to persist and shut down cleanly before SIGKILL.
        const path = action === 'start' ? `/containers/${container}/start` : `/containers/${container}/restart?t=5`;

        const { status, body } = await this.engine('POST', path);

        // 204 = done. 304 = already running, which is a success for a "make Redis available"
        // button even though Docker reports it as a redirect.
        if (status === 204) return `Container "${REDIS_CONTROL_DOCKER_CONTAINER}" ${action === 'start' ? 'started' : 'restarted'}.`;
        if (status === 304) return `Container "${REDIS_CONTROL_DOCKER_CONTAINER}" was already running.`;
        if (status === 404) {
            throw new Error(
                `No container named "${REDIS_CONTROL_DOCKER_CONTAINER}". Set REDIS_CONTROL_DOCKER_CONTAINER to the real name (docker ps -a).`,
            );
        }

        throw new Error(`Docker Engine returned ${status}: ${this.messageFrom(body)}`);
    }

    private engine(method: string, path: string): Promise<{ status: number; body: string }> {
        return new Promise((resolve, reject) => {
            const req = request(
                {
                    socketPath: REDIS_CONTROL_DOCKER_SOCKET,
                    path,
                    method,
                    // The Engine API ignores Host but Node still requires one for a valid request line.
                    headers: { Host: 'docker', 'Content-Type': 'application/json', 'Content-Length': '0' },
                    timeout: REDIS_CONTROL_TIMEOUT,
                },
                (res) => {
                    let body = '';
                    res.setEncoding('utf8');
                    res.on('data', (chunk: string) => (body += chunk));
                    res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
                },
            );

            req.on('timeout', () => req.destroy(new Error(`Docker Engine did not respond within ${REDIS_CONTROL_TIMEOUT}ms`)));
            req.on('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'ENOENT') {
                    reject(new Error(`Docker socket ${REDIS_CONTROL_DOCKER_SOCKET} is not mounted into this container.`));
                    return;
                }
                if (err.code === 'EACCES') {
                    reject(new Error(`No permission to read ${REDIS_CONTROL_DOCKER_SOCKET} — the container user is not in the docker group.`));
                    return;
                }
                reject(err);
            });
            req.end();
        });
    }

    /** Engine errors are `{"message":"..."}`; fall back to the raw body if that ever changes. */
    private messageFrom(body: string): string {
        try {
            const parsed = JSON.parse(body) as { message?: string };
            return parsed.message ?? body;
        } catch {
            return body || '(no response body)';
        }
    }
}
