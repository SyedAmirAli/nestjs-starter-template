import { Server } from 'node:http';
import { applyServerTimeouts, resolveServerTimeouts } from './server-timeouts';

describe('server timeouts', () => {
    it('resolves positive defaults', () => {
        const timeouts = resolveServerTimeouts();

        expect(timeouts.requestTimeout).toBeGreaterThan(0);
        expect(timeouts.headersTimeout).toBeGreaterThan(0);
        expect(timeouts.keepAliveTimeout).toBeGreaterThan(0);
    });

    /**
     * A large upload must not trip Node's 5-minute requestTimeout default, or the 413
     * this whole change removed simply comes back as a 504.
     */
    it('allows a request longer than Node’s five-minute default', () => {
        expect(resolveServerTimeouts().requestTimeout).toBeGreaterThan(5 * 60 * 1000);
    });

    it('applies the resolved values to the server', () => {
        const server = new Server();
        applyServerTimeouts(server, { requestTimeout: 900_000, headersTimeout: 120_000, keepAliveTimeout: 65_000 });

        expect(server.requestTimeout).toBe(900_000);
        expect(server.headersTimeout).toBe(120_000);
        expect(server.keepAliveTimeout).toBe(65_000);
    });

    /**
     * headersTimeout below keepAliveTimeout lets Node time out headers on a connection
     * it was still willing to keep alive, which shows up as sporadic 502s behind nginx.
     */
    it('never lets headersTimeout fall below keepAliveTimeout', () => {
        const server = new Server();
        applyServerTimeouts(server, { requestTimeout: 900_000, headersTimeout: 5_000, keepAliveTimeout: 65_000 });

        expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
    });
});
