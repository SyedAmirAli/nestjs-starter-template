import { configDotenv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Load environment variables
configDotenv({ path: '.env' });

const url = decodeURIComponent(
    process.env['DATABASE_URL'] ||
        `${process.env.DATABASE_DRIVER}://${process.env.DATABASE_USERNAME}:${process.env.DATABASE_PASSWORD}@${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}/${process.env.DATABASE_NAME}?schema=public`,
);

const shadowDatabaseUrl = decodeURIComponent(
    process.env['SHADOW_DATABASE_URL'] ||
        `${process.env.DATABASE_DRIVER}://${process.env.DATABASE_USERNAME}:${process.env.DATABASE_PASSWORD}@${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}/${process.env.DATABASE_NAME}_shadow?schema=public`,
);

export default defineConfig({
    schema: 'prisma/schema.prisma',
    migrations: {
        path: 'prisma/migrations',
        seed: 'node prisma/seed.js',
    },
    // Only read by `prisma migrate dev`. Unset in production, where `migrate deploy` runs
    // no diff and needs no shadow database.
    datasource: { url, shadowDatabaseUrl },
});
