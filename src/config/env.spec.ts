import { getConfigErrors, readIntEnv, recordConfigError, resetConfigErrors } from './env';

const KEY = 'TEST_INT_ENV';
const RANGE = { min: 10, max: 100 };

describe('readIntEnv', () => {
    beforeEach(() => {
        resetConfigErrors();
        delete process.env[KEY];
    });

    afterAll(() => {
        delete process.env[KEY];
        resetConfigErrors();
    });

    it('returns the fallback when unset', () => {
        expect(readIntEnv(KEY, 50, RANGE)).toBe(50);
        expect(getConfigErrors()).toHaveLength(0);
    });

    it.each(['', '   '])('returns the fallback for blank value %p without recording an error', (raw) => {
        process.env[KEY] = raw;
        expect(readIntEnv(KEY, 50, RANGE)).toBe(50);
        expect(getConfigErrors()).toHaveLength(0);
    });

    it('parses a valid integer', () => {
        process.env[KEY] = '42';
        expect(readIntEnv(KEY, 50, RANGE)).toBe(42);
        expect(getConfigErrors()).toHaveLength(0);
    });

    it('tolerates surrounding whitespace', () => {
        process.env[KEY] = '  42  ';
        expect(readIntEnv(KEY, 50, RANGE)).toBe(42);
        expect(getConfigErrors()).toHaveLength(0);
    });

    // Each of these is silently accepted by a bare Number() call, which is why the
    // reader screens the raw string before parsing.
    it.each([
        ['a decimal', '12.5'],
        ['exponent notation', '1e3'],
        ['a size suffix', '50MB'],
        ['hex', '0x20'],
        ['not a number', 'abc'],
    ])('records an error and falls back for %s', (_label, raw) => {
        process.env[KEY] = raw;
        expect(readIntEnv(KEY, 50, RANGE)).toBe(50);
        expect(getConfigErrors()).toHaveLength(1);
        expect(getConfigErrors()[0]).toContain(KEY);
    });

    it.each([
        ['below the minimum', '9'],
        ['above the maximum', '101'],
        ['negative', '-1'],
    ])('records an error and falls back when %s', (_label, raw) => {
        process.env[KEY] = raw;
        expect(readIntEnv(KEY, 50, RANGE)).toBe(50);
        expect(getConfigErrors()[0]).toContain('must be between 10 and 100');
    });

    it.each([
        ['the minimum', '10', 10],
        ['the maximum', '100', 100],
    ])('accepts %s boundary exactly', (_label, raw, expected) => {
        process.env[KEY] = raw;
        expect(readIntEnv(KEY, 50, RANGE)).toBe(expected);
        expect(getConfigErrors()).toHaveLength(0);
    });

    it('accumulates errors across reads so assertConfig can report them together', () => {
        process.env[KEY] = 'nope';
        readIntEnv(KEY, 50, RANGE);
        recordConfigError('something else');
        expect(getConfigErrors()).toHaveLength(2);
    });
});
