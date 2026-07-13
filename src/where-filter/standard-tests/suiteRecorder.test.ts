import { AcknowledgementCollector } from "./outcomes.ts";
import { makeSuiteRecorder } from "./harness.ts";

/**
 * The battery keys every acknowledged seam by the full name of the test that reported it, so the name is a third
 * of a manifest's identity. These pin that the name is derived from the battery's own registrations and from
 * nothing ambient — the failure that motivated it was a second copy of the test runner in the process, which left
 * every recorded name blank while every assertion still passed.
 */

/** A runner stub that records what was registered. `deferred` reproduces the real collector's two-pass behaviour. */
function fakeRunner(opts: { deferred: boolean }) {
    const registered: { name: string; body: (...a: unknown[]) => Promise<void> | void }[] = [];
    const pending: (() => void)[] = [];
    const sequentialSuites: string[] = [];

    const collect = (name: string, ...rest: unknown[]) => {
        const body = rest.find(a => typeof a === 'function') as (...a: unknown[]) => Promise<void> | void;
        registered.push({ name, body });
    };

    /* eslint-disable @typescript-eslint/no-explicit-any -- deliberate runner stubs cannot structurally match vitest's SuiteAPI/TestAPI */
    const describe = Object.assign(
        (_name: string, factory: () => void) => { if (opts.deferred) pending.push(factory); else factory(); },
        {
            // The real runner offers this; the battery must reach for it so its suites stay sequential.
            sequential: (name: string, factory: () => void) => {
                sequentialSuites.push(name);
                if (opts.deferred) pending.push(factory); else factory();
            },
        },
    ) as any;
    const test = Object.assign(collect, {
        skip: (name: string) => { registered.push({ name: `SKIPPED:${name}`, body: () => { } }); },
        fails: collect,
        each: () => () => { throw new Error('the real runner would have registered these'); },
    }) as any;
    /* eslint-enable @typescript-eslint/no-explicit-any */

    /** Run the factories the runner deferred, exactly as a collector's later pass would. */
    const drain = () => { while (pending.length > 0) pending.shift()!(); };
    return { describe, test, registered, drain, sequentialSuites };
}

describe('the battery names its own tests, without reading the runner', () => {

    test('a seam records the full describe > describe > test path of the test that reported it', async () => {
        const runner = fakeRunner({ deferred: false });
        const { describe: d, test: t, currentTestName } = makeSuiteRecorder(runner.describe, runner.test);

        let seen = '';
        d('11. $regex engine fidelity', () => {
            d('case sensitivity', () => {
                t('11.16 case-sensitive by default', () => { seen = currentTestName(); });
            });
        });

        expect(currentTestName()).toBe('');  // nothing is in flight until a body runs
        await runner.registered[0]!.body();

        expect(seen).toBe('11. $regex engine fidelity > case sensitivity > 11.16 case-sensitive by default');
    });

    test('a nested suite keeps its parent in the path even when the runner defers the parent body', async () => {
        // Vitest collects in two passes: a nested `describe` body runs AFTER the enclosing `describe` call has
        // returned. A recorder that pushed on entry and popped on exit would have dropped the parent by then,
        // silently shortening the name — and every test would still have passed.
        const runner = fakeRunner({ deferred: true });
        const { describe: d, test: t, currentTestName } = makeSuiteRecorder(runner.describe, runner.test);

        let seen = '';
        d('2. Scalar value comparisons', () => {
            d('Numeric edge values (NaN, Infinity, -0)', () => {
                t('Infinity exceeds any finite bound', () => { seen = currentTestName(); });
            });
        });
        runner.drain();

        await runner.registered[0]!.body();
        expect(seen).toBe('2. Scalar value comparisons > Numeric edge values (NaN, Infinity, -0) > Infinity exceeds any finite bound');
    });

    test('sibling suites do not bleed into one another', async () => {
        const runner = fakeRunner({ deferred: true });
        const { describe: d, test: t, currentTestName } = makeSuiteRecorder(runner.describe, runner.test);

        const seen: string[] = [];
        d('A', () => { t('one', () => { seen.push(currentTestName()); }); });
        d('B', () => { t('two', () => { seen.push(currentTestName()); }); });
        runner.drain();

        for (const r of runner.registered) await r.body();
        expect(seen).toEqual(['A > one', 'B > two']);
    });

    test('the name is released once the body finishes, so nothing can be recorded against a test that is not running', async () => {
        const runner = fakeRunner({ deferred: false });
        const { describe: d, test: t, currentTestName } = makeSuiteRecorder(runner.describe, runner.test);

        d('S', () => { t('t', () => { /* body */ }); });
        await runner.registered[0]!.body();

        expect(currentTestName()).toBe('');
    });

    test('a modifier such as test.skip still reaches the runner untouched', () => {
        const runner = fakeRunner({ deferred: false });
        const { describe: d, test: t } = makeSuiteRecorder(runner.describe, runner.test);

        d('S', () => { t.skip('skipped one', () => { /* never runs */ }); });

        expect(runner.registered.map(r => r.name)).toEqual(['SKIPPED:skipped one']);
    });

    test('a test declared with per-test options is still named', async () => {
        // `test(name, options, fn)` is a real vitest overload: the body is the THIRD argument, not the second.
        const runner = fakeRunner({ deferred: false });
        const { describe: d, test: t, currentTestName } = makeSuiteRecorder(runner.describe, runner.test);

        let seen = '';
        d('S', () => {
            (t as unknown as (n: string, o: object, f: () => void) => void)('slow one', { timeout: 30_000 }, () => { seen = currentTestName(); });
        });
        await runner.registered[0]!.body();

        expect(seen).toBe('S > slow one');
    });

    test('a running modifier such as test.fails is named too', async () => {
        const runner = fakeRunner({ deferred: false });
        const { describe: d, test: t, currentTestName } = makeSuiteRecorder(runner.describe, runner.test);

        let seen = '';
        d('S', () => { t.fails('known defect', () => { seen = currentTestName(); }); });
        await runner.registered[0]!.body();

        expect(seen).toBe('S > known defect');
    });
});

describe('the battery refuses registrations it could not attribute a seam to', () => {

    test('the suite is registered as sequential, so a consumer running tests concurrently cannot scramble the names', () => {
        const runner = fakeRunner({ deferred: false });
        const { describe: d, test: t } = makeSuiteRecorder(runner.describe, runner.test);

        d('11. $regex engine fidelity', () => { t('11.1 literal matches', () => { /* body */ }); });

        // Vitest propagates `sequential` from a suite to its tests, so this holds even under `sequence.concurrent: true`.
        expect(runner.sequentialSuites).toEqual(['11. $regex engine fidelity']);
    });

    test('two overlapping test bodies are reported rather than silently mis-attributed', async () => {
        const runner = fakeRunner({ deferred: false });
        const { describe: d, test: t } = makeSuiteRecorder(runner.describe, runner.test);

        let release = () => { };
        const held = new Promise<void>(resolve => { release = resolve; });
        d('S', () => {
            t('first', async () => { await held; });
            t('second', () => { /* would run while `first` is parked */ });
        });

        const first = runner.registered[0]!.body();          // park inside the first body...
        await expect(runner.registered[1]!.body())           // ...then start the second while it is still in flight
            .rejects.toThrow(/two tests ran at once/i);

        release();
        await first;
    });

    test('test.each is refused, because its per-case names are the runner\'s to expand, not ours to guess', () => {
        const runner = fakeRunner({ deferred: false });
        const { describe: d, test: t } = makeSuiteRecorder(runner.describe, runner.test);

        d('S', () => {
            expect(() => t.each([1, 2, 3])('case %s', () => { /* body */ }))
                .toThrow(/test\.each.*cannot be used|cannot be used.*test\.each/i);
        });
    });

    test('test.concurrent is refused, because the test in flight would be ambiguous', () => {
        const runner = fakeRunner({ deferred: false });
        const { describe: d, test: t } = makeSuiteRecorder(runner.describe, runner.test);

        d('S', () => {
            expect(() => (t as unknown as { concurrent: (n: string, f: () => void) => void }).concurrent('c', () => { }))
                .toThrow(/cannot be used inside the battery/i);
        });
    });
});

describe('a seam with no test name is a wiring fault, not a capability gap', () => {

    test('recording a blank test name is refused rather than silently merged into the manifest', () => {
        const collector = new AcknowledgementCollector();

        expect(() => collector.record({ kind: 'unsupported', reason: 'not supported', testName: '' }))
            .toThrow(/blank test name/i);
        expect(() => collector.record({ kind: 'unsupported', reason: 'not supported', testName: '   ' }))
            .toThrow(/blank test name/i);

        // The seam is rejected outright — a manifest must never freeze an unattributable line.
        expect(collector.snapshot()).toEqual([]);
    });

    test('a named seam records exactly one canonical line', () => {
        const collector = new AcknowledgementCollector();

        collector.record({ kind: 'divergence', reason: '#3 $regex case-sensitivity', testName: 'S > t' });

        expect(collector.snapshot()).toEqual(['divergence ::: #3 $regex case-sensitivity ::: S > t']);
    });
});
