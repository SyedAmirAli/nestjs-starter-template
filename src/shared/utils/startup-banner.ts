export interface BannerInfo {
    name: string;
    version: string;
    env: string;
    url: string;
    health: string;
    dbConnected: boolean;
    docs?: string;
    routes?: string[];
}

const c = {
    reset: '\x1b[0m',
    cyan: '\x1b[36m',
    dim: '\x1b[2m',
    bold: '\x1b[1m',
    green: '\x1b[32m',
    red: '\x1b[31m',
};

/**
 * Renders a compact, dependency-free boxed banner for the terminal.
 * Width is computed from the plain text, so ANSI colors (zero display width)
 * are applied afterwards without breaking alignment.
 */
export function printStartupBanner(info: BannerInfo): void {
    const db = info.dbConnected ? 'connected' : 'down';

    const meta: string[] = [
        `Env       ${info.env}`,
        `URL       ${info.url}`,
        `Health    ${info.health}`,
        `Database  ${db}`,
    ];
    if (info.docs) {
        meta.splice(2, 0, `Docs      ${info.docs}`);
    }

    const sections: string[][] = [[`${info.name}  v${info.version}`, 'AI Career OS'], meta];
    if (info.routes?.length) {
        sections.push(['Routes', ...info.routes.map((r) => `  ${r}`)]);
    }

    const all = sections.flat();
    const width = Math.max(...all.map((l) => l.length));
    const line = (ch: string, l: string, r: string) => `${l}${ch.repeat(width + 4)}${r}`;
    const pad = (l: string) => `│  ${l}${' '.repeat(width - l.length)}  │`;

    const rows: string[] = [line('─', '┌', '┐')];
    sections.forEach((sec, i) => {
        if (i > 0) rows.push(line('─', '├', '┤'));
        sec.forEach((l) => rows.push(pad(l)));
    });
    rows.push(line('─', '└', '┘'));

    let out = rows.map((row, i) => (i === 1 ? `${c.bold}${row}${c.reset}${c.cyan}` : row)).join('\n');
    out = `${c.cyan}${out}${c.reset}`;
    out = out.replace(`Database  ${db}`, `Database  ${info.dbConnected ? c.green : c.red}${db}${c.reset}${c.cyan}`);

    console.log(`\n${out}\n`);
}
