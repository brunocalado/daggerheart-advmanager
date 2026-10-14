/*!
 * Daggerheart: Adversary Manager
 * 2025 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * Compiles or extracts the compendium packs declared in module.json with the Foundry VTT CLI.
 *
 *   npm run pack     # packs/_source/<name>/*.json -> LevelDB at each pack's `path`
 *   npm run unpack   # LevelDB at each pack's `path` -> packs/_source/<name>/*.json
 *
 * Only the JSON source is committed: Foundry rewrites a LevelDB whenever a world that uses it
 * opens, so a committed one dirtied the tree with nothing edited, diffed as binary and could not
 * be merged between branches. The LevelDB packs are build output: the release workflow
 * compiles them, and locally Foundry reads and writes them. After editing a compendium in
 * Foundry, close the world (LevelDB opens in one process at a time) and run `unpack` before
 * committing; after pulling, run `pack`.
 *
 * Both directions start from an empty destination, so a document deleted on one side does not
 * linger on the other.
 */

import { compilePack, extractPack } from "@foundryvtt/foundryvtt-cli";
import { readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_ROOT = join(ROOT, "packs", "_source");

const mode = process.argv[2];
if (!["pack", "unpack"].includes(mode)) {
    console.error("Usage: node tools/build-packs.mjs <pack|unpack>");
    process.exit(1);
}

const { packs } = JSON.parse(readFileSync(join(ROOT, "module.json"), "utf8"));

for (const { name, path } of packs) {
    const source = join(SOURCE_ROOT, name);
    const compiled = join(ROOT, path);
    if (mode === "pack") {
        rmSync(compiled, { recursive: true, force: true });
        await compilePack(source, compiled, { log: true });
    } else {
        await extractPack(compiled, source, { clean: true, omitVolatile: true, log: true });
    }
}

console.log(`\n${mode} complete: ${packs.length} pack(s).`);
