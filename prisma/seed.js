// Seed orchestrator — wires per-model seed files in dependency order.
//
// Base seeders live in prisma/seeds/<model>.seed.js.
//
// Run everything:      yarn db:seed
// Seed one entry only: yarn db:seed --file=admin
//
// Uses the compiled client (run `yarn build:api` / `nest build` first, which `yarn db:seed`
// already does). Same shape as the krishi.doctor orchestrator, minus the checksum guard —
// that exists to skip thousand-row crop packs; these seeders are cheap and always run.

const path = require('path');
const { configDotenv } = require('dotenv');

/** Load environment variables */
configDotenv({ path: path.resolve(__dirname, '..', '.env') });

const { PrismaClient } = require('../dist/generated/prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

/** Import all seeders */
const { seedAdmin } = require('./seeds/admin.seed');
/** Seeder Imported */

const connectionString = decodeURIComponent(
    process.env['DATABASE_URL'] ||
        `${process.env.DATABASE_DRIVER}://${process.env.DATABASE_USERNAME}:${process.env.DATABASE_PASSWORD}@${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}/${process.env.DATABASE_NAME}?schema=public`,
);

console.log('DATABASE_URL:', connectionString + '\n');

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// Order matters — each entry lists the registry names it depends on. Keep this array in a
// valid topological order.
const registry = [{ name: 'admin', deps: [], run: async (prisma) => await seedAdmin(prisma) }];

function parseFileFlag(argv) {
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--file=')) return arg.slice('--file='.length);
        if (arg === '--file') return argv[i + 1];
    }
    return null;
}

// Transitive closure of `name` + its deps, filtered from `registry` so the result
// preserves the registry's topological order.
function resolveClosure(registry, name) {
    const byName = new Map(registry.map((entry) => [entry.name, entry]));
    const entry = byName.get(name);
    if (!entry) {
        throw new Error(`Unknown seed "${name}". Available: ${registry.map((e) => e.name).join(', ')}`);
    }

    const needed = new Set();
    const visit = (n) => {
        if (needed.has(n)) return;
        needed.add(n);
        byName.get(n).deps.forEach(visit);
    };
    visit(name);

    return registry.filter((e) => needed.has(e.name));
}

async function main() {
    const argv = process.argv.slice(2);
    const file = parseFileFlag(argv);
    const plan = file ? resolveClosure(registry, file) : registry;

    const ctx = {};
    for (const entry of plan) {
        const result = await entry.run(prisma, ctx);
        Object.assign(ctx, result ?? {});
        console.log(`seeded: ${entry.name}`);
    }

    if (!file) {
        await report(prisma);
    }
}

async function report(prisma) {
    const counts = {
        user: await prisma.user.count(),
        admin: await prisma.user.count({ where: { role: 'ADMIN' } }),
        levelPack: await prisma.levelPack.count(),
        chapter: await prisma.chapter.count(),
        level: await prisma.level.count(),
        difficultyPreset: await prisma.difficultyPreset.count(),
        powerDefinition: await prisma.powerDefinition.count(),
        shopItem: await prisma.shopItem.count(),
        questDefinition: await prisma.questDefinition.count(),
        gridPack: await prisma.gridPack.count(),
        gridPuzzle: await prisma.gridPuzzle.count(),
        gridWord: await prisma.gridWord.count(),
    };
    console.log('counts:', JSON.stringify(counts));
}

main()
    .then(() => prisma.$disconnect())
    .catch(async (e) => {
        console.error(e);
        await prisma.$disconnect();
        process.exit(1);
    });
