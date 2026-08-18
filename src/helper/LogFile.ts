// LogFile.ts — structured, timestamped, tagged log-file writer.
// Ported/curated from acusolo's HelperClass.appendToLogFile / customLog / logger strategy.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Color } from './Color';
import { PRODUCTION } from '@/config/dotenv';

const SEPARATOR = '-'.repeat(100);
const LOG_EXTENSIONS = ['.log', '.json', '.txt'];

/**
 * Append-oriented file logger.
 *
 * Log files live under {@link LogFile.baseDir} (default `<cwd>/logs`). Each `append`
 * entry is prefixed with a human timestamp and a tag, and objects are pretty-printed
 * with a circular-structure-safe fallback (e.g. Axios request/response objects).
 *
 * Usage:
 *   LogFile.logger('INGEST', { documentId, versionNo });   // console + file
 *   LogFile.append('ingestion.log', payload, 'PARSE');      // file only
 *   LogFile.write('snapshot.json', bigObject);              // overwrite as JSON
 */
export class LogFile {
    /** Base directory for all log files. Override once at startup if needed. */
    static baseDir: string = path.join(process.cwd(), 'logs');

    /** Absolute path for a log file, creating the parent directory if missing. */
    static resolve(filename: string): string {
        const filePath = path.join(LogFile.baseDir, filename);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        return filePath;
    }

    /** Overwrites a file with pretty-printed JSON. Returns the path, or null on failure. */
    static write(filename: string, data: unknown = {}): string | null {
        try {
            const filePath = LogFile.resolve(filename);
            fs.writeFileSync(filePath, LogFile.stringify(data), 'utf-8');
            return filePath;
        } catch (error) {
            console.error('LogFile.write error:', error);
            return null;
        }
    }

    /**
     * Appends one timestamped, tagged entry to a log file.
     *
     * @param disableInProduction skip writing when NODE_ENV=production (default true).
     * @returns true when written (or intentionally skipped), false on error.
     */
    static append(filename: string, data: unknown = {}, tag = 'LOG', disableInProduction = true): boolean {
        if (PRODUCTION && disableInProduction) return true;

        try {
            const filePath = LogFile.resolve(filename);

            // If an array of one item was passed, unwrap it for cleaner output.
            let d: unknown = data;
            if (Array.isArray(data)) d = data.length > 1 ? data : (data as unknown[])[0];

            const body =
                typeof d === 'string' ? `\n${SEPARATOR}\n${d}\n${SEPARATOR}` : LogFile.stringify(d);

            const now = new Date();
            const timestamp = `${now.toLocaleDateString()} ${now.toLocaleTimeString('en-US', { hour12: true })}`;
            const entry = `[${timestamp} (${tag})]: ${body} \n\n`;

            fs.appendFileSync(filePath, entry, 'utf-8');
            return true;
        } catch (error) {
            console.error('LogFile.append error:', error);
            return false;
        }
    }

    /** True when a line containing `tag` already exists in the log file. */
    static checkTag(filename: string, tag: string): boolean {
        const filePath = path.join(LogFile.baseDir, filename);
        if (!fs.existsSync(filePath)) return false;
        return fs.readFileSync(filePath, 'utf-8').includes(tag);
    }

    /**
     * Convenience: append to a named file, deriving the tag from the first string arg.
     * `LogFile.custom('ingest', 'PARSE', payload)` -> tag "PARSE", data = payload.
     */
    static custom(filename: string, ...args: unknown[]): boolean {
        const name = LOG_EXTENSIONS.some((ext) => filename.endsWith(ext)) ? filename : `${filename}.log`;
        const first = args[0] ?? null;
        const data = args.length > 1 ? args.slice(1) : first;
        const tag = typeof first === 'string' ? first : 'LOG';
        return LogFile.append(name, data, tag, false);
    }

    /** Append to the default `app.log` (never skipped in production). */
    static log(...args: unknown[]): boolean {
        return LogFile.custom('app.log', ...args);
    }

    /** Log to both the console (yellow tag) and `app.log`. */
    static logger(tag: string, ...args: unknown[]): boolean {
        console.log(Color.yellow(tag, { bold: true }), ...args);
        return LogFile.log(tag, ...args);
    }

    /** JSON.stringify with a circular-structure-safe fallback (logs keys only). */
    private static stringify(data: unknown): string {
        try {
            return JSON.stringify(data, null, 4);
        } catch {
            return JSON.stringify(
                {
                    message: 'Non-serializable data (circular structure). Logging keys only.',
                    keys: data && typeof data === 'object' ? Object.keys(data) : null,
                },
                null,
                4,
            );
        }
    }
}

export default LogFile;
