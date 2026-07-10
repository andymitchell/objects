import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgJsonbAccessor, pgQuoteLiteral } from "./pgJsonbAccessor.ts";

/**
 * A jsonb key is arbitrary runtime text — a `z.record` lets a caller name one anything. These tests assert
 * against a real Postgres that such a key reaches its own member and no other, so quoting is proved rather
 * than reasoned about.
 */
let db: PGlite;
beforeAll(async () => { db = new PGlite(); await db.waitReady; });
afterAll(async () => { await db.close(); });

/** Read the member at `segments` out of a stored object, exactly as an emitter would address it. */
async function extract(stored: Record<string, unknown>, segments: readonly string[]): Promise<unknown> {
    const json = pgQuoteLiteral(JSON.stringify(stored));
    const accessor = pgJsonbAccessor(`${json}::jsonb`, segments, { asText: true });
    const result = await db.query<{ v: unknown }>(`SELECT ${accessor} AS v`);
    return result.rows[0]!.v;
}

/** Keys that would each escape an unquoted literal, or a literal quoted under the wrong assumption. */
const HOSTILE_KEYS = [
    'simple',
    "O'Brien",
    'a"b',
    'a.b',
    "a.b'c",
    "x' OR TRUE --",
    'x"];SELECT',
    "x'); DROP TABLE t;--",
    'back\\slash',
    'trailing\\',            // an odd trailing backslash consumes the closing quote of an ordinary literal
    "\\' OR TRUE --",        // and then the rest of the key becomes SQL
    'escape\\n',             // a literal backslash-n, which an ordinary literal would turn into a newline
    '',
    'sp ace',
    'emoji\u{1F600}',
] as const;

describe('a jsonb key is addressed as data, whatever characters it holds', () => {

    test.each(HOSTILE_KEYS.map(key => [JSON.stringify(key), key] as const))(
        'the key %s addresses its own member',
        async (_name, key) => {
            expect(await extract({ [key]: 'HIT' }, [key])).toBe('HIT');
        }
    );

    test('a key addresses only its own member, never a neighbour', async () => {
        expect(await extract({ "O'Brien": 'target', innocent: 'other' }, ["O'Brien"])).toBe('target');
        expect(await extract({ innocent: 'v' }, ['absent'])).toBe(null);
    });

    test('a hostile key cannot reach a member it does not name', async () => {
        // Were the key spliced in as syntax rather than data, `OR TRUE` would make this row match anything.
        expect(await extract({ innocent: 'v' }, ["x' OR TRUE --"])).toBe(null);
        expect(await extract({ innocent: 'v' }, ["x'); DROP TABLE t;--"])).toBe(null);
    });

    test('a key deep in a path is quoted like any other', async () => {
        expect(await extract({ 'a.b': { "O'Brien": 'deep' } }, ['a.b', "O'Brien"])).toBe('deep');
    });

    test('a key is addressed the same way where a backslash begins an escape', async () => {
        // `standard_conforming_strings` is a session setting. Turned off, a backslash starts an escape in an
        // ordinary literal, so a key ending in one eats the closing quote and the rest of the key becomes SQL,
        // and a key holding a literal `\n` silently addresses a different member. Neither depends on the
        // setting once the literal says so itself.
        await db.exec('SET standard_conforming_strings = off');
        try {
            for (const key of HOSTILE_KEYS) {
                expect(await extract({ [key]: 'HIT' }, [key])).toBe('HIT');
            }
            expect(await extract({ innocent: 'v' }, ["\\' OR TRUE --"])).toBe(null);
        } finally {
            await db.exec('SET standard_conforming_strings = on');
        }
    });
});

describe('the rendered accessor', () => {

    test('intermediate steps yield jsonb and the last yields text, when text is asked for', () => {
        expect(pgJsonbAccessor('data', ['contact', 'name'], { asText: true })).toBe(`(data->E'contact'->>E'name')`);
    });

    test('a structural leaf stays jsonb throughout', () => {
        expect(pgJsonbAccessor('data', ['contact', 'tags'], { asText: false })).toBe(`(data->E'contact'->E'tags')`);
    });

    test('a single-segment path reads the column directly', () => {
        expect(pgJsonbAccessor('data', ['tags'], { asText: false })).toBe(`(data->E'tags')`);
        expect(pgJsonbAccessor('data', ['name'], { asText: true })).toBe(`(data->>E'name')`);
    });

    test('a quote in a key is doubled', () => {
        expect(pgQuoteLiteral("O'Brien")).toBe(`E'O''Brien'`);
    });

    test('a backslash in a key is doubled', () => {
        expect(pgQuoteLiteral('back\\slash')).toBe(`E'back\\\\slash'`);
        expect(pgQuoteLiteral("both\\'")).toBe(`E'both\\\\'''`);
    });

    test('an ordinary key is quoted exactly like a hostile one', () => {
        // Uniform quoting is the safety property: no reader has to decide which keys deserve care.
        expect(pgQuoteLiteral('plain')).toBe(`E'plain'`);
        expect(pgQuoteLiteral('')).toBe(`E''`);
    });
});
