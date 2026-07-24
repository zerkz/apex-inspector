// Fails if any package resolved in yarn.lock was published less than
// MIN_DEP_AGE_DAYS (default 30) days ago. Supply chain protection: freshly
// published versions are the main vector for compromised-package attacks.
//
// Usage: node scripts/check-dep-age.mjs

import { readFile } from "node:fs/promises";

const MIN_AGE_DAYS = Number(process.env.MIN_DEP_AGE_DAYS ?? 30);
const REGISTRY = "https://registry.npmjs.org";
const CONCURRENCY = 12;

const lockfile = await readFile(new URL("../yarn.lock", import.meta.url), "utf8");

// Parse yarn.lock v1: header lines like `"@scope/pkg@^1.0.0":` or `pkg@^1.0.0:`
// followed by an indented `version "x.y.z"` line.
const packages = new Map(); // name -> Set of versions
let currentName = null;
for (const line of lockfile.split("\n")) {
  if (/^[^\s#]/.test(line)) {
    const firstSpec = line.replace(/:\s*$/, "").split(",")[0].trim().replace(/^"|"$/g, "");
    currentName = firstSpec.slice(0, firstSpec.lastIndexOf("@"));
    // Aliases look like `alias-name@npm:real-name`; the registry knows the real name.
    if (currentName.includes("@npm:")) currentName = currentName.split("@npm:")[1];
  } else if (currentName) {
    const m = line.match(/^\s{2}version "(.+)"/);
    if (m) {
      if (!packages.has(currentName)) packages.set(currentName, new Set());
      packages.get(currentName).add(m[1]);
    }
  }
}

const entries = [...packages.entries()];
console.log(`Checking publish age of ${entries.length} packages (min ${MIN_AGE_DAYS} days)...`);

const violations = [];
const errors = [];
const cutoff = Date.now() - MIN_AGE_DAYS * 24 * 60 * 60 * 1000;

async function check([name, versions]) {
  const res = await fetch(`${REGISTRY}/${name.replace("/", "%2f")}`);
  if (!res.ok) {
    errors.push(`${name}: registry returned ${res.status}`);
    return;
  }
  const { time } = await res.json();
  for (const version of versions) {
    const published = time?.[version];
    if (!published) {
      errors.push(`${name}@${version}: no publish time in registry metadata`);
      continue;
    }
    if (Date.parse(published) > cutoff) {
      const ageDays = ((Date.now() - Date.parse(published)) / 86400000).toFixed(1);
      violations.push(`${name}@${version} published ${published} (${ageDays} days ago)`);
    }
  }
}

const queue = [...entries];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    let item;
    while ((item = queue.shift())) await check(item);
  })
);

if (errors.length) {
  console.warn(`\nWarnings (could not verify):\n  ${errors.join("\n  ")}`);
}
if (violations.length) {
  console.error(
    `\nPolicy violation: ${violations.length} package(s) younger than ${MIN_AGE_DAYS} days:\n  ${violations.join("\n  ")}`
  );
  process.exit(1);
}
console.log("All dependencies satisfy the minimum age policy.");
