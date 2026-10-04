// List posts ("10 open-source GitHub projects…") must keep every link.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const policy = require("../lib/summary-policy.js");
const source = readFileSync(new URL("./fixtures/github-list-post.txt", import.meta.url), "utf8");

describe("source links", () => {
  const links = policy.extractSourceLinks(source);

  it("finds every link with the project name as its label", () => {
    assert.equal(links.length, 10);
    assert.deepEqual(links.map((l) => l.label), [
      "OpenScholar", "PaperQA2", "Docling", "Crawl4AI", "RAGFlow",
      "GraphRAG", "LightRAG", "Open Deep Research", "DeepEval", "Ragas",
    ]);
    assert.equal(links[6].url, "https://github.com/HKUDS/LightRAG");
  });

  it("labels inline links and strips trailing punctuation", () => {
    const inline = policy.extractSourceLinks("Repo: https://github.com/a/b. Docs (https://example.com/docs), xem https://github.com/a/b/");
    assert.deepEqual(inline.map((l) => [l.label, l.url]), [
      ["Repo", "https://github.com/a/b"],
      ["Docs", "https://example.com/docs"],
    ]);
  });

  it("asks for every link and lifts the short-source length budget", () => {
    const rule = policy.buildLinksInstruction(links);
    assert.match(rule, /BẮT BUỘC GIỮ ĐỦ 10 LINK/);
    assert.match(rule, /- Open Deep Research: https:\/\/github\.com\/langchain-ai\/open_deep_research/);
    assert.equal(policy.buildLengthBudgetInstruction(source), "");
    assert.equal(policy.buildLinksInstruction(links.slice(0, 1)), "");
  });

  it("matches links regardless of host case, www and trailing slash", () => {
    const output = "· a — https://www.GitHub.com/akariasai/openscholar/ · b — https://github.com/Future-House/paper-qa.";
    const missing = policy.findMissingLinks(output, links);
    assert.equal(missing.length, 8);
    assert.ok(!missing.some((l) => l.label === "OpenScholar" || l.label === "PaperQA2"));
  });

  it("appends missing links with their labels", () => {
    const out = policy.appendMissingLinks("Bài viết.", links.slice(8));
    assert.equal(out, "Bài viết.\n\nLiên kết:\n· DeepEval: https://github.com/confident-ai/deepeval\n· Ragas: https://github.com/explodinggradients/ragas");
  });
});

describe("two links in a news post", () => {
  it("keeps both links without forcing a list layout", () => {
    const rule = policy.buildLinksInstruction(policy.extractSourceLinks(
      "OpenAI ra mắt API mới https://openai.com/blog/x và tài liệu tại https://platform.openai.com/docs/x",
    ));
    assert.match(rule, /BẮT BUỘC GIỮ ĐỦ 2 LINK/);
    assert.match(rule, /ngay sau ý nó minh chứng/);
    assert.doesNotMatch(rule, /Nguồn là danh sách/);
  });
});
