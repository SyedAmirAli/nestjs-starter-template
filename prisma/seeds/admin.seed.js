// Admin seed — the protected operator account for the console at `/`.
//
// Email and password are the same string on purpose: this is a local/bootstrap account,
// listed in src/auth/protected-users.ts so the User Management module cannot deactivate
// or delete it. Better Auth hashes the password with its own scrypt hasher; writing a
// raw string into `account.password` would make sign-in fail.
//
// Run everything:  yarn db:seed
// Run only this:   yarn db:seed --file=admin
//
// IDEMPOTENT. Re-running promotes the row to ADMIN, restores isActive, and refreshes the
// credential hash — so a forgotten local password is one seed away from working again.

const { randomUUID } = require('node:crypto');

const ADMIN_EMAIL = 'amirralli300400@gmail.com';
const ADMIN_PASSWORD = ADMIN_EMAIL;
const ADMIN_NAME = 'Syed Amir Ali';
/** Must match Better Auth's `createLocalAccountIssuer('credential')` — sign-in filters on it. */
const CREDENTIAL_ISSUER = 'local:credential';

async function hashPassword(password) {
    const { hashPassword: hash } = await import('better-auth/crypto');
    return hash(password);
}

async function seedAdmin(prisma) {
    const email = ADMIN_EMAIL.trim().toLowerCase();
    const password = await hashPassword(ADMIN_PASSWORD);

    const existing = await prisma.user.findUnique({ where: { email } });
    const user = existing
        ? await prisma.user.update({
              where: { email },
              data: {
                  name: ADMIN_NAME,
                  role: 'ADMIN',
                  emailVerified: true,
                  isActive: true,
                  deletedAt: null,
              },
          })
        : await prisma.user.create({
              data: {
                  id: randomUUID(),
                  name: ADMIN_NAME,
                  email,
                  emailVerified: true,
                  role: 'ADMIN',
                  isActive: true,
              },
          });

    const credential = await prisma.account.findFirst({
        where: { userId: user.id, providerId: 'credential' },
        select: { id: true },
    });

    if (credential) {
        await prisma.account.update({
            where: { id: credential.id },
            data: { issuer: CREDENTIAL_ISSUER, password, isActive: true },
        });
    } else {
        await prisma.account.create({
            data: {
                id: randomUUID(),
                issuer: CREDENTIAL_ISSUER,
                accountId: user.id,
                providerId: 'credential',
                userId: user.id,
                password,
                isActive: true,
            },
        });
    }

    await prisma.userMeta.upsert({
        where: { userId: user.id },
        create: { id: randomUUID(), userId: user.id, locale: 'en' },
        update: {},
    });

    console.log(`  admin: ${existing ? 'updated' : 'created'} ${email} (password = email)`);
    return { admin: user };
}

module.exports = { seedAdmin, ADMIN_EMAIL };
