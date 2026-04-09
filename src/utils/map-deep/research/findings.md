# mapDeep: Approach Comparison for Immutable Leaf Replacement

## Goal

Find the fastest correct way to replace specific leaf values deep in a JSON-serializable object, returning a new object immutably (never mutating the original).

Use case: replacing sentinel strings like `"<USEREMAIL>"` with actual values in deeply nested config/data objects.

## Approaches Tested

| # | Approach | How it works |
|---|---|---|
| 1 | JSON string replace | `JSON.stringify` → `replaceAll` → `JSON.parse` |
| 2 | Inline copy-on-write | Recursive walk; only allocates new objects/arrays along the dirty path when a replacement is found |
| 3 | structuredClone + mutate | Check if sentinel exists; if so, `structuredClone` the whole tree and mutate in place |
| 4 | JSON clone + mutate | Same as #3 but clone via `JSON.stringify`/`JSON.parse` |
| 5 | JSON.stringify with replacer | Use the `replacer` callback in `JSON.stringify` to swap values during serialization, then `JSON.parse` |

## Result: Inline Copy-on-Write (#2) Wins

**Approach #2 is 3–6x faster than all alternatives across every scenario tested, and is the only approach with zero allocation when no replacement is needed.**

### Performance

| Scenario | #1 JSON replace | #2 COW | #3 structuredClone | #4 JSON clone | #5 JSON replacer |
|---|---|---|---|---|---|
| 50% sentinel, 1 per object | 4.46x | **1.00x** | 2.74x | 3.28x | 5.46x |
| 100% sentinel, 1 per object | 5.41x | **1.00x** | 5.54x | 5.91x | 6.32x |
| 100% sentinel, 5 per object | 5.05x | **1.00x** | 4.98x | 5.87x | 6.06x |

*(Relative to fastest. Lower = better.)*

### Correctness

| Check | #1 | #2 | #3 | #4 | #5 |
|---|---|---|---|---|---|
| Replaces sentinel values | Pass | Pass | Pass | Pass | Pass |
| Correct replacement count | Pass | Pass | Pass | Pass | Pass |
| Does not mutate original | Pass | Pass | Pass | Pass | Pass |
| Preserves sentinel in keys (key-safety) | **FAIL** | Pass | Pass | Pass | Pass |

**Approach #1 is disqualified**: `replaceAll` on the serialized JSON string cannot distinguish keys from values. If an object key happens to equal the sentinel, it gets replaced too.

## Why COW Wins

1. **Zero-alloc fast path.** When no sentinel exists in a subtree, COW returns the original reference with no copying. Every other approach either always serializes (#1, #5) or must still traverse to check (#3, #4).

2. **Minimal allocation on match.** COW only copies nodes along the path from root to the changed leaf. A single replacement in a tree of ~4096 leaves copies ~6 nodes (one per depth level). Every other approach copies the entire tree.

3. **Single pass.** COW finds and replaces in one traversal. Approaches #3 and #4 require two passes (detect, then clone + mutate) — which collapses their performance in the 100% sentinel scenario.

## Benchmark Methodology

The benchmark was designed to produce trustworthy, fair comparisons:

- **200 fixtures** per scenario, each a nested tree of depth 6, breadth 4 (~4096 leaf nodes per object).
- **Three scenarios** covering different workloads:
  - 50% of objects contain sentinel (mixed/realistic workload)
  - 100% contain sentinel, 1 occurrence (pure replacement speed)
  - 100% contain sentinel, 5 occurrences (multi-replacement scaling)
- **No input-cloning overhead in timing.** Immutable approaches (COW, JSON-based) receive frozen originals directly. Mutating approaches (#3, #4) receive pre-cloned batches built before the timing loop. This ensures we measure only the approach itself.
- **Sentinel injection via leaf-path sampling.** The fixture generator builds a clean tree, collects all leaf paths, then shuffles and replaces exactly N of them. This guarantees the exact sentinel count per fixture (verified by counting occurrences post-generation).
- **Approach ordering is shuffled** per scenario to reduce JIT compilation and GC bias from running in a fixed order.
- **GC forced between approaches** when Node is run with `--expose-gc`.
- **5 warmup + 50 measured iterations** per approach per scenario.
- **Correctness validated before timing**: sentinel fully removed, correct replacement count, original not mutated, key-safety (sentinel as object key preserved).
- **Deep-frozen fixtures** catch accidental mutation during correctness checks.

## Recommendation

Use the **inline copy-on-write recursive walker** for `mapDeep`. It is:

- The fastest approach by a wide margin (3–6x)
- Correct (values-only replacement, key-safe, immutable)
- Zero-cost when no replacement is needed (returns original reference)
- Simple to implement (~30 lines)
- No dependencies

The only caveat is recursion depth: for pathologically deep objects (>10,000 levels), an iterative stack-based variant of the same algorithm would avoid stack overflow. This is unlikely to matter for typical JSON data.
