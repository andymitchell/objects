


# Guidance on Testing (general)


**1. Structure & Coverage**
- Derive intent and stakeholder perspectives from docs, proposed types, and API interfaces.
- Nest `describe` blocks to represent these perspectives and boundary contracts (e.g., Consumer API vs Internal AST builder).
- Prioritize by risk (e.g., error cost, data leaks). Cover: happy path, expected errors, edges, forbidden states (e.g., leaking PII in logs, cross-tenant data access), and state/time invariants.

**2. Design & Paradigm (Black-Box / TDD)**
- Because the library is incomplete, test strictly against the **public contract (types/interfaces)**. Never assume or assess internal algorithms. 
- Use DAMP (Descriptive and Meaningful Phrases) naming to express intent. Never reference internal code details (e.g., class names, specific variable names).
- Favor property-based (e.g., 'reversing twice returns original string') and metamorphic (e.g., 'adding a WHERE clause strictly reduces or maintains result size') tests over hardcoded I/O examples.
- Test outcomes, not mechanics. A refactor that preserves behavior must never break a test.
- Assertions must validate the **correctness of values**, not just the presence of fields.

**3. Test Reliability & Data**
- Avoid mocks; use real modules with deterministic fake data. (If external systems are queried, assume an in-memory adapter or Testcontainers will be used).
- No async races; strictly use deterministic/fake timers.
- State mutation must be explicitly bounded (e.g., ensure tests don't pollute the in-memory state for subsequent queries).

# Constraints
* This is exclusively about testing the 'query' part of the library (`./query/**`).
* Query-specific invariants must be considered: Pagination consistency, Sorting stability, Filter commutativity (`A AND B` === `B AND A`), and Idempotency of read operations.

# Steps 

### [ ] Step 1: Update the INTENT.MD with the main consumers / stakeholders of this library and what they're using it for 

The goal is to understand expectations at the boundaries. Interview me about what you think, and let me challenge you. You can also ask questions to try to clarify who the stakeholders are. 

Be declarative, conscise, bullet points. 

Update INTENT.MD with new sections on this

### [ ] Step 2: For each function, identify tests: 

Go through every proposed function, assess its intent, I/O and steps/contract, and identify: 
- tests for the happy path
- tests for likely errors
- tests for edge cases
- tests for forbidden states
- state/time invariants (e.g. idempotency, eventual consistency)
- intent/property invariants

Output to `functions-tests.md`

### [ ] Step 3: Synthesise a skeleton hierarchial outline of tests

Use `functions-tests.md` and `INTENT.MD` to come up with a hierarchy of tests that captures the spirit of 'query' part of the library, especially the interests and expectations of stake holders at the boundary. 

The hierarchy is enforced by `describe` blocks (nested). 

Aim for a hierarchy that would make sense to a senior developer looking at the library, thinking about its intent and what is expected at the boundaries, and that every area is covered. It should prove/convey that every boundary and risk area is covered.

Important: this is high level describe blocks, not yet the tests that'll go within them. 

Output to 'proposed-test-structure.md'

### [ ] Step 4: Define the skeleton tests under each section of the hierarchy 

Using the hierarchy from Step 3 and the deep analysis from Step 2, output the actual skeleton test files (e.g., `xxx.test.ts`).
Deeply use everything you found in `functions-tests.md`

You're going to expand 'Output to 'proposed-test-structure.md'. 

Rules for the skeleton:
- Output nested `describe` blocks containing empty `it` blocks.
- Use DAMP naming for `it` blocks (e.g., `it('preserves sorting order when identical pagination limits are applied sequentially')`).
- Inside each empty `it` block, include a 1-2 line comment specifying the **Given/When/Then** or the **Properties/Arbitraries** required to make this test work (e.g., `// Needs: fast-check arbitrary generating nested AST filters up to depth 5`).
- Ensure no implementation details leak into the test names.

Important: you're still not writing the tests. This is the test names in empty `it` blocks. 

Update 'Output to 'proposed-test-structure.md'. 

### [ ] Step 5: Let Gemini criticise 

Output a prompt for Gemini of the testing outline, with the context of what the library does and its functions (so it understands everything the tests are doing). 

Ask it for critical feedback of the tests. 



