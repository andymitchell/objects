import type { MatchJavascriptObjectInTesting } from "./harness.ts";
import { standardTests } from "./index.ts";
import { AcknowledgementCollector } from "./outcomes.ts";

/**
 * A structural guard proving every seam verdict in the battery is routed through an acknowledgement-aware
 * helper, never a raw `expect(await seam(...)).toBe(x)`.
 *
 * The seam may answer `undefined` to mean "this implementation cannot express that filter" — a legitimate
 * acknowledged skip. A raw assertion reads that sentinel as a wrong answer and fails a faithful partial
 * implementation for being honest. The lapse is invisible to the in-repo engines, which express everything and
 * so never return the sentinel; only a consumer that DOES return it feels the break.
 *
 * This matcher expresses NOTHING, so every seam call in the battery yields the sentinel. The helpers
 * acknowledge it, the malformed-filter channel accepts it as the required rejection (`errorsAsValues`), and the
 * fuzz properties skip. Any raw assertion reintroduced anywhere in the battery meets `expect(undefined).toBe(…)`
 * and fails HERE, in this file, naming itself.
 */
const expressesNothing: MatchJavascriptObjectInTesting = async () => undefined;

const acknowledgements = new AcknowledgementCollector();

standardTests({
    test,
    expect,
    matchJavascriptObject: expressesNothing,
    implementationName: 'all-undefined-probe',
    errorsAsValues: true,
    fuzz: { iterations: 1 },
    acknowledgements,
});

test('the probe reached the seam en masse, so a green run is not a vacuous one', () => {
    // A floor, not a pin: the battery only grows, and every acknowledgement-routed case raises this. It guards
    // the failure mode where the sections stop reaching the seam at all, leaving the probe green by doing
    // nothing. Set below the count observed when written, so adding cases never forces an edit here.
    expect(acknowledgements.snapshot().length).toBeGreaterThan(600);
});
