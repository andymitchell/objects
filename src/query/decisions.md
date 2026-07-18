# Query ordering decisions

## dec-bigint-tagged-encoding

A bigint sort value encodes as `{ $bigint: '<decimal>' }` — a reserved, JSON-safe tagged shape — never as a bare string or number. A bare decimal string is indistinguishable from a genuine user string, so any string form eventually mis-brackets someone's data; a number is lossy past 2^53. The tagged object survives a cursor round-trip with its type intact, and the shape is reserved: a raw object of exactly this shape is treated as an encoded bigint by the ordering contract.

## dec-bigint-numeric-bracket

Bigints order inside the finite-number bracket, compared by exact numeric value — not in a bracket of their own. Real Postgres drivers hydrate a single BIGINT column as a mix of JS numbers (small values) and JS bigints (large values); a separate bigint bracket would order all numbers before all bigints and silently misorder that real data. Merging is also a genuine total order: every member maps to an exact real value. Equal values of different types (10 vs 10n) tie and fall to the primary-key tiebreak.

## dec-object-table-bigint-rejection

Object (JSON-document) tables loudly reject a sort key whose schema classifies it as bigint — for plain sort, after_pk, and after_boundary alike. JSON cannot carry a bigint, so such a key is a contradiction the caller's serialisation layer must resolve; the previous behaviour (silently casting unknowable storage with `::bigint`) risked a plausible-looking wrong walk, and a correct rejection beats one. The guarantee follows schema *classification* (including transparent wrappers like nullable/optional); compositions with no clean scalar family (multi-arm unions, pipes) stay on the long-standing kind-less path, which promises no cross-engine ordering for any type family — and no bigint value can physically reach it through JSON storage.

## dec-bigint-boundary-strict-binding

A pagination boundary for a bigint-kind key accepts only the tagged encoded form or an exactly-representable safe integer, within int64 range; everything else — unsafe-magnitude numbers, non-integers, bare decimal strings, out-of-range values — is rejected loudly at build time. Those rejected shapes are precisely what lossy or misconfigured driver hydration produces (doubles past 2^53, int8-as-string), and accepting them would let a walk continue silently wrong from a corrupted anchor. Failing the first page loudly, with a message naming the hydration fix, is the contract.

A consequence for primary keys: `PrimaryKeyValue` is `string | number`, so the boundary's pk — including the synthetic pk tiebreaker — can never carry the tagged form. A bigint-kind primary-key column therefore supports keyset pagination only while pk values fit safe-integer precision (≤ 2^53 − 1), failing loudly beyond it. Widening `PrimaryKeyValue` to admit bigint is a separate, deliberate future decision, not an oversight.

## dec-encode-snapshots

Encoding never returns a caller-supplied object: a tagged input is validated with a single read and copied into a fresh frozen snapshot. A hostile getter or proxy can produce a valid value once and then throw or change; if the comparator ever re-read the caller's object, ordering could throw mid-sort and break the contract's totality. The cost is that tagged encodings are structurally — not reference — idempotent, which is deliberate.
