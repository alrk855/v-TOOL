#!/usr/bin/env node
/**
 * docker-push.mjs
 * Tags the locally-built Compose images and pushes them to a container registry.
 *
 * Usage:
 *   npm run docker:push
 *   REGISTRY=ghcr.io/youruser npm run docker:push
 *   REGISTRY=docker.io/youruser TAG=v1.2.3 npm run docker:push
 */

import { execSync } from "node:child_process";
import readline from "node:readline";

const env = process.env;

// ─── helpers ────────────────────────────────────────────────────────────────
function run(cmd) {
  console.log(`\n  \x1b[36m$\x1b[0m ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

async function ask(question, fallback) {
  if (fallback) return fallback;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(`  ${question}: `, (ans) => { rl.close(); resolve(ans.trim()); }));
}

// ─── main ───────────────────────────────────────────────────────────────────
const registry = await ask("Registry prefix (e.g. ghcr.io/youruser or docker.io/youruser)", env.REGISTRY);
const tag      = (await ask("Image tag            [default: latest]", env.TAG || "latest")) || "latest";

if (!registry) {
  console.error("\n  \x1b[31mError:\x1b[0m A registry prefix is required.\n");
  process.exit(1);
}

const images = [
  { local: "dplt-dashboard",      remote: `${registry}/dplt-dashboard:${tag}` },
  { local: "dplt-runner-engine",  remote: `${registry}/dplt-runner-engine:${tag}` },
];

console.log("\n\x1b[1mBuilding images…\x1b[0m");
run("docker compose build");

for (const { local, remote } of images) {
  console.log(`\n\x1b[1mTagging \x1b[36m${local}\x1b[0m → \x1b[33m${remote}\x1b[0m`);
  run(`docker tag ${local} ${remote}`);

  console.log(`\x1b[1mPushing \x1b[33m${remote}\x1b[0m`);
  run(`docker push ${remote}`);
}

console.log("\n\x1b[32m✓ All images pushed successfully.\x1b[0m\n");
console.log("  Pull on your server with:");
for (const { remote } of images) {
  console.log(`    docker pull ${remote}`);
}
console.log();
