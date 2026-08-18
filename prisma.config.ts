import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
    schema: 'prisma/schema.prisma',
    migrations: {
        path: 'prisma/migrations',
    },
    datasource: {
        url: env('DATABASE_URL'),
        // Only read by `prisma migrate dev`. Unset in production, where `migrate deploy` runs
        // no diff and needs no shadow database.
        shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
    },
});
