import request from 'supertest';

/**
 * End-to-end tests against a RUNNING server, not an in-process Nest fixture.
 *
 * The usual `Test.createTestingModule({ imports: [AppModule] })` shape does not work here,
 * and cannot be made to without changing the whole app's module system: Better Auth and its
 * Nest adapter ship ESM only, the app compiles to CommonJS, and Jest's CJS runtime has no
 * equivalent of Node's `require(esm)` support. Importing AppModule into Jest therefore fails
 * at load with "Cannot use import statement outside a module" before a single test runs.
 *
 * Testing over HTTP is the better answer regardless of that constraint — it exercises the
 * real bootstrap: global prefix, CORS headers, the request-id middleware, the access log and
 * Better Auth's own mounted router, none of which an in-process fixture reproduces faithfully.
 *
 *   yarn dev                    # in one terminal
 *   yarn test:e2e               # in another
 *
 * Point it elsewhere with E2E_BASE_URL. If nothing is listening, the suite fails with an
 * explicit message rather than a connection-refused stack trace.
 */
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4100';

/** Unique per run, so re-running does not collide with the account the last run created. */
const email = `e2e-${Date.now()}@example.com`;
const password = 'supersecret123';

describe('base-app API (e2e)', () => {
    beforeAll(async () => {
        try {
            await request(BASE_URL).get('/health').expect(200);
        } catch {
            throw new Error(`No server responding at ${BASE_URL}. Start one with \`yarn dev\`, or set E2E_BASE_URL.`);
        }
    });

    describe('health', () => {
        it('answers outside the version prefix, so the probe survives a v2', async () => {
            const res = await request(BASE_URL).get('/health').expect(200);
            expect(res.body).toMatchObject({ status: 'ok' });
        });

        it('echoes a request id on every response', async () => {
            const res = await request(BASE_URL).get('/health').expect(200);
            expect(res.headers['x-request-id']).toEqual(expect.any(String));
        });

        it('honours an inbound request id so a client-side trace survives', async () => {
            const res = await request(BASE_URL).get('/health').set('x-request-id', 'trace-abc-123').expect(200);
            expect(res.headers['x-request-id']).toBe('trace-abc-123');
        });

        it('replaces an inbound id that could forge a log line', async () => {
            const res = await request(BASE_URL).get('/health').set('x-request-id', 'bad id with spaces').expect(200);
            expect(res.headers['x-request-id']).not.toBe('bad id with spaces');
        });
    });

    describe('auth', () => {
        it('rejects an unauthenticated request with the error envelope', async () => {
            const res = await request(BASE_URL).get('/v1/auth/me').expect(401);

            expect(res.body).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
            expect(res.body.requestId).toEqual(expect.any(String));
        });

        it('rejects an unknown field rather than silently dropping it', async () => {
            const res = await request(BASE_URL)
                .post('/v1/auth/register')
                .send({ email, password, name: 'E2E User', role: 'ADMIN' })
                .expect(400);

            expect(res.body.code).toBe('VALIDATION_ERROR');
            expect(res.body.errors.role).toBeDefined();
        });

        it('registers, and normalises the email to lower case', async () => {
            const res = await request(BASE_URL)
                .post('/v1/auth/register')
                .send({ email: email.toUpperCase(), password, name: 'E2E User' })
                .expect(201);

            expect(res.body.data.user.email).toBe(email);
            // Never the default role from a client-supplied value — `input: false` strips it.
            expect(res.body.data.user.role).toBe('USER');
        });

        it('reports a duplicate as 409, not a generic failure', async () => {
            const res = await request(BASE_URL)
                .post('/v1/auth/register')
                .send({ email, password, name: 'E2E User' })
                .expect(409);

            expect(res.body.code).toBe('USER_ALREADY_EXISTS');
        });

        it('signs in, and returns the session token in a header the client can read', async () => {
            const res = await request(BASE_URL).post('/api/auth/sign-in/email').send({ email, password }).expect(200);

            expect(res.headers['set-auth-token']).toEqual(expect.any(String));
        });

        it('seeds settings at sign-up and round-trips an update', async () => {
            const signIn = await request(BASE_URL).post('/api/auth/sign-in/email').send({ email, password });
            const token = signIn.headers['set-auth-token'] as string;

            const seeded = await request(BASE_URL)
                .get('/v1/auth/me/settings')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            expect(seeded.body).toMatchObject({ theme: 'SYSTEM', locale: 'en' });

            const updated = await request(BASE_URL)
                .put('/v1/auth/me/settings')
                .set('Authorization', `Bearer ${token}`)
                .send({ theme: 'DARK', timezone: 'Asia/Dhaka' })
                .expect(200);

            expect(updated.body.data).toMatchObject({ theme: 'DARK', timezone: 'Asia/Dhaka' });
            // Absent fields are left alone — this is a PATCH in PUT's clothing.
            expect(updated.body.data.locale).toBe('en');
        });

        it('validates settings input', async () => {
            const signIn = await request(BASE_URL).post('/api/auth/sign-in/email').send({ email, password });
            const token = signIn.headers['set-auth-token'] as string;

            const res = await request(BASE_URL)
                .put('/v1/auth/me/settings')
                .set('Authorization', `Bearer ${token}`)
                .send({ pageSize: 'A3' })
                .expect(400);

            expect(res.body.errors.pageSize).toBeDefined();
        });
    });
});
