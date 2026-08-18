import { execFile } from 'node:child_process';
import { REDIS_CONTROL_RESTART_CMD, REDIS_CONTROL_START_CMD, REDIS_CONTROL_TIMEOUT } from '@/config/dotenv';
import type { RedisControlAction, RedisControlDriver } from './redis-control.types';

/**
 * Runs a local command. Only meaningful when the API process and Redis share an OS —
 * `yarn dev` on a developer machine, or a bare-metal deploy.
 *
 * It does NOT work from inside the app container in this project's production layout, and
 * that surprises people: a container running as root is root *in its own namespaces*, not on
 * the host. `systemctl` inside the container talks to the container's PID 1 (which is
 * `node dist/main.js`, not systemd) and there is no host `redis-server` unit to find. Use the
 * `agent` or `docker` driver there — see docs/REDIS-CONTROL-FROM-DOCKER.md.
 *
 * The command line comes from the operator's own env, never from request input, and is split
 * on whitespace and executed via `execFile` with no shell — so a value containing `;` or `&&`
 * is passed as a literal argument instead of chaining a second command.
 */
export class CommandDriver implements RedisControlDriver {
    readonly name = 'command';

    get describe(): string {
        return `Runs \`${REDIS_CONTROL_START_CMD}\` on the API host. Only works when Redis and the API share an OS.`;
    }

    async run(action: RedisControlAction): Promise<string> {
        const line = action === 'start' ? REDIS_CONTROL_START_CMD : REDIS_CONTROL_RESTART_CMD;
        const [bin, ...args] = line.trim().split(/\s+/).filter(Boolean);

        if (!bin) throw new Error(`No command configured for "${action}" (REDIS_CONTROL_${action.toUpperCase()}_CMD is empty).`);

        const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
            execFile(bin, args, { timeout: REDIS_CONTROL_TIMEOUT, windowsHide: true }, (err, out, errOut) => {
                if (err) {
                    // `systemctl` says nothing on success and everything useful on stderr, so the
                    // stderr text is a far better error than "Command failed with exit code 1".
                    const detail = (errOut || out || err.message).trim();
                    reject(new Error(`\`${line}\` failed: ${detail}`));
                    return;
                }
                resolve({ stdout: out, stderr: errOut });
            });
        });

        return (stdout || stderr).trim() || `\`${line}\` completed.`;
    }
}
