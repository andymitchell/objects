## Project

TypeScript (ESM, strict), Zod 4, Vitest, tsup, bun/node.

## TypeScript: Strict Type Practices

- **Single source of truth** — never redeclare a shape that already exists; favour composition.
- **Generics & composition** — build complex types from smaller ones (intersection: `type Plan = BasePlanCore & Timestamped`, generics: `type Plan = Timestamped<PlanCore>`).
- **Derive from Zod** — **If** runtime schemas are needed, they are the source of truth (`z.infer`). Add bidirectional `expectTypeOf` if a separate alias is needed. Colocate schemas with types in separate files.
- **If intersection composition impossible, use `Pick` over brittle `Omit`**
- **Narrow `unknown` with typeguards** — favour zod by using `schema.parse`/`safeParse`; never cast through `unknown`.
- **Avoid lint errors** — `no-explicit-any` and no double assertions (`as unknown as T`); escape-hatch via `eslint-disable` + justification comment.

## Architecture: Deep Modules & Context Preservation

**Core Principle**: A deep module hides a lot behind a **minimal public surface** focused on one domain.
This is the primary architectural constraint: minimize the context window an agent must load to understand the codebase.

### 1. Consuming Modules (Read Protocol)
When learning an unfamiliar module, read in this exact order. **Stop loading files into context once you have enough info:**
1. `index.ts` — Public API surface.
2. `types.ts` / `schemas.ts` — Data contracts.
3. **JSDocs on exports** — Intent, parameters, examples.
4. **Tests** — Concrete usage (*Caution: high context cost*).
5. **Implementation** — *Absolute last resort.*

**The Surface Rule**: If you must read internals to use a module, the design is broken. **Fix the surface** (improve JSDocs, types, exports) rather than silently relying on internal knowledge.

### 2. Write Protocol (Authoring)
- **Strict Encapsulation**: Export ONLY what external consumers need via a barrel (`index.ts`).
- **No Deep Imports**: `import { x } from '../module/internal'` is an architectural violation.
- **Self-Documenting**: All public exports MUST have comprehensive JSDocs.
- **Colocate Contracts**: Keep `types.ts` and `schemas.ts` together at the feature root.

### 3. File Constraints
- **Domain-Driven**: Organize by feature (`/billing`), never by type (`/controllers`).
- **Size Limits**: 200–400 LOC typical. **800 LOC hard max.**
- **Extract Aggressively**: MANY SMALL FILES > FEW LARGE FILES. Extract utilities when limits are reached, but keep them internal.

## Planning

Favour concision over grammar (keep context window small).

## Testing

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

### TDD

Drive development through a tight, iterative red-green loop to ensure tests validate actual, concrete behavior:

- **Iterate test-by-test:** Write one failing test for a specific intent, then immediately write the minimal implementation to make it pass. 
- **Ground in reality:** Cycle continuously between writing a single intention test and its implementation stub. This prevents testing imagined states.
- **Verify continuously:** Run `npm typecheck`, `npm test`, and `npm lint`, fixing any failures before moving to the next behavior.

*Why:* Iterating one test at a time grounds your code in actual behavior, whereas bulk-writing tests upfront risks testing imagined or invalid states.

## JSDoc

Help devs and agents instantly, conscisely understand what it's doing and _why_:
* All exported functions/classes: one-line _what_, one-line _why_. (_Why_ should mentally link to intent of module and/or project). `@param`/`@returns` only when non-obvious from names/types. `@example` always. 
* All internal functions: one-line _why_.

When modifying a function, update its JSDoc to match.

## Error Handling

- Where possible return errors as values, rather than throwing. 
- Handle errors explicitly at every level
    - Handle combining/composing multiple errors that occur in a path. 
- Provide user-friendly error messages in UI-facing code
- Messages don't leak sensitive data

## Security

- NEVER hardcode secrets in source code
- ALWAYS use environment variables or a secret manager
- Suggest rate limiting on all endpoints


## Data Handling

### Immutability (CRITICAL)

ALWAYS create new objects, NEVER mutate existing ones:

```
// Pseudocode
WRONG:  modify(original, field, value) → changes original in-place
CORRECT: update(original, field, value) → returns new copy with change
```

Rationale: Immutable data prevents hidden side effects, makes debugging easier, and enables safe concurrency.

### Input Validation

ALWAYS validate at system boundaries with Zod:
- Validate all user input before processing
- Never trust external data (API responses, user input, file content)

