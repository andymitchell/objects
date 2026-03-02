## Project

TypeScript (ESM, strict), Zod 4, Vitest, tsup, bun/node.

## TypeScript: Strict Type Practices

- **Single source of truth** — never redeclare a shape that already exists; favour composition.
- **Generics & composition** — build complex types from smaller ones (intersection: `type Plan = BasePlanCore & Timestamped`, generics: `type Plan = Timestamped<PlanCore>`).
- **Derive from Zod** — **If** runtime schemas are needed, they are the source of truth (`z.infer`). Add bidirectional `expectTypeOf` if a separate alias is needed. Colocate schemas with types in separate files.
- **If intersection composition impossible, use `Pick` over brittle `Omit`**
- **Narrow `unknown` with typeguards** — favour zod by using `schema.parse`/`safeParse`; never cast through `unknown`.
- **Avoid lint errors** — `no-explicit-any` and no double assertions (`as unknown as T`); escape-hatch via `eslint-disable` + justification comment.

## Errors

Where possible return errors as values, rather than throwing. 
Handle combining/composing multiple errors that occur in a path. 

## Planning

Favour concision over grammar. Use red-green TDD: write a failing test first, then the minimal code to pass it.

## JSDoc

Help devs and agents instantly, conscisely understand what it's doing and _why_:
* All exported functions/classes: one-line _what_, one-line _why_. (_Why_ should mentally link to intent of module and/or project). `@param`/`@returns` only when non-obvious from names/types. `@example` always. 
* All internal functions: one-line _why_.

When modifying a function, update its JSDoc to match.

## Testing

- Avoid mocks. Use real modules/classes with fake data.
- Property-based testing for invariants where applicable.
- `expectTypeOf` (from Vitest) for compile-time type assertions.

## Module Design

Deep modules with simple interfaces (Surface docs via JSDoc on public exports; keep internals unexposed). Colocate schemas with types (separate files).
