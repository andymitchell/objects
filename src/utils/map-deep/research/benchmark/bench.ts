/**
 * Benchmark: deeply replacing a leaf value in JSON-serializable objects.
 *
 * Approaches:
 *   1. Full JSON round-trip (stringify → string replace → parse)
 *   2. Inline copy-on-write recursive walker
 *   3. structuredClone on first match, then mutate
 *   4. JSON clone on first match, then mutate
 *   5. JSON.stringify with replacer → parse
 *
 * Design choices:
 *   - Fixtures are pre-cloned into per-iteration batches so the timing loop
 *     measures only the approach itself, not input isolation.
 *   - COW (#2) is immutable by design — it receives frozen originals directly,
 *     removing unfair cloning overhead.
 *   - Approach ordering is shuffled per scenario to reduce JIT/GC bias.
 *   - GC is forced between approaches when --expose-gc is available.
 *   - Sentinel injection uses a reliable leaf-slot strategy.
 *   - Multi-sentinel fixtures test approaches under heavier replacement load.
 */

const SENTINEL = "<USEREMAIL>";
const REPLACEMENT = "user@example.com";

// ---------------------------------------------------------------------------
// Fixture generation
// ---------------------------------------------------------------------------

function randStr(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  const len = 3 + Math.floor(Math.random() * 8);
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function randLeaf(): string | number | boolean | null {
  const r = Math.random();
  if (r < 0.4) return randStr();
  if (r < 0.6) return Math.floor(Math.random() * 1000);
  if (r < 0.8) return Math.random() > 0.5;
  return null;
}

/**
 * Build a nested tree, then inject sentinels by collecting all leaf paths
 * and randomly replacing `sentinelCount` of them.
 */
function generateFixture(
  depth: number,
  breadth: number,
  sentinelCount: number,
): Record<string, unknown> {
  // Step 1: build a clean tree with no sentinels.
  function build(level: number): unknown {
    if (level >= depth) return randLeaf();
    const useArray = Math.random() > 0.5;
    if (useArray) {
      const arr: unknown[] = [];
      for (let i = 0; i < breadth; i++) arr.push(build(level + 1));
      return arr;
    }
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < breadth; i++) obj[`k${i}`] = build(level + 1);
    return obj;
  }

  const root = build(0) as Record<string, unknown>;
  if (sentinelCount === 0) return root;

  // Step 2: collect all leaf paths.
  type Path = (string | number)[];
  const leafPaths: Path[] = [];

  function collectLeaves(node: unknown, path: Path): void {
    if (node === null || typeof node !== "object") {
      leafPaths.push([...path]);
      return;
    }
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) collectLeaves(node[i], [...path, i]);
    } else {
      for (const key of Object.keys(node as Record<string, unknown>)) {
        collectLeaves((node as Record<string, unknown>)[key], [...path, key]);
      }
    }
  }
  collectLeaves(root, []);

  // Step 3: shuffle and pick `sentinelCount` leaf paths to replace.
  for (let i = leafPaths.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [leafPaths[i], leafPaths[j]] = [leafPaths[j], leafPaths[i]];
  }
  const chosen = leafPaths.slice(0, Math.min(sentinelCount, leafPaths.length));

  for (const path of chosen) {
    let node: unknown = root;
    for (let i = 0; i < path.length - 1; i++) {
      node = (node as Record<string, unknown>)[path[i] as string];
    }
    const lastKey = path[path.length - 1];
    (node as Record<string, unknown>)[lastKey as string] = SENTINEL;
  }

  return root;
}

// ---------------------------------------------------------------------------
// Approach 1: Full JSON round-trip with string replace
// ---------------------------------------------------------------------------

function approach1_jsonStringReplace(obj: unknown): unknown {
  const str = JSON.stringify(obj);
  // WARNING: This matches `"<USEREMAIL>"` as a quoted JSON token.
  // It will also replace occurrences inside object KEYS, not just values.
  // This is a known correctness flaw tested below.
  const replaced = str.replaceAll(`"${SENTINEL}"`, `"${REPLACEMENT}"`);
  return JSON.parse(replaced);
}

// ---------------------------------------------------------------------------
// Approach 2: Inline copy-on-write walker
// ---------------------------------------------------------------------------

function approach2_inlineCOW(obj: unknown): unknown {
  if (obj === SENTINEL) return REPLACEMENT;
  if (obj === null || typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    let copy: unknown[] | undefined;
    for (let i = 0; i < obj.length; i++) {
      const child = obj[i];
      const mapped = approach2_inlineCOW(child);
      if (mapped !== child) {
        if (!copy) copy = obj.slice();
        copy[i] = mapped;
      }
    }
    return copy ?? obj;
  }

  let copy: Record<string, unknown> | undefined;
  const keys = Object.keys(obj as Record<string, unknown>);
  for (const key of keys) {
    const child = (obj as Record<string, unknown>)[key];
    const mapped = approach2_inlineCOW(child);
    if (mapped !== child) {
      if (!copy) copy = { ...(obj as Record<string, unknown>) };
      copy[key] = mapped;
    }
  }
  return copy ?? obj;
}

// ---------------------------------------------------------------------------
// Approach 3: structuredClone on match, then mutate
// ---------------------------------------------------------------------------

function hasSentinel(obj: unknown): boolean {
  if (obj === SENTINEL) return true;
  if (obj === null || typeof obj !== "object") return false;
  if (Array.isArray(obj)) return obj.some(hasSentinel);
  return Object.values(obj as Record<string, unknown>).some(hasSentinel);
}

function mutateInPlace(obj: unknown): void {
  if (obj === null || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (obj[i] === SENTINEL) obj[i] = REPLACEMENT;
      else mutateInPlace(obj[i]);
    }
    return;
  }
  const rec = obj as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (rec[key] === SENTINEL) rec[key] = REPLACEMENT;
    else mutateInPlace(rec[key]);
  }
}

function approach3_structuredClone(obj: unknown): unknown {
  if (!hasSentinel(obj)) return obj;
  const clone = structuredClone(obj);
  mutateInPlace(clone);
  return clone;
}

// ---------------------------------------------------------------------------
// Approach 4: JSON clone on match, then mutate
// ---------------------------------------------------------------------------

function approach4_jsonClone(obj: unknown): unknown {
  if (!hasSentinel(obj)) return obj;
  const clone = JSON.parse(JSON.stringify(obj));
  mutateInPlace(clone);
  return clone;
}

// ---------------------------------------------------------------------------
// Approach 5: JSON.stringify with replacer → parse
// ---------------------------------------------------------------------------

function approach5_jsonReplacer(obj: unknown): unknown {
  const str = JSON.stringify(obj, (_key, value) =>
    value === SENTINEL ? REPLACEMENT : value,
  );
  return JSON.parse(str);
}

// ---------------------------------------------------------------------------
// Approach 6: mapDeep (production implementation with compiled rules)
// ---------------------------------------------------------------------------

import { mapDeep } from '../../mapDeep.ts';
import type { MapDeepValueRule } from '../../types.ts';

const mapDeepRules: MapDeepValueRule[] = [
  { action: 'replace-value', current: SENTINEL, replace: REPLACEMENT }
];

function approach6_mapDeep(obj: unknown): unknown {
  return mapDeep(obj, mapDeepRules);
}

// ---------------------------------------------------------------------------
// Correctness check
// ---------------------------------------------------------------------------

function deepContains(obj: unknown, target: string): boolean {
  if (obj === target) return true;
  if (obj === null || typeof obj !== "object") return false;
  if (Array.isArray(obj)) return obj.some((v) => deepContains(v, target));
  return Object.values(obj as Record<string, unknown>).some((v) => deepContains(v, target));
}

function countOccurrences(obj: unknown, target: string): number {
  if (obj === target) return 1;
  if (obj === null || typeof obj !== "object") return 0;
  if (Array.isArray(obj)) return obj.reduce((sum: number, v) => sum + countOccurrences(v, target), 0);
  return Object.values(obj as Record<string, unknown>).reduce(
    (sum: number, v) => sum + countOccurrences(v, target),
    0,
  );
}

/** Check that keys containing the sentinel are NOT replaced (values-only). */
function deepContainsKey(obj: unknown, target: string): boolean {
  if (obj === null || typeof obj !== "object") return false;
  if (Array.isArray(obj)) return obj.some((v) => deepContainsKey(v, target));
  const rec = obj as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (key === target) return true;
    if (deepContainsKey(rec[key], target)) return true;
  }
  return false;
}

function checkCorrectness(
  name: string,
  fn: (obj: unknown) => unknown,
  fixtures: unknown[],
  expectedSentinelCounts: number[],
): boolean {
  let passed = true;
  for (let i = 0; i < fixtures.length; i++) {
    const input = JSON.parse(JSON.stringify(fixtures[i]));
    const result = fn(input);

    // Must not contain sentinel in values after replacement
    if (deepContains(result, SENTINEL)) {
      console.log(`  ✗ ${name}: sentinel still present in fixture ${i}`);
      passed = false;
      continue;
    }

    // If fixture had sentinels, result must contain that many replacements
    if (expectedSentinelCounts[i] > 0) {
      const replacementCount = countOccurrences(result, REPLACEMENT);
      if (replacementCount !== expectedSentinelCounts[i]) {
        console.log(
          `  ✗ ${name}: expected ${expectedSentinelCounts[i]} replacements in fixture ${i}, got ${replacementCount}`,
        );
        passed = false;
        continue;
      }
    }

    // Original must not be mutated
    if (deepContains(fixtures[i], REPLACEMENT)) {
      console.log(`  ✗ ${name}: original was mutated in fixture ${i}`);
      passed = false;
    }
  }
  if (passed) console.log(`  ✓ ${name} correctness OK`);
  return passed;
}

/**
 * Test that approach correctly handles sentinel appearing as an object KEY.
 * Only values should be replaced; keys must be preserved as-is.
 */
function checkKeyCorrectness(
  name: string,
  fn: (obj: unknown) => unknown,
): boolean {
  const obj = { [SENTINEL]: "normalValue", nested: { [SENTINEL]: SENTINEL } };
  const input = JSON.parse(JSON.stringify(obj));
  const result = fn(input);

  const hasOrigKey = deepContainsKey(result, SENTINEL);
  // The value of nested[SENTINEL] should be replaced, but the key should remain
  const rec = result as Record<string, unknown>;
  const nested = rec["nested"] as Record<string, unknown> | undefined;

  if (!hasOrigKey) {
    console.log(`  ✗ ${name}: KEY was incorrectly replaced (should only replace values)`);
    return false;
  }
  if (nested && nested[SENTINEL] !== REPLACEMENT) {
    console.log(`  ✗ ${name}: VALUE under sentinel key was not replaced`);
    return false;
  }
  console.log(`  ✓ ${name} key-safety OK`);
  return true;
}

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------

interface BenchResult {
  name: string;
  totalMs: number;
  opsPerSec: number;
}

// Access global gc if available (node --expose-gc)
const gc = (globalThis as Record<string, unknown>).gc as (() => void) | undefined;

/**
 * Benchmark an approach.
 * - `mutatesInput`: if true, pre-clone fixtures into per-iteration batches.
 *   If false (COW), pass frozen originals directly — no cloning overhead.
 */
function bench(
  name: string,
  fn: (obj: unknown) => unknown,
  fixtures: unknown[],
  warmupIters: number,
  measuredIters: number,
  mutatesInput: boolean,
): BenchResult {
  // Pre-build cloned batches for mutating approaches
  let batches: unknown[][] | undefined;
  if (mutatesInput) {
    batches = [];
    for (let iter = 0; iter < warmupIters + measuredIters; iter++) {
      batches.push(fixtures.map((f) => JSON.parse(JSON.stringify(f))));
    }
  }

  // Warmup
  for (let iter = 0; iter < warmupIters; iter++) {
    const inputs = mutatesInput ? batches![iter] : fixtures;
    for (const f of inputs) {
      fn(f);
    }
  }

  if (gc) gc();

  // Measured
  const start = performance.now();
  for (let iter = 0; iter < measuredIters; iter++) {
    const inputs = mutatesInput ? batches![warmupIters + iter] : fixtures;
    for (const f of inputs) {
      fn(f);
    }
  }
  const elapsed = performance.now() - start;
  const totalOps = measuredIters * fixtures.length;

  return {
    name,
    totalMs: elapsed,
    opsPerSec: (totalOps / elapsed) * 1000,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const FIXTURE_COUNT = 200;
const DEPTH = 6;
const BREADTH = 4;
const WARMUP_ITERS = 5;
const MEASURED_ITERS = 50;

interface ApproachDef {
  name: string;
  fn: (obj: unknown) => unknown;
  mutatesInput: boolean; // whether the approach mutates its input
}

const approaches: ApproachDef[] = [
  { name: "1. JSON string replace", fn: approach1_jsonStringReplace, mutatesInput: false },
  { name: "2. Inline copy-on-write", fn: approach2_inlineCOW, mutatesInput: false },
  { name: "3. structuredClone+mutate", fn: approach3_structuredClone, mutatesInput: true },
  { name: "4. JSON clone+mutate", fn: approach4_jsonClone, mutatesInput: true },
  { name: "5. JSON replacer", fn: approach5_jsonReplacer, mutatesInput: false },
  { name: "6. mapDeep (production)", fn: approach6_mapDeep, mutatesInput: false },
];

function deepFreeze(obj: unknown): void {
  if (obj === null || typeof obj !== "object") return;
  Object.freeze(obj);
  if (Array.isArray(obj)) obj.forEach(deepFreeze);
  else Object.values(obj as Record<string, unknown>).forEach(deepFreeze);
}

function printTable(results: BenchResult[]): void {
  console.log(
    "Approach".padEnd(30) +
      "Total (ms)".padStart(12) +
      "Ops/sec".padStart(12) +
      "Relative".padStart(10),
  );
  console.log("-".repeat(64));

  const fastest = Math.min(...results.map((r) => r.totalMs));
  for (const r of results) {
    const rel = r.totalMs / fastest;
    console.log(
      r.name.padEnd(30) +
        r.totalMs.toFixed(1).padStart(12) +
        Math.round(r.opsPerSec).toString().padStart(12) +
        `${rel.toFixed(2)}x`.padStart(10),
    );
  }
  console.log("-".repeat(64));
}

/** Fisher-Yates shuffle (returns new array). */
function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface Scenario {
  label: string;
  sentinelCount: number; // sentinels per object (0 = none for non-sentinel fixtures)
  sentinelRate: number;  // fraction of fixtures that get sentinels
}

const scenarios: Scenario[] = [
  { label: "50% sentinel, 1 per object (mixed workload)", sentinelCount: 1, sentinelRate: 0.5 },
  { label: "100% sentinel, 1 per object (always replacing)", sentinelCount: 1, sentinelRate: 1.0 },
  { label: "100% sentinel, 5 per object (multi-replace)", sentinelCount: 5, sentinelRate: 1.0 },
];

// ---------------------------------------------------------------------------
// Key-safety correctness (tests approach 1's known flaw)
// ---------------------------------------------------------------------------

console.log("Key-safety checks (sentinel as object key):");
for (const a of approaches) {
  checkKeyCorrectness(a.name, a.fn);
}

// ---------------------------------------------------------------------------
// Run scenarios
// ---------------------------------------------------------------------------

for (const scenario of scenarios) {
  console.log("\n" + "=".repeat(64));
  console.log(`SCENARIO: ${scenario.label}`);
  console.log("=".repeat(64));
  console.log(`  ${FIXTURE_COUNT} objects, depth=${DEPTH}, breadth=${BREADTH}`);
  console.log(`  ~${BREADTH ** DEPTH} leaves per object\n`);

  const fixtures: unknown[] = [];
  const sentinelCounts: number[] = [];

  for (let i = 0; i < FIXTURE_COUNT; i++) {
    const inject = i / FIXTURE_COUNT < scenario.sentinelRate;
    const count = inject ? scenario.sentinelCount : 0;
    fixtures.push(generateFixture(DEPTH, BREADTH, count));
    sentinelCounts.push(inject ? countOccurrences(fixtures[i], SENTINEL) : 0);
  }
  fixtures.forEach(deepFreeze);

  const actualWithSentinel = fixtures.filter((f) => deepContains(f, SENTINEL)).length;
  const totalSentinels = fixtures.reduce((sum: number, f) => sum + countOccurrences(f, SENTINEL), 0);
  console.log(`  Fixtures with sentinel: ${actualWithSentinel}/${FIXTURE_COUNT}`);
  console.log(`  Total sentinel occurrences: ${totalSentinels}\n`);

  // Correctness
  console.log("Correctness checks:");
  for (const a of approaches) {
    checkCorrectness(a.name, a.fn, fixtures, sentinelCounts);
  }

  // Benchmark — shuffle approach order to reduce ordering bias
  const shuffled = shuffle(approaches);
  console.log(`\nBenchmarking (${WARMUP_ITERS} warmup + ${MEASURED_ITERS} measured iterations)...`);
  console.log(`  Order: ${shuffled.map((a) => a.name.split(".")[0]).join(", ")}\n`);

  const resultMap = new Map<string, BenchResult>();
  for (const a of shuffled) {
    if (gc) gc();
    const r = bench(a.name, a.fn, fixtures, WARMUP_ITERS, MEASURED_ITERS, a.mutatesInput);
    resultMap.set(a.name, r);
    console.log(`  ${a.name}: ${r.totalMs.toFixed(1)}ms`);
  }

  // Print in original order for consistent comparison
  const results = approaches.map((a) => resultMap.get(a.name)!);
  console.log("");
  printTable(results);
}

console.log("\nInterpretation:");
console.log("- Lower total ms / higher ops/sec = better.");
console.log("- 'Relative' is the slowdown factor vs the fastest approach.");
console.log("- Approach ordering is shuffled per scenario to reduce JIT/GC bias.");
console.log("- COW (#2) receives frozen originals (no clone overhead);");
console.log("  mutating approaches (#3, #4) receive pre-cloned inputs.");
console.log("- Multi-sentinel scenario tests how approaches scale with more replacements.");
if (gc) {
  console.log("- GC was forced between approaches (--expose-gc detected).");
} else {
  console.log("- Tip: run with `node --expose-gc` for more stable results.");
}
