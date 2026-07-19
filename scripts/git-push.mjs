#!/usr/bin/env node
/**
 * git-push.mjs
 * Stages all changes, commits with a timestamped message, and pushes to origin.
 *
 * First run: will ask for your remote URL and set it as origin.
 *
 * Usage:
 *   npm run git:push
 *   MSG="feat: add proxy pool" npm run git:push
 *   REMOTE=https://github.com/you/repo.git npm run git:push
 */

import { execSync, spawnSync } from "node:child_process";
import readline from "node:readline";

// ─── helpers ────────────────────────────────────────────────────────────────
function run(cmd, opts = {}) {
  console.log(`\n  \x1b[36m$\x1b[0m ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...opts });
}

function tryRun(cmd) {
  const r = spawnSync(cmd, { shell: true, encoding: "utf8" });
  return r.stdout.trim();
}

async function ask(question, fallback) {
  if (fallback) return fallback;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(`  ${question}: `, (ans) => { rl.close(); resolve(ans.trim()); })
  );
}

// ─── ensure git repo exists ──────────────────────────────────────────────────
const isRepo = tryRun("git rev-parse --is-inside-work-tree 2>&1");
if (isRepo !== "true") {
  console.log("\n  Initialising git repository…");
  run("git init");
}

// ─── ensure remote ──────────────────────────────────────────────────────────
let remote = tryRun("git remote get-url origin 2>&1");
if (!remote || remote.startsWith("fatal")) {
  remote = await ask(
    "No remote set. Enter your repository URL (e.g. https://github.com/you/repo.git)",
    process.env.REMOTE
  );
  if (!remote) { console.error("\n  \x1b[31mError:\x1b[0m Remote URL is required.\n"); process.exit(1); }
  run(`git remote add origin ${remote}`);
} else {
  console.log(`\n  Remote: \x1b[33m${remote}\x1b[0m`);
}

// ─── commit message ─────────────────────────────────────────────────────────
const defaultMsg = `chore: update ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
const msg = (await ask(`Commit message        [default: ${defaultMsg}]`, process.env.MSG)) || defaultMsg;

// ─── stage, commit, push ────────────────────────────────────────────────────
run("git add -A");

// Check if there's anything to commit
const status = tryRun("git status --porcelain");
if (!status) {
  console.log("\n  \x1b[33mNothing to commit — working tree clean.\x1b[0m");
} else {
  run(`git commit -m "${msg.replace(/"/g, '\\"')}"`);
}

// Detect current branch
const branch = tryRun("git rev-parse --abbrev-ref HEAD") || "main";
console.log(`\n\x1b[1mPushing branch \x1b[36m${branch}\x1b[0m to \x1b[33morigin\x1b[0m…`);

try {
  run(`git push -u origin ${branch}`);
  console.log("\n\x1b[32m✓ Pushed successfully.\x1b[0m\n");
} catch {
  console.log("\n  First push failed — trying with --set-upstream…");
  run(`git push --set-upstream origin ${branch}`);
  console.log("\n\x1b[32m✓ Pushed successfully.\x1b[0m\n");
}
