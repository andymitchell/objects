# SQL Where-Filter Compiler

Compiles MongoDB-style filter objects (`WhereFilterDefinition`) into parameterised SQL WHERE clauses for JSON/JSONB columns.

## Algorithm

1. **Validate** the incoming filter against `WhereFilterSchema`

2. **Decompose** multi-key objects into implicit `$and` arrays

   A filter with multiple keys is semantically "all must match", so it's normalised into an explicit `$and`:

   ```
   Input:  { name: 'Andy', age: { $gt: 30 } }
   Output: { $and: [{ name: 'Andy' }, { age: { $gt: 30 } }] }
   ```

3. **Recursively walk** logic operators (`$and`, `$or`, `$nor`)

4. At each **leaf**, delegate to a dialect-specific `IPropertyTranslator` which:
   - Resolves the dot-prop path to a SQL accessor
   - Converts the value comparison into a type-controlled SQL fragment with parameterised placeholders

   Postgres example:
   ```
   Leaf input:  path = "contact.name", filter = { $gt: 'M' }
   SQL output:  "(data->'contact'->>'name')::text > $1"  with args ['M']
   ```

5. **Reassemble** fragments into a single WHERE clause string with an ordered argument array

## Array handling

When a filter path passes through an array (detected via the Zod schema's `TreeNodeMap`), the compiler:

- **Spreads** the array using a dialect-specific table function (`jsonb_array_elements` / `json_each`)
- Wraps the comparison in an `EXISTS (SELECT 1 FROM ... WHERE ...)` subquery
- For compound filters on array elements, uses `COUNT(DISTINCT CASE WHEN ...)` to ensure different elements can satisfy different conditions

## Dialect strategy

A shared engine (`compileWhereFilter`) handles the structural recursion. Each dialect provides an `IPropertyTranslator` implementation that knows:

- How to convert dot-prop paths to SQL column accessors
- How to generate placeholders (`$N` for Postgres, `?` for SQLite)
- How to spread arrays and cast types

## Error model

Errors are returned as values (`{ success: false, errors: [...] }`), never thrown. Callers must check `result.success` before accessing the WHERE clause.
