#!/usr/bin/env node

/**
 * Database backup — dumps the full Postgres database (schema + data,
 * including pgvector embedding columns and the HNSW index) using pg_dump's
 * custom format, so it can be restored later with pg_restore.
 *
 * Connection info is read from DATABASE_URL in the project root .env — no
 * separate config needed. Each run creates its own timestamped folder under
 * backups/ (or BACKUP_DIR from .env, if set) so old dumps are never
 * overwritten:
 *
 *   backups/<database>_2026-08-01_14-32-07/
 *     <database>.dump   ← pg_restore-compatible custom-format dump
 *     manifest.json     ← what/when/where, for picking a dump out of a pile
 *
 * pg_dump's custom format already includes `CREATE EXTENSION IF NOT EXISTS
 * vector` and the HNSW index definition — no special handling required for
 * the vector column beyond a normal full dump.
 *
 * Bound to `yarn db:backup` (see package.json).
 */

require('dotenv/config');

const { spawnSync } = require('child_process');
const { mkdirSync, statSync, writeFileSync, rmSync } = require('fs');
const path = require('path');

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

/** Human-readable local timestamp, filesystem- and shell-safe: 2026-08-01_14-32-07 */
function timestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return (
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
    );
}

function humanSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes;
    let unit = -1;
    do {
        value /= 1024;
        unit += 1;
    } while (value >= 1024 && unit < units.length - 1);
    return `${value.toFixed(1)} ${units[unit]}`;
}

function parseDatabaseUrl(raw) {
    const url = new URL(raw);
    if (!/^postgres(ql)?:$/.test(url.protocol)) {
        throw new Error(`DATABASE_URL is not a postgres connection string: ${raw}`);
    }
    return {
        host: url.hostname,
        port: url.port || '5432',
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: url.pathname.replace(/^\//, ''),
        sslmode: url.searchParams.get('sslmode'),
    };
}

async function main() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error('DATABASE_URL is not set — cannot back up.');
    }
    const db = parseDatabaseUrl(connectionString);

    const backupRoot = process.env.BACKUP_DIR
        ? path.resolve(process.env.BACKUP_DIR)
        : path.join(__dirname, '..', 'backups');

    const folderName = `${db.database}_${timestamp()}`;
    const folder = path.join(backupRoot, folderName);
    const dumpFile = path.join(folder, `${db.database}.dump`);
    const manifestFile = path.join(folder, 'manifest.json');

    step(`Backing up "${db.database}" @ ${db.host}:${db.port}`);
    mkdirSync(folder, { recursive: true });

    // Password goes through PGPASSWORD (an env var), never through argv, so it
    // never shows up in `ps aux` while pg_dump is running.
    const env = { ...process.env, PGPASSWORD: db.password };
    if (db.sslmode) env.PGSSLMODE = db.sslmode;

    const args = [
        '-h',
        db.host,
        '-p',
        db.port,
        '-U',
        db.user,
        '-d',
        db.database,
        '--format=custom',
        '--verbose',
        '--file',
        dumpFile,
    ];

    const start = Date.now();
    const result = spawnSync('pg_dump', args, { stdio: 'inherit', env });
    const durationMs = Date.now() - start;

    if (result.error) {
        rmSync(folder, { recursive: true, force: true });
        if (result.error.code === 'ENOENT') {
            throw new Error('pg_dump not found on PATH — install the postgresql-client package.');
        }
        throw result.error;
    }
    if (result.status !== 0) {
        rmSync(folder, { recursive: true, force: true });
        throw new Error(`pg_dump exited with code ${result.status}`);
    }

    const { size } = statSync(dumpFile);
    writeFileSync(
        manifestFile,
        JSON.stringify(
            {
                database: db.database,
                host: db.host,
                port: db.port,
                createdAt: new Date().toISOString(),
                format: 'custom',
                sizeBytes: size,
                durationMs,
                restoreWith: `pg_restore -h <host> -p <port> -U <user> -d <target_db> --clean --if-exists "${db.database}.dump"`,
            },
            null,
            4,
        ),
    );

    console.log('');
    console.log(`  ${paint('✔  Backup complete', c.bold, c.green)}`);
    console.log(`  ${paint(folder, c.dim)}`);
    console.log(`  ${paint(`${humanSize(size)} in ${(durationMs / 1000).toFixed(1)}s`, c.dim)}`);
    console.log('');
}

main().catch((error) => {
    console.error('');
    console.error(`  ${paint('✖  Backup failed', c.bold, c.red)}`);
    console.error(`  ${paint(error.message, c.yellow)}`);
    console.error('');
    process.exit(1);
});
