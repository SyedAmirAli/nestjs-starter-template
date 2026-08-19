import { isReservedApiPath, RESERVED_API_PREFIXES } from './reserved-paths';

/**
 * The console is a catch-all on `/`. Everything it must not swallow is asserted here, because
 * the failure mode is silent: a mis-scoped prefix does not throw, it just starts answering
 * API requests with HTML, and the first report of that arrives from a client team.
 */
describe('isReservedApiPath', () => {
    describe('claims API traffic', () => {
        it.each(RESERVED_API_PREFIXES)('claims %s exactly', (prefix) => {
            expect(isReservedApiPath(prefix)).toBe(true);
        });

        it.each([
            '/v1/auth/me',
            '/v1/admin/audit',
            '/api/auth/sign-in/email',
            '/api/auth/callback/google',
            '/docs/swagger-ui-bundle.js',
        ])('claims nested path %s', (path) => {
            expect(isReservedApiPath(path)).toBe(true);
        });

        it('ignores a trailing slash, which routes the same as without one', () => {
            expect(isReservedApiPath('/v1/')).toBe(true);
            expect(isReservedApiPath('/health/')).toBe(true);
        });

        it('claims the Swagger spec siblings, which are not under /docs/', () => {
            expect(isReservedApiPath('/docs-json')).toBe(true);
            expect(isReservedApiPath('/docs-yaml')).toBe(true);
        });
    });

    describe('leaves console traffic alone', () => {
        it('leaves the root path to the console', () => {
            expect(isReservedApiPath('/')).toBe(false);
        });

        it.each(['/system', '/users/42', '/assets/index-a1b2c3.js', '/favicon.svg'])(
            'leaves %s to the console',
            (path) => {
                expect(isReservedApiPath(path)).toBe(false);
            },
        );

        // The boundary that a naive startsWith() gets wrong. These are plausible console
        // routes, and matching them as API paths would make them permanently unreachable.
        it.each(['/v1analytics', '/apikeys', '/healthcheck-report', '/documentation'])(
            'does not claim %s, which merely shares a prefix',
            (path) => {
                expect(isReservedApiPath(path)).toBe(false);
            },
        );
    });
});
