# Goal

Create robust testing, based on intent of the write actions library, 

There will be:
- standard-tests that any implementation must adhere to (e.g. `applyWritesToItems`). These will be lowest-common denominator tests of intent (not implementation specific... specific implementations can do this later).
    - It's important to know we'll be doing SQL based 'applyWritesToSqlDb' type functions in the future, so that's the lowest common denominator is to have tests that would apply in all scenarios. 
- type assertion tests for the major exported types 

# Relevant Files

@./types.ts
@./write-action-schemas.ts
@./applyWritesToItems/types.ts
@./applyWritesToItems/schemas.ts
@./applyWritesToItems/applyWritesToItems.ts
@./applyWritesToItems/applyWritesToItems.test.ts
@../where-filter/types.ts
@../where-filter/types.test.ts
@../where-filter/standardTests.ts
@../where-filter/matchJavascriptObject.test.ts


# Context 

The current testing is in @./applyWritesToItems/applyWritesToItems.test.ts and is directly tied the narrow implementation of `applyWritesToItems` (e.g. with a big focus on immer usage). This goes against good design and doesn't set us up for alternative implementations. 

Most importantly, it is NOT designing with the spirit/intent of the library in mind. 

## Reminder: Good Testing Practices

Always test the **intent**.

### Code

**1. Structure & Coverage**
- Derive intent and stakeholder perspectives from docs, code, types, and APIs; + interview me. 
- Nest `describe` blocks to represent these perspectives and boundary contracts (e.g. API)
- Prioritize by risk (e.g. error cost). Cover: happy path, errors, edges, forbidden states (e.g., PII logs), and state/time invariants (e.g. idempotency, eventual consistency).

**2. Design & Paradigm**
- Use DAMP naming to express intent. Never reference code details (e.g. class names).
- Favor property-based (e.g. 'reversing twice returns original string') and metamorphic (e.g. 'sorting then sorting again doesn’t change result') tests over hardcoded I/O examples. 
- Test outcomes; never implementation details. A refactor that preserves behavior must never break a test.
- Assertions must validate the **correctness of values**, not just the presence of fields.

**3. Test Reliability**
- Avoid mocks; use real modules with fake data. 
- No async races; strictly use deterministic/fake timers.

### Compile-Time Type Assertions

**1. Alignment & Intent**
- Highlight deviance between TS types and intent (stakeholder perspectives from docs, code, types, and APIs); ask me to resolve mismatches.
- Treat types as a **caller contract**: what we promise consumers they can and cannot do.

**2. Type Coverage**
- **Strictness & Inference**:
    - Assert exact type equivalence (e.g. `Expect<Equal>`). 
    - Prevent accidental widening, `any`/`unknown` leaks, and forced generic arguments. Verify correct overload resolution.
- **Negatives & Soundness**:
    - Use `@ts-expect-error` to enforce rejection of invalid shapes, excess properties, and forbidden states. 
    - Type-test and quarantine all unsafe escape hatches (`as`, `any`, `unknown`).
- **Transformations & Variance**:
    - Test metamorphic generic transforms (ensure mapped types preserve constraints, `readonly`, `?`, and discriminants). 
    - Assert safe function variance at boundaries (e.g. callback contravariance).
**Control Flow & Exhaustiveness**:
    - Assert discriminated unions narrow correctly.
    - Enforce exhaustive pattern matching (unhandled paths must resolve to `never`).


# Spirit of Write Actions
_To be filled in_

# Current Tests Good Parts
_To be filled in_

# Learn From Where-Filter: Best Practices To Keep

# Implementation Plan
_To be filled in_



# Project Plan

_Instructions: Check the Phases off as you go. Stop after each phase to ask me whether to continue to the next phase. If you create files as part of completing a Phase, update the Phase with links to them and explain what they contain (so a future LLM can resume)._

# [ ] Phase 0

Read around Write Actions and capture the spirit of what they're doing: the write payload types, the response types, and a concrete example in `applyWritesToItems` (but remember there will later be other applier functions). 

The goal here is to capture the intent of what the library is doing, so it can be tested. Consider different stake holders and their desired use cases.

Output this research to `Spirit of Write Actions`. 

# [ ] Phase 1

Analyse the current tests for `applyWritesToItems` and the type assertion tests. Conscisely record which tests were good (according to our criteria) and the intent of the tests should be retained going forward. 

Output to `Current Tests Good Parts` 

# [ ] Phase 2

Look at how the Where-Filter tests are structured @../where-filter/standardTests.ts. These were done specifically to capture the intent of that where-filter module, breaking it up into describe blocks. This is an example of good practice. 

Note how it works: each apply function setting up the tests (e.g. a sqlite table) and for each test (e.g. setting initial data in a fresh table), then executing the test on the function and assessing whether when run (directly in the case of applyWritesToItems; or have SQL executed in the case of writeActionToSql), the data source (table, raw JS) has been correctly modified. Note how `{ status: 'unsupported' }` is used. 

I want you to capture a conscise imperative set of instructions of what made it a good test suite, with examples - to dictate to our own planning here. 
Also capture any specific tests/sections that represent a good idea to use here. 

Then do the same for type assertion tests. 

Output this to `Learn From Where-Filter: Best Practices To Keep`

# [ ] Phase 3

Write a plan for generating much better tests:
- standardTests (capture the spirit of the spec of Write Actions)
- specific implementation tests (e.g. the immer parts of `applyWritesToItems`)
- type assertion tests

Make use of `Reminder: Good Testing Practices`, `Spirit of Write Actions`, `Current Tests Good Parts`, `Learn From Where-Filter: Best Practices To Keep`.


Output to `Implementation Plan`.

# [ ] Phase 4

Implement the plan in `Implementation Plan`