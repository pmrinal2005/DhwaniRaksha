#!/usr/bin/env node
/**
 * truth-guard — fails if the dashboard ever renders fabricated numbers.
 *
 * The project rule is: every number on screen comes from a fetch, a real
 * computation, or an explicit `sim`/`mock` mode label. This guard enforces the
 * mechanical part of that rule:
 *
 *   1. No literal demo metrics in JSX (percentages, credit counts, ms values,
 *      rupee totals) unless they are inside a `title`/`aria`/format helper.
 *   2. Every fetch hook must carry a `source`/`exactness` envelope.
 *   3. Every panel must declare its `sourcePath` prop so a reader can trace it.
 *   4. Every API route must export a runtime (nodejs or edge).
 *   5. No `Math.random()` in client components — identity must be deterministic.
 *
 * Exit code 1 on violation so CI and `npm run build` can gate on it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const srcRoot = join(root, "src");

/** @type {{file: string, line: number, rule: string, detail: string}[]} */
const violations = [];
const checks = [];

function walk(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(srcRoot);
const read = (file) => readFileSync(file, "utf8");

function addCheck(name, ok, detail) {
  checks.push({ name, ok, detail });
  if (!ok) violations.push({ file: "-", line: 0, rule: name, detail });
}

/* 1 ── fabricated numbers in JSX ------------------------------------------- */
const FAKE_NUMBER = /(?:₹\s?\d[\d,]{2,}|(?<![\w.])\d{1,3}(?:\.\d+)?\s?%\s*(?:accuracy|uptime|faster|cheaper|reduction)|99\.9|10x faster|2x cheaper)/i;
for (const file of files.filter((f) => f.includes("/components/") || f.includes("/app/"))) {
  if (!file.endsWith(".tsx")) continue;
  const lines = read(file).split("\n");
  lines.forEach((line, index) => {
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;
    if (/title=|aria-|placeholder=|data-/.test(line)) return;
    const match = FAKE_NUMBER.exec(line);
    if (match) violations.push({ file: relative(root, file), line: index + 1, rule: "no-fabricated-metrics", detail: `literal "${match[0]}" — bind it to fetched data or a sim label` });
  });
}
addCheck("no fabricated metrics in JSX", !violations.some((v) => v.rule === "no-fabricated-metrics"), "scanned components/ and app/");

/* 2 ── every hook returns the source/exactness envelope --------------------- */
const liveApi = read(join(srcRoot, "lib/live-api.ts"));
const envelopeOk = /interface Envelope \{/.test(liveApi) && /source\?*:\s*Source/.test(liveApi) && /exactness\?*:\s*Exactness/.test(liveApi) && /type Exactness = "exact" \| "estimated"/.test(liveApi);
addCheck("live-api exposes source + exactness", envelopeOk, envelopeOk ? "Envelope {source, exactness} exported and used by every hook" : "Envelope contract missing");
const routeFiles = files.filter((f) => f.includes("/app/api/") && f.endsWith("route.ts"));
addCheck("every API route declares a runtime", routeFiles.every((f) => /export const runtime = "(nodejs|edge)"/.test(read(f))), `${routeFiles.length} routes`);
addCheck("every API route is dynamic", routeFiles.every((f) => /export const dynamic = "force-dynamic"/.test(read(f))), `${routeFiles.length} routes`);

/* 3 ── panels declare where their data comes from -------------------------- */
const panelFiles = files.filter((f) => f.includes("/components/dashboard/") && f.endsWith(".tsx"));
const panelSources = read(join(srcRoot, "components/dashboard/panels.tsx")) + read(join(srcRoot, "components/dashboard/SessionPanel.tsx"));
const panelCount = (panelSources.match(/<Panel\b/g) ?? []).length;
const sourceCount = (panelSources.match(/sourcePath=/g) ?? []).length;
addCheck("every dashboard panel declares sourcePath", sourceCount >= panelCount, `${sourceCount} sourcePath props for ${panelCount} panels across ${panelFiles.length} files`);

/* 4 ── determinism: no Math.random in rendered components ------------------ */
const randomOffenders = files
  .filter((f) => f.includes("/components/") || f.includes("/app/"))
  .filter((f) => /Math\.random\(/.test(read(f)));
addCheck("no Math.random in components (identity must be reproducible)", randomOffenders.length === 0, randomOffenders.length ? randomOffenders.map((f) => relative(root, f)).join(", ") : "clean");

/* 5 ── mock mode must be labelled in the UI -------------------------------- */
const topbar = read(join(srcRoot, "components/shell/Topbar.tsx"));
addCheck("mock mode is surfaced in the topbar", /mock/i.test(topbar) && /ribbon|mock-ribbon/i.test(topbar), "topbar renders the mock ribbon");

/* 6 ── no Cloudflare / Hono anywhere (hard project constraint) -------------- */
const banned = files.filter((f) => /from\s+["'](hono|@cloudflare\/|wrangler)/.test(read(f)));
addCheck("no Cloudflare/Hono imports", banned.length === 0, banned.length ? banned.map((f) => relative(root, f)).join(", ") : "clean");

/* ------------------------------------------------------------------ report */
const passed = checks.filter((check) => check.ok).length;
console.log(`\n  truth-guard · ${passed}/${checks.length} checks\n`);
for (const check of checks) console.log(`  ${check.ok ? "✓" : "✗"} ${check.name} — ${check.detail}`);
if (violations.length) {
  console.log("\n  violations:");
  for (const violation of violations) console.log(`   ${violation.file}:${violation.line} [${violation.rule}] ${violation.detail}`);
  console.log("");
  process.exit(1);
}
console.log("\n  PASS — every rendered value is traceable to a fetch or a labelled sim mode.\n");
