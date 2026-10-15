/*!
 * Daggerheart: Adversary Manager
 * 2025 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * Keeps the code and lang/en.json in sync, so translators work from a file that matches it.
 *
 *   node tools/check-i18n.mjs
 *
 * Fails when code uses a DH_ADVMANAGER key that en.json lacks (it would show as a raw key), when
 * en.json keeps a key nothing uses (a dead entry every translator still translates), or when a
 * module key is built at runtime. Every key is written literally in code (a value that picks a
 * string goes through a map of literal keys), which is what lets both lists be exact with no
 * allowlist. DAGGERHEART.* keys belong to the system and are not checked. Node built-ins only, so
 * the release workflow runs it without npm ci.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const NAMESPACE = "DH_ADVMANAGER";

/** Every file under `dir` whose name ends with `ext`. */
function walk(dir, ext) {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return walk(path, ext);
        return entry.name.endsWith(ext) ? [path] : [];
    });
}

/** Nested lang JSON to dotted keys, the way Foundry flattens it. */
function flatten(obj, prefix = "") {
    return Object.entries(obj).flatMap(([k, v]) =>
        v && typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]);
}

const defined = new Set(flatten(JSON.parse(readFileSync(join(ROOT, "lang/en.json"), "utf8"))));

const used = new Set();
const dynamic = [];
const files = [...walk(join(ROOT, "scripts"), ".js"), ...walk(join(ROOT, "templates"), ".hbs")];
for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(new RegExp(`${NAMESPACE}\\.[A-Za-z0-9_.]*[A-Za-z0-9_]`, "g"))) used.add(m[0]);
    for (const m of text.matchAll(new RegExp(`${NAMESPACE}\\.[A-Za-z0-9_.]*\\$\\{`, "g"))) {
        const line = text.slice(0, m.index).split("\n").length;
        dynamic.push(`${relative(ROOT, file)}:${line}`);
    }
}

const missing = [...used].filter(k => !defined.has(k)).sort();
const orphan = [...defined].filter(k => !used.has(k)).sort();

const report = (title, list) => {
    if (!list.length) return;
    console.error(`${title} (${list.length}):`);
    for (const item of list) console.error(`  ${item}`);
};
report("Used in code but missing from lang/en.json", missing);
report("In lang/en.json but used nowhere", orphan);
report(`${NAMESPACE} key built at runtime; write it literally`, dynamic);

if (missing.length || orphan.length || dynamic.length) process.exit(1);
console.log(`lang/en.json: ${defined.size} keys, all used, none missing.`);
