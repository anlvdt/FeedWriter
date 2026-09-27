import fs from "node:fs";

const cases = JSON.parse(fs.readFileSync(new URL("./cases.json", import.meta.url), "utf8"));
const runPath = process.argv[2];
if (!runPath) {
  console.error("Usage: node benchmarks/headlines/score.mjs <run.json>");
  process.exit(2);
}
const run = JSON.parse(fs.readFileSync(runPath, "utf8"));
const expected = new Set(cases.map(item => item.id));
const fields = ["fact", "certainty", "complete", "concise", "natural"];
const firstProvider = run?.[0]?.provider;
const firstTone = run?.[0]?.tone;
if (!Array.isArray(run) || run.length !== expected.size || new Set(run.map(item => item.id)).size !== expected.size ||
    run.some(item => !expected.has(item.id) || !item.headline?.trim() || !Array.isArray(item.reviewers) ||
      !firstProvider || !firstTone || item.provider !== firstProvider || item.tone !== firstTone ||
      !Number.isFinite(item.latency_ms) || item.latency_ms < 0 ||
      item.reviewers.length !== 2 || item.reviewers.some(review => fields.some(field => typeof review[field] !== "boolean")))) {
  throw new Error("Run thiếu mẫu, trùng ID hoặc thiếu hai phiếu chấm đầy đủ.");
}
for (const field of fields) {
  const accepted = run.filter(item => item.reviewers.every(review => review[field])).length;
  console.log(`${field}: ${accepted}/${run.length}`);
}
const clear = run.filter(item => item.reviewers.every(review => review.fact && review.certainty && review.complete && review.concise && review.natural));
console.log(`Rõ và gọn (cả hai người chấm): ${clear.length}/${run.length}`);
console.log(`Provider: ${firstProvider}; tone: ${firstTone}; độ trễ trung bình: ${Math.round(run.reduce((sum, item) => sum + item.latency_ms, 0) / run.length)} ms`);
for (const item of run) {
  if (!clear.includes(item)) console.log(`Cần xem lại: ${item.id} — ${item.headline}`);
}
