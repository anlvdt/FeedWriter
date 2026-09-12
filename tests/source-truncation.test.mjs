/**
 * Tests for the free-tier input-budget mechanism in background.js:
 * providers that reject oversized requests (Groq TPM "Request too large",
 * context-length errors) trigger a head+tail truncation of the source instead
 * of just shrinking max_tokens — per-minute token limits are input-dominated.
 *
 * Extracts buildSourceMessage / truncateSourceForBudget via vm (same technique
 * as error-classify.test.mjs).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const context = vm.createContext({});
const start = src.indexOf("const MIN_SOURCE_BUDGET");
const end = src.indexOf("function sleepAbortable", start);
assert.ok(start >= 0 && end > start, "could not locate input-budget block");
vm.runInContext(src.slice(start, end), context);

const truncate = (source, budget) => {
  context.__src = source;
  context.__budget = budget;
  return vm.runInContext(
    "truncateSourceForBudget(__src, __budget)",
    context,
  );
};

describe("truncateSourceForBudget", () => {
  it("returns the source untouched when it fits the budget", () => {
    const s = "short post";
    assert.equal(truncate(s, 1000), s);
    assert.equal(truncate("", 100), "");
  });

  it("shrinks oversized sources to about the budget", () => {
    const s = "a".repeat(20000);
    const out = truncate(s, 6000);
    assert.ok(out.length <= 6100, `expected ~6000, got ${out.length}`);
  });

  it("keeps head and tail with a truncation marker in the middle", () => {
    const s = "HEAD-" + "x".repeat(20000) + "-TAIL";
    const out = truncate(s, 6000);
    assert.ok(out.startsWith("HEAD-"), "keeps the head");
    assert.ok(out.endsWith("-TAIL"), "keeps the tail");
    assert.ok(out.includes("đã rút gọn phần giữa"), "has marker");
  });

  it("handles degenerate budgets without negative slicing", () => {
    const s = "x".repeat(500);
    const out = truncate(s, 10);
    assert.ok(out.length > 0);
    assert.ok(out.length <= 500);
  });
});

describe("buildSourceMessage", () => {
  it("wraps the source in the untrusted-data fence", () => {
    context.__s = "abc";
    const out = vm.runInContext("buildSourceMessage(__s)", context);
    assert.ok(out.includes("NỘI DUNG NGUỒN"));
    assert.ok(out.includes('"""'));
    assert.ok(out.includes("abc"));
  });
});
