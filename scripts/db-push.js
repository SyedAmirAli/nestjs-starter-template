#!/usr/bin/env node

/**
 * Schema sync — one command to bring the database fully up to date.
 *
 *   1) prisma db push      → apply schema.prisma (tables/columns/enums)
 *   2) prisma generate     → regenerate the Prisma client
 *   3) prisma/sql/*.sql    → apply raw-SQL migrations Prisma can't express
 *                            (pgvector fixed dimension, HNSW, partial unique)
 *
 * Step 3 re-runs on every push because `db push` can revert the pgvector
 * `embedding` column to a dimension-less `vector`. The SQL files are
 * idempotent + guarded, so applying them every time is safe.
 *
 * Bound to `yarn db:push` (see package.json).
 */

require('dotenv/config');

const { spawnSync } = require('child_process');
const { readdirSync, readFileSync } = require('fs');
const path = require('path');
const { Client } = require('pg');

const SQL_DIR = path.join(__dirname, '..', 'prisma', 'sql');

const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
};

function paint(text, ...styles) {
    return `${styles.join('')}${text}${c.reset}`;
}

function step(label) {
    console.log('');
    console.log(`  ${paint('▸', c.cyan, c.bold)} ${paint(label, c.bold)}`);
}

/** Run a command, streaming its output; throw on non-zero exit. */
function run(cmd, args) {
    const result = spawnSync(cmd, args, { stdio: 'inherit', env: process.env });
    if (result.status !== 0) {
        throw new Error(`${cmd} ${args.join(' ')} exited with code ${result.status}`);
    }
}

/** Apply every prisma/sql/*.sql file, in filename order, over one connection. */
async function applyRawSql() {
    let files;
    try {
        files = readdirSync(SQL_DIR)
            .filter((f) => f.endsWith('.sql'))
            .sort();
    } catch {
        console.log(`  ${paint('No prisma/sql directory — skipping raw SQL.', c.dim)}`);
        return;
    }

    if (files.length === 0) {
        console.log(`  ${paint('No .sql files to apply.', c.dim)}`);
        return;
    }

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error('DATABASE_URL is not set — cannot apply raw SQL.');
    }

    const client = new Client({ connectionString });
    await client.connect();
    try {
        for (const file of files) {
            const sql = readFileSync(path.join(SQL_DIR, file), 'utf8');
            // Multi-statement runs as one implicit transaction on the simple query
            // protocol — a failing statement rolls the whole file back.
            await client.query(sql);
            console.log(`  ${paint('✔', c.green)} ${file}`);
        }
    } finally {
        await client.end();
    }
}

async function main() {
    // Anything after `yarn db:push` is forwarded to `prisma db push` — e.g.
    // `yarn db:push --accept-data-loss` when the only "loss" is a unique index over a
    // brand-new nullable column. Without this, working around a push warning means calling
    // prisma directly, which skips steps 2 and 3 and leaves pgvector broken.
    const passthrough = process.argv.slice(2);

    step('prisma db push');
    run('prisma', ['db', 'push', ...passthrough]);

    step('prisma generate');
    run('prisma', ['generate']);

    step('raw SQL (prisma/sql/*.sql)');
    await applyRawSql();

    console.log('');
    console.log(`  ${paint('✔  Schema sync complete', c.bold, c.green)}`);
    console.log('');
}

main().catch((error) => {
    console.error('');
    console.error(`  ${paint('✖  Schema sync failed', c.bold, c.red)}`);
    console.error(`  ${paint(error.message, c.yellow)}`);
    console.error('');
    process.exit(1);
});
