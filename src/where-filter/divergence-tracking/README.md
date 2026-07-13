# divergence-tracking

One test file per entry in `../MONGO-DIVERGENCES.md`, pinning the documented behaviour on every engine
(JS matcher, SQLite, Postgres) so a claim consumers plan around cannot quietly become fiction.

## When a test here fails

A red test means a documented claim has stopped holding — do **not** edit the test to green. Instead:
1. The failing file's header names the entry's slug; find the entry in `../MONGO-DIVERGENCES.md` by that slug.
2. Check recent history for the change that moved behaviour: `git log --oneline -- src/where-filter/`.
3. Check what MongoDB actually does: `npm run test:mongo-truth` boots a real `mongod` (the `mongodb` dev dependency).
4. Present the case to the maintainer to decide: a regression (fix the code) or a deliberate change
   (update or retire the entry **and** its test in the same commit).

## Conventions

- Every entry in `MONGO-DIVERGENCES.md` carries a `**Slug**: \`kebab-case\`` line directly under its
  `## N.` heading. Headings keep their numbers (the frozen capability manifests cite `#N`); test files
  reference entries **by slug**, never by number.
- Each entry — active *and* retired — is pinned by exactly one `<slug>.test.ts` file here. A retired
  entry's file guards the opposite claim: the behaviour now *conforms*, and red means the divergence
  has **reappeared**.
- `registry.test.ts` enforces the 1:1 mapping in both directions (an entry without a file, an orphan
  file, or a file that doesn't name its own slug all go red), and freezes the entry count so adding a
  new divergence forces adding its pin.
- `engine-seams.ts` runs one `(object, filter, schema)` triple against each engine and returns a typed
  `EngineVerdict` (match result, typed refusal, environmental limit, or throw), so tests can assert
  *how* an engine declined, not just that it did.
