// Countries seed — loads prisma/seeds/jsons/countries.json into the `countries` table.
//
// Run everything:  yarn db:seed
// Run only this:   yarn db:seed --file=countries
//
// IDEMPOTENT. Upserts by `id`, so ids stay stable across re-runs — languages.json references
// these same ids as `countryId`, and a re-generated id would orphan those rows.

const path = require('node:path');
const fs = require('node:fs');
const { Color } = require('../../dist/helper/Color');

const JSON_PATH = path.resolve(__dirname, 'jsons', 'countries.json');

function toCountryRow(country) {
    return {
        id: country.id,
        capital: country.capital ?? null,
        code: country.code ?? null,
        dialCode: country.dialCode ?? null,
        continent: country.continent ?? null,
        flag: country.flag ?? null,
        largeFlag: country.largeFlag ?? null,
        title: country.title ?? null,
        isActive: country.isActive ?? true,
        unicode: country.unicode ?? null,
        emoji: country.emoji ?? null,
        currency: country.currency ?? null,
        currencySymbol: country.currencySymbol ?? null,
        currencyName: country.currencyName ?? null,
        timezone: country.timezone ?? null,
        name: country.name ?? undefined,
        timezones: country.timezones ?? [],
        languages: country.languages ?? [],
        currencies: country.currencies ?? undefined,
        nativeNames: country.nativeNames ?? [],
        currencyData: country.currencyData ?? [],
        createdAt: country.createdAt ? new Date(country.createdAt) : undefined,
    };
}

async function seedCountries(prisma) {
    const raw = fs.readFileSync(JSON_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const countries = Array.isArray(parsed) ? parsed : (parsed.data ?? []);

    let created = 0;
    let updated = 0;

    for (const country of countries) {
        const row = toCountryRow(country);
        const existing = await prisma.country.findUnique({ where: { id: row.id }, select: { id: true } });

        await prisma.country.upsert({
            where: { id: row.id },
            create: row,
            update: row,
        });

        if (existing) updated++;
        else created++;
    }

    Color.print(
        `  countries: ${created} created, ${updated} updated (${countries.length} total)`,
        'green',
    );
    return { countriesSeeded: countries.length };
}

module.exports = { seedCountries };
