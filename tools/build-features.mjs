/*!
 * Daggerheart: Adversary Manager
 * 2025 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * Rebuilds the "all-features" compendium (packs/all-features) from the adversaries shipped by
 * the Daggerheart system — the offline equivalent of running AM.ImportFeatures() in a world and
 * dragging the result into the compendium by hand.
 *
 * The rules are the importer's own (scripts/importer.js): the "Core Features / <Type> /
 * <Action|Reaction|Passive>" folder tree with the same colours, one feature per
 * name + item type + folder + tier unless it is in ALWAYS_DUPLICATE, and the same
 * `flags.importedFrom` block the rest of the module reads.
 *
 * Ids are derived from the source adversary and item ids rather than random, so rebuilding
 * against an unchanged system produces an unchanged pack and a clean git diff.
 *
 * Getting the input (same as build-benchmarks.mjs; the running server holds a LOCK, so copy first):
 *
 *   cp -r <foundry-data>/systems/daggerheart/packs/adversaries /tmp/dh && rm -f /tmp/dh/adversaries/LOCK
 *   fvtt package unpack adversaries --inputDirectory /tmp/dh --outputDirectory benchmark/system-adversaries \
 *     --type System --id daggerheart
 *
 * Then:
 *
 *   node tools/build-features.mjs benchmark/system-adversaries            # print a summary
 *   node tools/build-features.mjs benchmark/system-adversaries --write    # repack packs/all-features
 *
 * --write needs the `fvtt` CLI on the PATH and no Foundry with this module's packs open:
 * a LevelDB opens in one process at a time, and the CLI refuses to pack a locked database.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MODULE_ID } from "../scripts/constants.js";
import { ALWAYS_DUPLICATE, TYPE_COLORS, getFeatureCategory } from "../scripts/importer.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACK_NAME = "all-features";
const SOURCE_COMPENDIUM = "daggerheart.adversaries";
const ROOT_FOLDER = "Core Features";
const CUSTOM_TAG = "Core Rulebook";

// --- Input ---

/**
 * Reads every adversary Actor from one or more directories of unpacked pack JSON.
 * @param {string[]} dirs - Directories written by `fvtt package unpack`.
 * @returns {Object[]} Adversary source objects, sorted so a rebuild is deterministic.
 */
function loadAdversaries(dirs) {
    const out = [];
    for (const dir of dirs) {
        for (const file of fs.readdirSync(dir)) {
            if (!file.endsWith(".json")) continue;
            const doc = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
            if (doc?.type === "adversary") out.push(doc);
        }
    }
    // The importer keeps the first copy of a duplicated feature, so the order decides which
    // adversary a shared feature is credited to — pin it instead of trusting readdir.
    return out.sort((a, b) => a.name.localeCompare(b.name) || a._id.localeCompare(b._id));
}

/**
 * A stable 16-character Foundry id derived from the given parts.
 * @param {...string} parts - Anything that uniquely identifies the document.
 * @returns {string}
 */
function stableId(...parts) {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const bytes = crypto.createHash("sha256").update(parts.join("|")).digest();
    return Array.from(bytes.subarray(0, 16), b => chars[b % chars.length]).join("");
}

function capitalize(str) {
    if (!str) return "";
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// --- Build ---

/**
 * Turns the adversaries into the folder and item documents of the compendium.
 * @param {Object[]} adversaries - Adversary source objects.
 * @param {string|null} systemVersion - Version stamped into each document's _stats.
 * @returns {{folders: Object[], items: Object[], skipped: number}}
 */
function buildFeatures(adversaries, systemVersion) {
    const stats = { systemId: "daggerheart", systemVersion };
    const folders = new Map();

    const folder = (name, parent, color, sort) => {
        const key = `${parent?._id ?? ""}/${name}`;
        if (!folders.has(key)) {
            const _id = stableId("folder", key);
            folders.set(key, {
                _id, name, type: "Item", color, sorting: "a", sort, description: "",
                folder: parent?._id ?? null, flags: {}, _stats: stats, _key: `!folders!${_id}`
            });
        }
        return folders.get(key);
    };

    const root = folder(ROOT_FOLDER, null, "#000000", 100000);
    const items = [];
    const seen = new Set();
    let skipped = 0;

    for (const adversary of adversaries) {
        const advType = capitalize(adversary.system?.type || "Standard");
        const tier = Number(adversary.system?.tier) || 0;
        const typeFolder = folder(advType, root, TYPE_COLORS[advType] || TYPE_COLORS.Unknown, 0);

        for (const item of adversary.items ?? []) {
            const categoryFolder = folder(getFeatureCategory(item), typeFolder, null, 0);
            const isSpecialCase = ALWAYS_DUPLICATE.includes(item.name);
            const dedupKey = `${item.name}|${item.type}|${categoryFolder._id}|${tier}`;
            if (!isSpecialCase && seen.has(dedupKey)) {
                skipped++;
                continue;
            }
            seen.add(dedupKey);

            const _id = stableId("item", adversary._id, item._id);
            items.push({
                _id,
                name: item.name,
                type: item.type,
                img: item.img || "icons/svg/item-bag.svg",
                system: item.system,
                effects: (item.effects ?? []).map(effect => ({ ...effect, _key: `!items.effects!${_id}.${effect._id}` })),
                folder: categoryFolder._id,
                sort: 0,
                ownership: { default: 0 },
                flags: {
                    importedFrom: {
                        compendium: SOURCE_COMPENDIUM,
                        adversary: adversary.name,
                        tier,
                        type: advType,
                        customTag: CUSTOM_TAG,
                        originalId: item._id,
                        isSpecialCase
                    }
                },
                _stats: stats,
                _key: `!items!${_id}`
            });
        }
    }

    return { folders: [...folders.values()], items, skipped };
}

/**
 * Prints what the pack will contain, per adversary type.
 * @param {Object[]} items - Built item documents.
 */
function report(items) {
    const byType = new Map();
    for (const item of items) {
        const { type, tier } = item.flags.importedFrom;
        byType.set(type, byType.get(type) ?? { total: 0, tiers: {} });
        const row = byType.get(type);
        row.total++;
        row.tiers[tier] = (row.tiers[tier] ?? 0) + 1;
    }
    for (const [type, row] of [...byType].sort()) {
        const tiers = [1, 2, 3, 4].map(t => `T${t} ${row.tiers[t] ?? 0}`).join("  ");
        console.log(`  ${type.padEnd(9)} ${String(row.total).padStart(4)}   ${tiers}`);
    }
}

// --- Main ---

const args = process.argv.slice(2);
const write = args.includes("--write");
const dirs = args.filter(a => !a.startsWith("--"));

if (!dirs.length) {
    console.error("usage: node tools/build-features.mjs <unpacked-adversary-dir>... [--write]");
    process.exit(2);
}

const adversaries = loadAdversaries(dirs);
const versions = new Set(adversaries.map(a => a._stats?.systemVersion).filter(Boolean));
const systemVersion = versions.size === 1 ? [...versions][0] : null;
if (versions.size > 1) console.warn(`Warning: adversaries come from several system versions: ${[...versions].join(", ")}`);

const { folders, items, skipped } = buildFeatures(adversaries, systemVersion);
console.log(`Read ${adversaries.length} adversaries (system ${systemVersion ?? "unknown"}).`);
console.log(`${items.length} features in ${folders.length} folders; ${skipped} duplicates skipped.\n`);
report(items);

if (write) {
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), "am-features-"));
    try {
        for (const doc of [...folders, ...items]) {
            fs.writeFileSync(path.join(staging, `${doc._id}.json`), JSON.stringify(doc, null, 2));
        }
        execFileSync("fvtt", [
            "package", "pack", PACK_NAME,
            "--inputDirectory", staging,
            "--outputDirectory", path.join(ROOT, "packs"),
            "--type", "Module", "--id", MODULE_ID
        ], { stdio: ["ignore", "ignore", "inherit"] });
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
    }
    console.log(`\nWrote packs/${PACK_NAME} (${items.length} features, ${folders.length} folders).`);
} else {
    console.log(`\n(dry run — pass --write to repack packs/${PACK_NAME})`);
}
