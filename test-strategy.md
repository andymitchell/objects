# Test Strategy for New Features, Retrofits, and Hardening

A convergent testing strategy that uses top-down intent analysis and bottom-up implementation reality to produce high-confidence test suites. Designed for LLM-assisted development but applicable generally.

> **Footnote on longevity:** This strategy compensates for current LLM deficits — tendency to generate shallow/redundant tests, lose sight of intent during implementation, and fail to self-check coverage. As agents improve, some of these steps (especially the explicit convergence and hardening passes) will become unnecessary. Treat this as a living document; retire steps as tooling matures.

---

## Core Idea

Two paths converge on correctness:

1. **Top-down:** Stakeholder intent, boundary expectations, and a hierarchical test skeleton predict what the system *should* do.
2. **Bottom-up:** Implementation reveals what the system *actually* does, exposing assumptions the skeleton got wrong.

The skeleton predicts the contract. Implementation reveals reality. **Conflict resolution is the key human intervention** — each conflict is a divergence between intent and reality that must be consciously decided.

---

## Scenarios

This strategy covers three scenarios. Each follows the same phases but enters at a different point.

| Scenario | Starting point | Entry phase |
|---|---|---|
| **Greenfield** | New feature, no code yet | Phase 1 |
| **Retrofit** | Existing feature gaining a new implementation (e.g., adding SQLite support to a Postgres-only feature) | Phase 3 (existing code provides the spec) |
| **Hardening** | Existing feature with existing tests, needs confidence upgrade | Phase 2 (existing code + tests provide the spec; goal is to restructure and fill gaps without losing existing coverage) |

---

## Phases

### Phase 1: System Planning

*Greenfield only. Retrofit/Hardening skip to Phase 2 or 3.*

Plan enough of the system to have:
- A clear statement of **what it solves and why**
- Proposed **public API surface** (function signatures, types, key data flows)
- Enough detail to reason about boundaries, but not a full implementation

This is the plan/spec document. It doesn't need to be perfect — it needs to be sufficient for Phase 2.

**Output:** Plan document (types, function signatures, algorithms, file structure).

---

### Phase 2: Intent & Stakeholder Analysis

Identify the consumers/stakeholders of the feature and what they expect at the boundaries.

1. **List stakeholders** — who calls this code? What are they trying to achieve? (e.g., "App developer paginating a list," "SQL query builder composing WHERE + ORDER BY," "Admin filtering by date range")
2. **Boundary expectations** — for each stakeholder, what must be true? What must never happen? What's the most expensive failure?
3. **For hardening:** Derive the above from existing code, types, docs, and tests. The existing test suite is an implicit (possibly incomplete) statement of intent.

**Output:** Intent document with stakeholders, their expectations, and risk areas.

---

### Phase 3: Function-Level Test Analysis

For every public function (and key internal functions), analyse:

| Category | What to identify |
|---|---|
| **Happy path** | Core use cases working correctly |
| **Likely errors** | Mistakes a real user would make |
| **Edge cases** | Boundary conditions, empty inputs, zero/null/undefined, max values |
| **Forbidden states** | Security violations, data leaks, invariant breaks |
| **Invariants** | Idempotency, pagination completeness, sort stability, commutativity |

For each function: document its intent, I/O contract, and the specific tests in each category.

**For hardening:** Also catalogue what the existing tests already cover. Map existing tests to these categories to find gaps.

**Output:** `functions-tests.md` — per-function test inventory.

---

### Phase 4: Hierarchical Test Skeleton

Synthesise Phases 2 and 3 into a hierarchy of `describe` blocks that:
- Is organised by **stakeholder concern and boundary contract**, not by implementation detail
- Would make sense to a senior developer asking "is everything covered?"
- Proves coverage of every risk area identified in Phase 2

Then populate with skeleton `it` blocks:
- DAMP names expressing intent (never reference class names, variable names, etc.)
- 1-2 line Given/When/Then comments inside each empty `it` block
- No implementation — these are placeholders

**Rules:**
- Test names must survive a refactor unchanged (test outcomes, not mechanics)
- Assertions must validate **correctness of values**, not just presence of fields
- Favour property-based and metamorphic tests over hardcoded I/O

**For hardening:** Map existing tests into the new hierarchy. Identify tests that exist but don't fit (possible noise) and gaps where no test exists.

**Output:** `proposed-test-structure.md` with skeleton test files.

---

### Phase 5: Standard Tests (when applicable)

**Trigger:** The feature has (or will have) multiple implementations of the same logical interface — e.g., JS runtime + SQL backends, or multiple storage adapters.

**Pattern:**
1. Define a uniform `execute` signature that all implementations satisfy
2. Write `standardTests(config)` — a function (not a test file) that declares all behavioral tests against `execute`
3. One test file per implementation. Each implements `execute` (setup data, run operation, return results) then calls `standardTests()`
4. Return `undefined` for unsupported features — the suite skips with an explicit acknowledgement, not silent failure

**What goes in standard tests:** Behavioral/data-result tests that are environment-agnostic (sorting, pagination, filtering, invariants).

**What stays per-file:** Implementation-specific concerns (SQL string shape, parameter style, dialect differences, input validation).

**Weakness:** Tests the lowest common denominator. Mitigated by per-file tests for specialised concerns and the skip mechanism for known divergences.

**Retrofit detection:** When a feature that had 1 implementation gains a 2nd, this is a refactor trigger. Extract shared behavioral tests into `standardTests`, keep implementation-specific tests per-file.

**Output:** `standardTests.ts` + per-implementation test files.

---

### Phase 6: Implementation

Build the feature (or, for hardening, implement the skeleton tests against existing code).

- For greenfield: implement in phases, running tests continuously
- For hardening: implement skeleton tests one section at a time, verifying each passes or identifying genuine bugs
- Tests written during implementation may reveal that the skeleton's assumptions were wrong — **this is expected and valuable**

**Output:** Working code + working tests.

---

### Phase 7: Convergence — Skeleton vs Reality

Compare the skeleton (Phase 4) against what was actually built and tested (Phase 6).

Identify conflicts:
- Skeleton assumed X, implementation does Y
- Skeleton predicted an error case that can't happen (or missed one that can)
- Types/signatures changed during implementation
- Skeleton tests that are now redundant with standard tests

**For each conflict, decide:**
- Is the skeleton wrong (update the test)?
- Is the implementation wrong (fix the code)?
- Is the intent ambiguous (ask the human)?

**This is the critical human review point.** Each conflict is a place where top-down thinking and bottom-up reality diverged. The resolution is a conscious decision about correctness.

**Output:** Aligned test suite — skeleton updated to match reality, implementation fixed where skeleton was right.

---

### Phase 8: Hardening

Multiple independent passes to increase confidence. Each can be done by a different agent or LLM. Run them in sequence; each pass's output feeds the next.

#### 8a. Alternate LLM Critique

Send the test suite (with enough context about what the code does) to a different LLM. Ask for critical feedback: missing coverage, wrong assumptions, tests that don't actually test what they claim.

**Why it works:** Different models have different blind spots. A fresh perspective catches things the authoring agent normalised.

**Output:** List of gaps/issues to address.

#### 8b. Stakeholder Persona Review

For each stakeholder identified in Phase 2, role-play as that persona **one at a time** (to focus attention). Ask: "As [stakeholder], do these tests give me confidence that my expectations are met? What's missing?"

**Why one at a time:** LLMs lose focus when asked to juggle multiple perspectives simultaneously. Serial review per persona produces deeper coverage.

**Output:** Per-stakeholder gap list.

#### 8c. Production Risk Audit

For each function, ask: "What's the most expensive thing that could go wrong in production?" Then verify there's a test that would catch it.

This is risk-prioritised, not coverage-prioritised. A function with 95% coverage but no test for its catastrophic failure mode is undertested.

**Output:** Risk-ranked gap list.

#### 8d. Negative Test Audit

Review every forbidden state, security concern, and "must never happen" from Phase 2. Verify each has an explicit *rejection* test (not just the absence of a positive test).

Common misses: SQL injection via crafted inputs, invalid state transitions, data leaking across tenants, PII in logs.

> This pass is a good candidate for delegation to a cheaper/faster model with the right context, since it's mechanical verification rather than creative analysis.

**Output:** List of missing rejection tests.

#### 8e. Redundancy Check

For each test, ask: "If I deleted this test, would any other test catch the same bug?" If yes, the test may be noise. If no, it's essential.

> Also a good candidate for a cheaper model — it's comparing test descriptions and assertions, not reasoning about architecture.

**Output:** List of redundant tests to consider removing.

---

## Checklist Summary

For quick reference — the phases as a checklist:

```
[ ] Phase 1: System planning (greenfield only)
[ ] Phase 2: Intent & stakeholder analysis
[ ] Phase 3: Function-level test analysis
[ ] Phase 4: Hierarchical test skeleton
[ ] Phase 5: Standard tests (if multiple implementations)
[ ] Phase 6: Implementation
[ ] Phase 7: Convergence — resolve skeleton vs reality conflicts
[ ] Phase 8: Hardening
    [ ] 8a. Alternate LLM critique
    [ ] 8b. Stakeholder persona review (one at a time)
    [ ] 8c. Production risk audit
    [ ] 8d. Negative test audit
    [ ] 8e. Redundancy check
```

---

## Principles

- **Test the contract, not the code.** A refactor that preserves behavior must never break a test.
- **Errors as values.** Functions return errors, not throw. Tests verify error returns explicitly.
- **Real data over mocks.** Use real modules with fake data. In-memory databases for SQL. No mocking the thing under test.
- **Immutability.** Verify inputs aren't mutated. Verify test state doesn't leak between cases.
- **DAMP names.** Test names express intent in plain language. Never reference implementation details.
- **Property-based where possible.** "Reversing twice returns original" beats "reverse([1,2,3]) === [3,2,1]".

## Additional Ideas

* Final hardening post implementation of tests: 
    * Revisit each function, and ask if we missed any tests for it
        * Use cheap LLM to ask the question per function
        * Collate its answers and pass to a powerful LLM to assess 
* We haven't added testing of type assertions. That comes towards the end too, once types are locked in. It's to prevent skew from the original intent. 