import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  ...fs.readdirSync(root)
    .filter((name) => name.endsWith(".js"))
    .map((name) => path.join(root, name)),
  ...fs.readdirSync(path.join(root, "lib"))
    .filter((name) => name.endsWith(".js"))
    .map((name) => path.join(root, "lib", name)),
].sort();

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `Syntax check failed: ${file}\n`);
    process.exit(result.status || 1);
  }
}

console.log(`OK syntax checked ${files.length} JavaScript files`);
