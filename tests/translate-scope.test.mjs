import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");

test("translation cache distinguishes case while reusing identical input", async () => {
  const snippet = source.slice(source.indexOf("function resolveTranslateMode("), source.indexOf("// === HELPER: Intelligent text cleaning ==="));
  const cache = new Map();
  let providerCalls = 0;
  const context = vm.createContext({
    TRANSLATE_PROMPT_VERSION: "fixture",
    translateCache: cache,
    buildTranslatePrompt: text => ({ system: "", prompt: text }),
    getAvailableKey: async () => ({ key: "fake", provider: "groq" }),
    callGroqNonStream: async (_key, prompt) => { providerCalls++; return `result:${prompt}`; },
    callGeminiNonStream() {}, callCerebrasNonStream() {}, callSambanovaNonStream() {}, callOpenrouterNonStream() {},
    translateInParts: async () => { throw new Error("unexpected long input"); },
  });
  vm.runInContext(snippet, context);
  const first = await vm.runInContext('translateText("US", "word")', context);
  const second = await vm.runInContext('translateText("us", "word")', context);
  const repeated = await vm.runInContext('translateText("US", "word")', context);
  assert.equal(first.translation, "result:US");
  assert.equal(second.translation, "result:us");
  assert.equal(repeated.translation, first.translation);
  assert.equal(providerCalls, 2);
});

test("page translation reports that only the first 24,000 characters were translated", async () => {
  const snippet = source.slice(source.indexOf("async function translateInParts("), source.indexOf("function resolveTranslateMode("));
  const context = vm.createContext({
    splitSourceIntoChunks: text => [text],
    translateText: async text => ({ translation: text }),
  });
  vm.runInContext(snippet, context);
  context.longPage = "x".repeat(25000);
  const result = await vm.runInContext('translateInParts(longPage, "page")', context);
  assert.equal(result.translation.length, 24000);
  assert.equal(result.truncated, true);
});
