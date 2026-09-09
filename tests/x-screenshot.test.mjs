import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const captureSource = content.slice(
  content.indexOf("function getXPostIdentity"),
  content.indexOf("async function handlePostStatus"),
);

function makeTweet(id, text, rect = { x: 20, y: 30, width: 400, height: 180 }) {
  const post = {
    isConnected: true,
    rect,
    scrolls: [],
    closest() { return this; },
    getBoundingClientRect() { return this.rect; },
    scrollIntoView(options) { this.scrolls.push(options); },
    querySelector(selector) {
      if (selector === '[data-testid="tweetText"]') return { textContent: text };
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'a[href*="/status/"]') return this.links;
      return [];
    },
  };
  post.links = [{
    href: `https://x.com/author/status/${id}`,
    closest() { return post; },
    querySelector(selector) { return selector === "time" ? {} : null; },
  }];
  return post;
}

function loadCaptureContext(posts = []) {
  const messages = [];
  const state = { posts, restored: 0, settled: 0 };
  const context = vm.createContext({
    URL,
    location: { href: "https://x.com/home" },
    document: {
      querySelectorAll(selector) {
        return selector === 'article[data-testid="tweet"]' ? state.posts : [];
      },
    },
    window: { innerWidth: 800, innerHeight: 600 },
    chrome: {
      runtime: {
        async sendMessage(message) {
          messages.push(message);
          if (message.action === "request-optional-permission") return { granted: true };
          return { base64: "data:image/png;base64,test" };
        },
      },
    },
  });
  vm.runInContext(`
    const SITE = "x";
    let lastSummarizeParams = null;
    ${captureSource}
    suppressFeedWriterUiForScreenshot = () => ({
      waitUntilHidden: async () => {},
      restore: () => { captureState.restored++; },
    });
    waitForNextPaint = async () => { captureState.settled++; };
  `, Object.assign(context, { captureState: state }));
  return { context, state, messages };
}

describe("X screenshot capture", () => {
  it("accepts a short tweet and clips its bounds to the visible viewport", async () => {
    const post = makeTweet("101", "Short but valid", { x: -10, y: 20, width: 80, height: 60 });
    const { context, state, messages } = loadCaptureContext([post]);
    const result = await vm.runInContext("captureVisiblePost(capturePost)",
      Object.assign(context, { capturePost: post }));

    assert.equal(result, "data:image/png;base64,test");
    assert.deepEqual(JSON.parse(JSON.stringify(messages[0].bounds)),
      { x: 0, y: 20, width: 70, height: 60 });
    assert.equal(state.restored, 1);
  });

  it("resolves a detached tweet by its own permalink and ignores quoted links", async () => {
    const oldPost = makeTweet("202", "Original post");
    oldPost.isConnected = false;
    const other = makeTweet("303", "Another post");
    const live = makeTweet("202", "Original post", { x: 40, y: 50, width: 420, height: 200 });
    live.links.unshift({
      href: "https://x.com/other/status/999",
      closest() { return other; },
      querySelector() { return null; },
    });
    const { context, messages } = loadCaptureContext([other, live]);
    context.capturePost = oldPost;
    vm.runInContext("lastSummarizeParams = { xPostIdentity: getXPostIdentity(capturePost) }", context);

    await vm.runInContext("captureVisiblePost(capturePost)", context);
    assert.equal(oldPost.scrolls.length, 0);
    assert.equal(live.scrolls.length, 1);
    assert.equal(messages[0].bounds.x, 40);
  });

  it("uses exact text only when a missing permalink has one matching tweet", async () => {
    const oldPost = makeTweet("202", "Identical text");
    oldPost.isConnected = false;
    oldPost.links[0].querySelector = () => null;
    const live = makeTweet("303", "Identical text");
    live.links[0].querySelector = () => null;
    const { context, state, messages } = loadCaptureContext([live]);
    context.capturePost = oldPost;
    await vm.runInContext("captureVisiblePost(capturePost)", context);
    assert.equal(messages.length, 1);

    const duplicate = makeTweet("404", "Identical text");
    duplicate.links[0].querySelector = () => null;
    state.posts = [live, duplicate];
    await assert.rejects(vm.runInContext("captureVisiblePost(capturePost)", context),
      /Bài X không còn hiển thị/);
    assert.equal(messages.length, 1);
  });

  it("prefers a rendered replacement over a connected zero-size tweet", async () => {
    const oldPost = makeTweet("303", "Same post", { x: 0, y: 0, width: 0, height: 0 });
    const live = makeTweet("303", "Same post");
    const { context, messages } = loadCaptureContext([oldPost, live]);
    context.capturePost = oldPost;
    await vm.runInContext("captureVisiblePost(capturePost)", context);
    assert.equal(live.scrolls.length, 1);
    assert.equal(messages.length, 1);
  });

  it("retries when X replaces the tweet during scrolling", async () => {
    const oldPost = makeTweet("404", "Replaced post");
    const live = makeTweet("404", "Replaced post", { x: 30, y: 40, width: 430, height: 210 });
    const { context, state, messages } = loadCaptureContext([oldPost]);
    oldPost.scrollIntoView = () => {
      oldPost.isConnected = false;
      state.posts = [live];
    };
    context.capturePost = oldPost;
    await vm.runInContext("captureVisiblePost(capturePost)", context);

    assert.equal(live.scrolls.length, 1);
    assert.equal(messages.length, 1);
    assert.equal(state.restored, 1);
  });

  it("starts tall posts at the top and captures only visible pixels", async () => {
    const post = makeTweet("505", "Long post", { x: 20, y: -100, width: 400, height: 2000 });
    const { context, messages } = loadCaptureContext([post]);
    context.capturePost = post;
    await vm.runInContext("captureVisiblePost(capturePost)", context);

    assert.equal(post.scrolls[0].block, "start");
    assert.deepEqual(JSON.parse(JSON.stringify(messages[0].bounds)),
      { x: 20, y: 0, width: 400, height: 600 });
  });

  it("rejects empty and offscreen geometry without sending a screenshot", async () => {
    const post = makeTweet("606", "Hidden post", { x: 20, y: 20, width: 0, height: 0 });
    const { context, state, messages } = loadCaptureContext([post]);
    context.capturePost = post;
    await assert.rejects(vm.runInContext("captureVisiblePost(capturePost)", context),
      /Không tìm thấy vùng bài viết đang hiển thị/);
    assert.equal(messages.length, 0);
    assert.equal(state.restored, 1);
    assert.equal(state.settled, 3);

    const bounds = vm.runInContext("getVisiblePostBounds", context);
    assert.equal(bounds({ x: 900, y: 0, width: 100, height: 100 }, 800, 600), null);
    assert.equal(bounds({ x: NaN, y: 0, width: 100, height: 100 }, 800, 600), null);
  });

  it("does not capture another tweet when the original is no longer available", async () => {
    const oldPost = makeTweet("707", "Missing post");
    oldPost.isConnected = false;
    const { context, state, messages } = loadCaptureContext([makeTweet("808", "Other post")]);
    context.capturePost = oldPost;
    await assert.rejects(vm.runInContext("captureVisiblePost(capturePost)", context),
      /Bài X không còn hiển thị/);
    assert.equal(messages.length, 0);
    assert.equal(state.restored, 1);
  });

  it("restores hidden UI if the screenshot service rejects the request", async () => {
    const post = makeTweet("909", "Service failure");
    const { context, state } = loadCaptureContext([post]);
    context.chrome.runtime.sendMessage = async () => ({ error: "Capture failed" });
    context.capturePost = post;
    await assert.rejects(vm.runInContext("captureVisiblePost(capturePost)", context),
      /Capture failed/);
    assert.equal(state.restored, 1);
  });

  it("refreshes the source and raw summary on a cache hit", async () => {
    const text = "Same article text with enough characters";
    const first = makeTweet("1001", text);
    const second = makeTweet("1002", text);
    const cacheSource = content.slice(
      content.indexOf("async function summarizeText"),
      content.indexOf("  isSummarizing = true;", content.indexOf("async function summarizeText")),
    ) + "\n}";
    const { context } = loadCaptureContext([first, second]);
    const overlays = [];
    Object.assign(context, {
      SUMMARY_MIN_LEN: 30,
      isFacebookPersonalProfileHome: () => false,
      isContextValid: () => true,
      hashText: () => "h",
      summaryCache: new Map(),
      fmt: (text) => text,
      openOverlay: (html) => overlays.push(html),
    });
    context.chrome.storage = { sync: { get: (_keys, callback) => callback({}) } };
    vm.runInContext(`
      let lastPanelRawText = "";
      ${cacheSource}
    `, context);
    context.summaryCache.set("h_summary_medium_default_auto_h_h", "Cached summary");
    context.first = first;
    context.second = second;
    await vm.runInContext("summarizeText(cacheText, 'summary', first)",
      Object.assign(context, { cacheText: text }));
    await vm.runInContext("summarizeText(cacheText, 'summary', second)", context);

    assert.equal(overlays.length, 2);
    assert.equal(vm.runInContext("lastSummarizeParams._element", context), second);
    assert.equal(vm.runInContext("lastSummarizeParams.xPostIdentity.statusId", context), "1002");
    assert.equal(vm.runInContext("lastPanelRawText", context), "Cached summary");
  });
});
