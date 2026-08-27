#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const readline = require('readline');

const ENV_PATH = path.join(__dirname, '..', '.env');

const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m',
    red: '\x1b[31m',
    white: '\x1b[37m',
    bgGreen: '\x1b[42m',
    bgRed: '\x1b[41m',
};

function paint(text, ...styles) {
    return `${styles.join('')}${text}${c.reset}`;
}

function line(char = '─', width = 52) {
    return paint(char.repeat(width), c.dim);
}

function padLabel(label, width = 14) {
    return paint(label.padEnd(width), c.cyan, c.bold);
}

function printSuccessSummary({
    host,
    port,
    dbName,
    username,
    password,
    recreated = false,
    keptExisting = false,
    composeSync = null,
}) {
    const shadowDbName = `${dbName}_shadow`;
    const databaseUrl = `postgresql://${username}:${password}@${host}:${port}/${dbName}?schema=public`;
    const shadowDatabaseUrl = `postgresql://${username}:${password}@${host}:${port}/${shadowDbName}?schema=public`;
    const urlBoxWidth = Math.max(databaseUrl.length + 4, shadowDatabaseUrl.length + 4, 52);
    const urlPadding = Math.max(urlBoxWidth - databaseUrl.length - 3, 1);
    const shadowUrlPadding = Math.max(urlBoxWidth - shadowDatabaseUrl.length - 3, 1);

    let headline = '  ✔  Database setup completed successfully';
    if (recreated) {
        headline = '  ✔  Database recreated successfully';
    } else if (keptExisting) {
        headline = '  ✔  Existing database kept — privileges refreshed';
    }

    console.log('');
    console.log(`  ${line('═', urlBoxWidth)}`);
    console.log(`  ${paint(headline, c.bold, c.green)}`);
    console.log(`  ${line('─', urlBoxWidth)}`);
    console.log('');
    console.log(`  ${paint('Connection details', c.bold, c.magenta)}`);
    console.log(`  ${line('·', 20)}`);
    console.log(`  ${padLabel('Database:')} ${paint(dbName, c.yellow, c.bold)}`);
    console.log(`  ${padLabel('Username:')} ${paint(username, c.yellow, c.bold)}`);
    console.log(`  ${padLabel('Password:')} ${paint(password, c.yellow, c.bold)}`);
    console.log('');
    console.log(`  ${paint('DATABASE_URL', c.bold, c.magenta)}`);
    console.log(`  ${line('·', 20)}`);
    console.log(`  ${paint('┌' + '─'.repeat(urlBoxWidth - 2) + '┐', c.blue)}`);
    console.log(`  ${paint('│', c.blue)} ${paint(databaseUrl, c.cyan)}${' '.repeat(urlPadding)}${paint('│', c.blue)}`);
    console.log(`  ${paint('└' + '─'.repeat(urlBoxWidth - 2) + '┘', c.blue)}`);
    console.log('');
    console.log(`  ${paint('SHADOW_DATABASE_URL', c.bold, c.magenta)}`);
    console.log(`  ${line('·', 20)}`);
    console.log(`  ${paint('Used by `prisma migrate dev` to diff schema changes.', c.dim)}`);
    console.log(`  ${paint('┌' + '─'.repeat(urlBoxWidth - 2) + '┐', c.blue)}`);
    console.log(
        `  ${paint('│', c.blue)} ${paint(shadowDatabaseUrl, c.cyan)}${' '.repeat(shadowUrlPadding)}${paint('│', c.blue)}`,
    );
    console.log(`  ${paint('└' + '─'.repeat(urlBoxWidth - 2) + '┘', c.blue)}`);
    console.log('');
    console.log(`  ${paint('.env', c.bold, c.magenta)}`);
    console.log(`  ${line('·', 20)}`);
    console.log(`  ${paint(`Credentials written to ${ENV_PATH}`, c.dim)}`);
    console.log('');
    console.log(`  ${paint('docker-compose.yml', c.bold, c.magenta)}`);
    console.log(`  ${line('·', 20)}`);
    if (composeSync === 'ok') {
        console.log(`  ${paint('Reads DATABASE_* straight from .env — verified it resolves cleanly.', c.dim)}`);
    } else if (composeSync === null) {
        console.log(`  ${paint('Reads DATABASE_* straight from .env — always in sync (Docker not found, skipped verification).', c.dim)}`);
    } else {
        console.log(`  ${paint('Reads DATABASE_* straight from .env, but it failed to resolve — see warning above.', c.yellow)}`);
    }
    console.log('');
    console.log(`  ${line('═', urlBoxWidth)}`);
    console.log('');
}

function isSafeIdentifier(value) {
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value);
}

function stripQuotes(value) {
    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        return value.slice(1, -1);
    }
    return value;
}

function readDatabaseCredentialsFromEnv(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(
            `${filePath} not found. Copy .env.example to .env and fill in DATABASE_HOST, DATABASE_PORT, ` +
                `DATABASE_USERNAME, DATABASE_PASSWORD and DATABASE_NAME before running this script.`,
        );
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const vars = {};

    for (const rawLine of content.split('\n')) {
        const entry = rawLine.trim();
        if (!entry || entry.startsWith('#')) continue;

        const eqIndex = entry.indexOf('=');
        if (eqIndex === -1) continue;

        const key = entry.slice(0, eqIndex).trim();
        const value = stripQuotes(entry.slice(eqIndex + 1).trim());
        vars[key] = value;
    }

    const required = ['DATABASE_HOST', 'DATABASE_PORT', 'DATABASE_USERNAME', 'DATABASE_PASSWORD', 'DATABASE_NAME'];
    const missing = required.filter((key) => !vars[key]);

    if (missing.length > 0) {
        throw new Error(`${filePath} is missing: ${missing.join(', ')}`);
    }

    return {
        host: vars.DATABASE_HOST,
        port: vars.DATABASE_PORT,
        username: vars.DATABASE_USERNAME,
        password: vars.DATABASE_PASSWORD,
        dbName: vars.DATABASE_NAME,
    };
}

function formatEnvValue(key, value) {
    if (key === 'DATABASE_URL' || key === 'SHADOW_DATABASE_URL') {
        return `"${value}"`;
    }
    return value;
}

function upsertEnvVars(envPath, vars) {
    let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

    for (const [key, value] of Object.entries(vars)) {
        const formattedLine = `${key}=${formatEnvValue(key, value)}`;
        const pattern = new RegExp(`^${key}=.*$`, 'm');

        if (pattern.test(content)) {
            content = content.replace(pattern, formattedLine);
        } else {
            if (content.length > 0 && !content.endsWith('\n')) {
                content += '\n';
            }
            content += `${formattedLine}\n`;
        }
    }

    fs.writeFileSync(envPath, content, 'utf8');
}

function writeEnvCredentials({ host, port, dbName, username, password }) {
    const databaseUrl = `postgresql://${username}:${password}@${host}:${port}/${dbName}?schema=public`;

    upsertEnvVars(ENV_PATH, {
        DATABASE_HOST: host,
        DATABASE_PORT: port,
        DATABASE_USERNAME: username,
        DATABASE_PASSWORD: password,
        DATABASE_NAME: dbName,
        DATABASE_URL: databaseUrl,
    });
}

/**
 * docker-compose.yml never stores DB values itself — DATABASE_USERNAME/PASSWORD/PORT/NAME are
 * pulled from .env via Compose's ${VAR} substitution at `config`/`up` time, so it is already
 * in sync with whatever .env just got written. This only confirms that substitution actually
 * resolves cleanly (a typo or missing var would otherwise surface as a broken URL at runtime).
 * Returns 'ok', an error string, or null if Docker Compose isn't available to check with.
 */
function verifyDockerComposeSync() {
    const composePath = path.join(__dirname, '..', 'docker-compose.yml');
    if (!fs.existsSync(composePath)) return null;

    const dockerCheck = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' });
    if (dockerCheck.status !== 0) return null;

    const result = spawnSync('docker', ['compose', '-f', composePath, 'config', '--quiet'], {
        encoding: 'utf8',
        cwd: path.join(__dirname, '..'),
    });

    return result.status === 0 ? 'ok' : result.stderr || result.stdout || 'unknown error';
}

function runAdminSql(sql, db = 'postgres') {
    const result = spawnSync('sudo', ['-u', 'postgres', 'psql', '-d', db, '-v', 'ON_ERROR_STOP=1', '-c', sql], {
        encoding: 'utf8',
    });

    if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout);
    }

    return result.stdout;
}

function runUserCheck(username, password, host, port) {
    const result = spawnSync(
        'psql',
        [
            `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}/postgres`,
            '-v',
            'ON_ERROR_STOP=1',
            '-c',
            'SELECT 1;',
        ],
        {
            encoding: 'utf8',
            env: {
                ...process.env,
                PGPASSWORD: password,
            },
        },
    );

    return result.status === 0;
}

function roleExists(username) {
    const sql = `SELECT 1 FROM pg_roles WHERE rolname = '${username}';`;
    const output = runAdminSql(sql);
    return output.includes('1');
}

function databaseExists(dbName) {
    const sql = `SELECT 1 FROM pg_database WHERE datname = '${dbName}';`;
    const output = runAdminSql(sql);
    return output.includes('1');
}

function credentialsMatch(username, password, host, port) {
    if (!roleExists(username)) {
        return false;
    }

    return runUserCheck(username, password, host, port);
}

function askRecreateConfirm({ dbName, username }) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        console.log('');
        console.log(`  ${paint('⚠  Database already exists', c.bold, c.yellow)}`);
        console.log(`  ${line('─', 48)}`);
        console.log(`  ${padLabel('Database:')} ${paint(dbName, c.yellow, c.bold)}`);
        console.log(`  ${padLabel('Username:')} ${paint(username, c.yellow, c.bold)}`);
        console.log(`  ${paint('Credentials match .env.', c.dim)}`);
        console.log('');
        console.log(`  ${paint('Recreate a fresh database? All existing data will be lost.', c.red, c.bold)}`);
        console.log(
            `  ${paint('Type', c.dim)} ${paint('confirm', c.green, c.bold)} ${paint('to proceed, or anything else to keep the current database.', c.dim)}`,
        );
        console.log('');

        rl.question(`  ${paint('> ', c.cyan)}`, (answer) => {
            rl.close();
            resolve(answer.trim().toLowerCase() === 'confirm');
        });
    });
}

function recreateDatabase(dbName) {
    runAdminSql(
        `
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = '${dbName}'
      AND pid <> pg_backend_pid();
    `,
    );

    runAdminSql(`DROP DATABASE IF EXISTS "${dbName}";`);
    runAdminSql(`CREATE DATABASE "${dbName}";`);
}

function ensureShadowDatabase(dbName) {
    const shadowDbName = `${dbName}_shadow`;

    runAdminSql(
        `
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = '${shadowDbName}'
      AND pid <> pg_backend_pid();
    `,
    );

    runAdminSql(`DROP DATABASE IF EXISTS "${shadowDbName}";`);
    runAdminSql(`CREATE DATABASE "${shadowDbName}";`);
}

function applyDatabasePrivileges(dbName, username) {
    runAdminSql(`GRANT ALL PRIVILEGES ON DATABASE "${dbName}" TO "${username}";`);

    runAdminSql(
        `
    GRANT ALL ON SCHEMA public TO "${username}";

    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "${username}";
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "${username}";
    GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO "${username}";

    ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES TO "${username}";

    ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON SEQUENCES TO "${username}";

    ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON FUNCTIONS TO "${username}";
    `,
        dbName,
    );
}

async function main() {
    const { host, port, dbName, username, password } = readDatabaseCredentialsFromEnv(ENV_PATH);

    if (!isSafeIdentifier(dbName)) {
        throw new Error('Invalid DATABASE_NAME in .env. Use only letters, numbers, and underscore.');
    }

    if (!isSafeIdentifier(username)) {
        throw new Error('Invalid DATABASE_USERNAME in .env. Use only letters, numbers, and underscore.');
    }

    const userExists = roleExists(username);

    if (userExists) {
        const passwordOk = runUserCheck(username, password, host, port);

        if (!passwordOk) {
            throw new Error(`Username or password from .env is incorrect for "${username}".`);
        }
    } else {
        runAdminSql(`CREATE USER "${username}" WITH PASSWORD '${password}';`);
    }

    const dbAlreadyExists = databaseExists(dbName);
    const credsMatchExisting = dbAlreadyExists && credentialsMatch(username, password, host, port);

    let recreated = false;
    let keptExisting = false;

    if (credsMatchExisting) {
        const shouldRecreate = await askRecreateConfirm({ dbName, username });

        if (shouldRecreate) {
            recreateDatabase(dbName);
            recreated = true;
        } else {
            console.log('');
            console.log(`  ${paint('Keeping existing database.', c.dim)}`);
            keptExisting = true;
        }
    } else if (!dbAlreadyExists) {
        runAdminSql(`CREATE DATABASE "${dbName}";`);
    }

    applyDatabasePrivileges(dbName, username);

    // A scratch database `prisma migrate dev` diffs schema changes against — it holds no data
    // worth keeping, so it is always dropped and recreated fresh rather than asked about.
    const shadowDbName = `${dbName}_shadow`;
    ensureShadowDatabase(dbName);
    applyDatabasePrivileges(shadowDbName, username);

    writeEnvCredentials({ host, port, dbName, username, password });

    const composeSync = verifyDockerComposeSync();
    if (composeSync && composeSync !== 'ok') {
        console.log('');
        console.log(`  ${paint('⚠  docker-compose.yml did not resolve cleanly against the new .env', c.bold, c.yellow)}`);
        console.log(`  ${paint(composeSync.trim(), c.dim)}`);
    }

    printSuccessSummary({ host, port, dbName, username, password, recreated, keptExisting, composeSync });
}

main().catch((error) => {
    console.error('');
    console.error(`  ${paint('✖  Database setup failed', c.bold, c.red)}`);
    console.error(`  ${line('─', 40)}`);
    console.error(`  ${paint(error.message, c.yellow)}`);
    console.error('');
    process.exit(1);
});
