# The mingo oracle

`mingo` is an independent implementation of the MongoDB query language. This module runs it as a **secondary
oracle** against the reference matcher, so the suite has one check on MongoDB conformance that shares no code and
no assumptions with anything else in the package.

## Why it exists

The conformance battery and the fuzz properties (`WF-P0`…`WF-P13`) all measure each engine against
`matchJavascriptObjectReference` — *this package's own matcher*. That is exactly right for what they are for:
catching one engine drifting from another.

It is also **blind by construction to a shared misunderstanding of MongoDB**. If the reference is wrong about
what a filter means, every engine is wrong the same way, they agree with each other, and the battery stays green.
The bug is invisible precisely because it is everywhere. Worse, in the JS reference consumer the seam under test
*is* the reference, so the differential property there compares the reference to itself — trivially true, and
worth nothing.

The mingo oracle fills that hole. A disagreement between it and the reference is evidence about *conformance*,
where every other property is evidence about *consistency*.

## How it works

`WF-P14` runs in the JS reference consumer only, enabled by `fuzz: { secondaryOracle: 'mingo' }`. For each
generated `(row, filter)` it asks both the reference and mingo, and collects every disagreement rather than
failing on the first.

- **Its own generator** (`generator.ts`). It cannot reuse the main fuzz generator — see *The generator lesson*.
- **Its own iteration budget.** Disagreements occur at roughly 0.2% of iterations, so a budget sized for the SQL
  consumers (where each iteration compiles and executes a statement) would pass by luck. This property is pure
  JS and cheap, so it runs orders of magnitude more.
- **Minimised, then grouped.** A disagreement is first shrunk to the guilty logic arm, then deduplicated by
  filter *shape* (`filterShape.ts`: operators and structure, operands stripped). Without shrinking, a logic node
  disagrees merely because one arm does — which both buries the cause and lets an accepted divergence in one arm
  claim a genuine bug riding along in a sibling.
- **The residual must be empty.** A disagreement no register explains fails the run, and the failure message is
  the report.

## How the two oracles co-exist

- `matchJavascriptObjectReference` is the authority for **engine agreement**.
- `mingo` is the authority for **MongoDB conformance**.
- **Neither is the final authority. A real `mongod` is** — see `standard-tests/mongo-truth/`, run with
  `npm run test:mongo-truth`.

That last point is not a formality. Of the findings this oracle has produced, one was **mingo being wrong while
this package was right**: taking the oracle's word for it would have meant "fixing" behaviour that already
matched MongoDB. An independent oracle earns trust per finding, not wholesale.

## What to do when they disagree

Run it against a real `mongod` first — add the case to the `mongo-truth` corpus and execute it — **before
changing any code**. Then file it in exactly one of three registers, never a fourth (`DECISIONS.md` #12):

| Register | Meaning | What to do |
|---|---|---|
| `KNOWN_DIVERGENCES` | `mongod` agrees with mingo; we differ **deliberately** | Cite a numbered `MONGO-DIVERGENCES.md` entry. This is a decision. |
| `PENDING_BUGS` | `mongod` agrees with mingo; we differ **by accident** | This is a debt. Pin it with a test describing the wrong answer. **Delete the entry when fixed — never re-explain it.** |
| `MINGO_QUIRKS` | `mongod` agrees with **us**; mingo is the outlier | The oracle is blind here. Record it, so silence is not mistaken for conformance. |

Keeping "divergence" and "bug" apart is the whole point: a divergence is a decision, a bug is a debt, and
collapsing them is how a known bug quietly becomes accepted behaviour. Deleting a `PENDING_BUGS` entry **is** its
regression test — with nothing left to claim the disagreement, a regression surfaces immediately as an
unexplained shape.

An ignore predicate must be as **narrow** as the divergence it cites. An over-broad one is the single failure
that would make this whole apparatus decorative: it files a real bug under an accepted divergence and the run
goes green. So each predicate carries a test proving it fires on its own construct *and* stays silent on its
neighbours, plus a sabotage proving an unrelated defect still reds the run.

## The generator lesson

> **A generator built to make N engines agree cannot test conformance to an (N+1)th.**

The main fuzz generator's profile is deliberately uniform: it never emits `$type`, `$regex`, `$all: []`, a
comparison operator on an array field, or `$exists`/`$type` inside an `$elemMatch` body. Those were excluded
because the three **engines** disagreed there — which is *precisely* where this package is most likely to depart
from **MongoDB**. Reusing it against a new oracle would have produced a confident green that proved nothing.

So audit what a generator can actually reach before trusting its verdict. **A green from an oracle that cannot
reach the interesting territory is worse than no oracle, because it looks like evidence.**

Hence the calibration requirement, which is the inverse of the usual instinct: the run **must** reproduce the
divergences already documented. If a broad generator surfaces *none* of them, the harness is broken — it has not
reached the interesting language — and that is a louder signal than any disagreement it could report.

The oracle's generator is kept **separate** rather than folded into the shared one, because extending the shared
generator would shift the seeded random stream for every other property and move every saboteur's declared trip.

## mingo's own blind spots

Recorded in `MINGO_QUIRKS`, because an oracle is only as good as its own conformance:

- **`$type` does not traverse arrays.** The MongoDB manual is explicit that `{tags: {$type: 'string'}}` matches
  `{tags: ['a']}`; mingo answers `false`, which is the same answer this package gives. So it silently *shares*
  divergence #1 and can never witness it. #1 stands on the manual, not on this oracle. Should mingo fix it, #1
  will begin surfacing as an unexplained disagreement — which is correct.
- **A path crossing two arrays is mis-evaluated.** For `groups.subtags`, mingo answers `false` where `mongod`
  and this package both answer `true`. Here mingo is confidently wrong and we are right.

Such paths are **excluded from the generator, not filtered from its output**. Filtering would hide the oracle's
defect inside the list of *our* divergences, which is how a blind spot becomes mistaken for conformance. The
coverage that costs is carried instead by example-based tests (§4) and by the `mongo-truth` corpus — a fuzz
property cannot cover what its oracle cannot answer, and pretending otherwise is worse than admitting the gap.
