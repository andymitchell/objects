# Goal

The @standardTests.ts is vital in that is verifies every WhereFilter matching component (e.g. matchJavascriptObject, postgresWhereClauseBuilder, sqliteWhereClauseBuilder). It's the dominant full test for a WhereFilterDefinition.



# Relevant Files

@standardTests.ts
@types.ts
@schemas.ts
@consts.ts
@typeguards.ts
@matchJavascriptObject.ts
@postgresWhereClauseBuilder.ts
@sqliteWhereClauseBuilder.ts
@whereClauseEngine.ts

# Context

A `WhereFilterDefinition` is a serialisable JSON definition of a WHERE clause that can be used to filter Javascript objects (see @matchJavascriptObject.ts as an example).

It's inspired by MongoDB.

The current testing suite is good; but it's not exhaustive enough for 100% confidence that the tests match the structure.

# Test philosophy

Tests should capture the **spirit** of the spec, not just its letter. A developer reading the spec should think "yes, that's what I'd want tested." For each spec area, cover:
1. **Happy path** — the intended use working correctly
2. **Common failures** — the mistakes a real user would make
3. **Edge cases** — boundary conditions that reveal semantic intent (empty arrays, null/undefined values, type mismatches, empty filters)

Avoid technical fuss-potting: don't test compiler-enforced constraints or purely theoretical scenarios. Every test should correspond to a real concern a developer would have when using or implementing the filter.

# Acknowledged-unsupported tests

Some spec behaviors are unsupported by certain implementations (e.g. SQLite can't do X, Postgres handles Y differently). The current mechanism returns `undefined` to silently skip. This is a hidden-bug risk: a skip is invisible unless you read the test code.

Replace the silent `undefined`-return skip pattern with an explicit **`acknowledgedUnsupported`** mechanism:
- When a test calls the matcher and gets `undefined` back, it should log/label clearly: _"[ACKNOWLEDGED UNSUPPORTED] {implementation}: {reason}"_
- The test name or a wrapper should make it visible in test output that this condition was **considered** but is known-unsupported for that implementation
- This serves two purposes: (a) a developer reading tests sees the condition has been thought of, (b) if an implementation later adds support, the acknowledged-unsupported flag becomes a prompt to enable the real test

Design a small helper (e.g. `expectOrAcknowledgeUnsupported(result, expected, reason)`) to replace the scattered `if (result === undefined) { console.warn('Skipping'); return; }` pattern.

# Cross-implementation divergence

The three implementations (JS, Postgres, SQLite) may naturally diverge on edge cases due to engine semantics:
- **NULL propagation**: SQL treats NULL differently from JS `undefined`/`null`
- **Collation/ordering**: Postgres uses locale-aware collation; JS uses code-point ordering; SQLite varies by config
- **Numeric precision**: JS floats vs SQL numeric types
- **Type coercion**: SQLite's loose typing vs Postgres's strict JSONB typing

Tests should explicitly probe these divergence points. Where behavior legitimately differs, use the `acknowledgedUnsupported` mechanism. Where behavior _should_ be consistent, test all implementations equally.

# The WhereFilterDefinition spec
_To be filled in_

# The Current standardTests structure and coverage
_To be filled in_

# Gap analysis: where the spec is not fully tested in standardTests
_To be filled in: do high level then specific tests_

# Constraint

# Plan

_Check the Phases off as you go. Stop after each phase to ask me whether to continue to the next phase. If you create files as part of completing a Phase, update the Phase with links to them and explain what they contain (so a future LLM can resume)._

# [ ] Phase 0: Pre-check

Run the full existing test suite and confirm all tests pass before any changes. If tests are failing, stop and resolve before proceeding.

# [ ] Phase 1

Analyse the types for WhereFilterDefinition **and** the reference implementation in @matchJavascriptObject.ts (since behavioral semantics like compound array per-key-OR, atomic logic-in-array, multi-operator ANDing are defined by implementation, not types alone). Create an accurate spec in this document under 'The WhereFilterDefinition spec'.

# [ ] Phase 2

Analyse the current standardTests.ts and build a mental model of what it's testing, in a hierarchy. Aim to be descriptive in relation to the spec - i.e. goal/property driven. Write up in this document under 'The Current standardTests structure and coverage'.

# [ ] Phase 3

Do the gap analysis to see where the current standardTests are failing to exhaustively check a matching function conforms to the spec (including edge cases).
Do it in two broad steps:
1) Look at the high level of the spec and what's present in the file. The test file should be driven by the spec and so should match its broad structure.
2) For each section of the spec identified, look at the specific details and identify where the spec is lacking a test in the standardTests. Pay special mind to achieving full coverage, and especially to edge cases. Follow the test philosophy: happy path, common failures, edge cases. Every proposed test should be something a developer reading the spec would think "yes, that needs testing."

Also identify gaps in:

**Validation/error handling**: The shared `whereClauseEngine.ts` performs filter validation. Currently only 1 error-handling test exists. Identify what validation paths are untested (invalid filters, malformed operators, etc).

**Security/hardening**: Review the existing attack-handling tests and identify missing coverage beyond prototype pollution, including:
- SQL injection via crafted filter values (for Postgres/SQLite builders)
- Resource exhaustion via deeply nested `$and`/`$or` chains
- Non-JSON-safe filter values (functions, symbols, circular references)
- ReDoS risk if `$contains` were extended

**Cross-implementation divergence**: Flag areas where SQL engine semantics may naturally differ from JS (NULL propagation, collation, numeric precision, type coercion) and ensure tests probe these points.

The purpose of this gap analysis is to lay the foundations to fix it in a later phase. So this is identifying problems that will be addressed.

# [ ] Phase 4

Restructure standardTests.ts to use nesting describe blocks to match the spec hierarchy identified in `The WhereFilterDefinition spec`. It should give a shape/structure that gives confidence to a developer reading the tests that all parts are covered.

At this stage: relocate tests and rename test descriptions to align with spec terminology. Do not add or remove test logic.

Run the full test suite after restructuring to confirm nothing broke (scoping, shared setup, etc).

# [ ] Phase 5

Implement the missing tests identified in `Gap analysis: where the spec is not fully tested in standardTests`.

**Order of implementation**:
1. Introduce the `acknowledgedUnsupported` helper and migrate existing `undefined`-skip patterns to use it
2. Critical semantic gaps (behaviors that are spec'd but untested)
3. Cross-implementation divergence probes
4. Validation/error handling paths
5. Security/hardening tests
6. Remaining edge cases

Run tests after each batch. Each test runs against all implementations via standardTests's parameterized structure.

Follow the test philosophy throughout: happy path, common failures, edge cases. If a test wouldn't make a developer think "good, that's covered" when reading the suite, reconsider whether it belongs.

# [ ] Phase 6

_Deferred (human-only task, not for Claude): compare standardTests.ts against an independent review to find remaining gaps. Will also run through Gemini. Ignore this phase during execution._

