/**
 * Pins MONGO-DIVERGENCES.md — slug `type-checks-field-not-elements` (#1): `$type` checks the field's
 * own runtime type, so an array field has type 'array', never the type of its elements (MongoDB
 * matches if any element has the named type).
 *
 * If this file goes red, the documented claim has stopped holding. Do NOT edit the test to green:
 * follow the failure routine in divergence-tracking/README.md (entry by slug → recent commits →
 * real MongoDB via `npm run test:mongo-truth` → present the case to the maintainer).
 */
import { describe, test, expect } from "vitest";
import { z } from "zod";
import { allEngines, matched, usePostgresLifecycle } from "./engine-seams.ts";

usePostgresLifecycle();

const ContactSchema = z.object({ id: z.string(), name: z.string(), tags: z.array(z.string()) });
const contact = { id: '1', name: 'Alice', tags: ['a', 'b'] };

describe('divergence `type-checks-field-not-elements` (#1)', () => {

    describe.each(allEngines)('on $name', ({ match }) => {

        test('$type "string" on an array of strings fails — the field itself is an array (MongoDB would match on the elements)', async () => {
            expect(await match(contact, { tags: { $type: 'string' } }, ContactSchema)).toEqual(matched(false));
        });

        test('the documented workaround names the field type: $type "array" matches', async () => {
            expect(await match(contact, { tags: { $type: 'array' } }, ContactSchema)).toEqual(matched(true));
        });

        test('a scalar field answers its own type — the divergence is arrays-only', async () => {
            expect(await match(contact, { name: { $type: 'string' } }, ContactSchema)).toEqual(matched(true));
        });

        test('an array field does not take a wrong scalar type either: $type "number" on string[] fails', async () => {
            expect(await match(contact, { tags: { $type: 'number' } }, ContactSchema)).toEqual(matched(false));
        });
    });
});
