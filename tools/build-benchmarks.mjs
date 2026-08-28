/*!
 * Daggerheart: Adversary Manager
 * Copyright (c) 2025 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * Rebuilds ADVERSARY_BENCHMARKS and ADVERSARY_EXPERIENCES in scripts/rules.js from the
 * adversaries actually shipped by the Daggerheart system.
 *
 * Note the other generated artifact, data/compendium-stats-core.json, is NOT built here: the
 * statistics window reports prepared values, and fifteen adversaries carry an always-on effect
 * that raises their Difficulty above the number stored in the pack. Reproducing the system's
 * derivation outside Foundry would be a copy that drifts, so that file is produced inside a
 * world with `AM.BuildStatsSnapshot()` and saved into data/.
 *
 * The original table was hand-derived from the core rulebook alone. The system compendium is
 * now the union of the core book and Hope & Fear, so the table has to be re-derived whenever
 * the system adds adversaries.
 *
 * Getting the input (the pack is LevelDB; the running server holds a LOCK file, so copy first):
 *
 *   cp -r <foundry-data>/systems/daggerheart/packs/adversaries /tmp/dh && rm -f /tmp/dh/adversaries/LOCK
 *   fvtt package unpack adversaries --inputDirectory /tmp/dh --outputDirectory benchmark/system-adversaries \
 *     --type System --id daggerheart
 *
 * Then:
 *
 *   node tools/build-benchmarks.mjs benchmark/system-adversaries            # print a diff report
 *   node tools/build-benchmarks.mjs benchmark/system-adversaries --write    # rewrite scripts/rules.js
 *
 * How each field is derived — the table is guidance for re-tiering, not a census, so raw
 * min/max is deliberately not used where there is enough data to trim the outliers:
 *
 *   - numeric ranges: the 15th-85th percentile of the observed values when a type/tier cell has
 *     4+ adversaries, otherwise the full min/max unioned with the value already in rules.js
 *     (a 1-3 adversary cell is too thin to overrule the curated number).
 *   - a monotonic pass then forces tier N's floor and ceiling to be at least tier N-1's, so a
 *     thin cell can never suggest weaker stats than the tier below.
 *   - damage_rolls: the distinct formulas observed, dropping those averaging below 0.6x or
 *     above 1.6x the cell median (one-off gimmick attacks like "1d6+40"), most common first.
 *   - experiences: the curated list is kept and extended, never replaced. A name joins it when
 *     it appears on 2+ adversaries of that type or 3+ overall — that is what separates a reusable
 *     Experience from a bespoke one.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ADVERSARY_BENCHMARKS, ADVERSARY_EXPERIENCES } from "../scripts/rules.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RULES_PATH = path.join(ROOT, "scripts", "rules.js");
const TIERS = [1, 2, 3, 4];

// --- Input ---

/**
 * Reads every adversary Actor from one or more directories of unpacked pack JSON.
 * @param {string[]} dirs - Directories written by `fvtt package unpack`.
 * @returns {Object[]} Adversary source objects.
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
    return out;
}

/**
 * Normalizes the damage container across schema versions. Daggerheart 2.6 replaced
 * `damage.parts` with `damage.main` plus a `damage.resources` map.
 * @param {Object|null} damage - Raw damage container.
 * @returns {Object[]} Damage part objects.
 */
function damageParts(damage) {
    if (!damage || typeof damage !== "object") return [];
    if (damage.main !== undefined || damage.resources !== undefined) {
        const resources = damage.resources ?? {};
        return [damage.main, ...Object.values(resources)].filter(p => p && typeof p === "object");
    }
    const parts = damage.parts ?? {};
    return Object.values(parts).filter(p => p && typeof p === "object");
}

/**
 * Renders a damage value object as a formula string ("2d10+4", "7").
 * @param {Object|null} value - Damage value object.
 * @returns {string|null} Formula, or null when there is nothing to render.
 */
function formula(value) {
    if (!value || typeof value !== "object") return null;
    if (value.custom?.enabled && value.custom.formula) return String(value.custom.formula).trim();
    const bonus = value.bonus || 0;
    // A flat attack is stored as flatMultiplier 0 with the die field left behind, so the die
    // count — not the presence of a `dice` string — is what decides whether anything is rolled.
    const count = value.flatMultiplier ?? 1;
    if (!value.dice || count === 0) return bonus ? String(bonus) : null;
    const sign = bonus > 0 ? `+${bonus}` : (bonus < 0 ? String(bonus) : "");
    return `${count}${value.dice}${sign}`;
}

/**
 * Average result of a damage formula.
 * @param {string|null} f - Formula string.
 * @returns {number|null} Average, or null when unparseable.
 */
function averageOf(f) {
    if (!f) return null;
    const dice = /^(\d*)d(\d+)([+-]\d+)?$/.exec(f);
    if (!dice) return /^-?\d+$/.test(f) ? Number(f) : null;
    const count = Number(dice[1] || 1);
    const faces = Number(dice[2]);
    const bonus = Number(dice[3] || 0);
    return count * (faces + 1) / 2 + bonus;
}

/**
 * Projects one adversary into the flat record the aggregation works on.
 * @param {Object} doc - Adversary source object.
 * @returns {Object} Flat record.
 */
function project(doc) {
    const sys = doc.system ?? {};
    const parts = damageParts(sys.attack?.damage);
    const main = parts[0] ?? null;
    const experiences = Object.values(sys.experiences ?? {}).filter(e => e && typeof e === "object");
    const tier = Number(sys.tier) || 1;
    return {
        name: doc.name,
        type: String(sys.type || "standard").toLowerCase(),
        tier,
        systemVersion: doc._stats?.systemVersion ?? null,
        difficulty: sys.difficulty ?? null,
        major: sys.damageThresholds?.major ?? null,
        severe: sys.damageThresholds?.severe ?? null,
        hp: sys.resources?.hitPoints?.max ?? null,
        stress: sys.resources?.stress?.max ?? null,
        attack: sys.attack?.roll?.bonus ?? null,
        damage: main ? formula(main.value) : null,
        halved: main?.valueAlt ? formula(main.valueAlt) : null,
        experienceCount: experiences.length,
        experienceValues: experiences.map(e => e.value).filter(v => typeof v === "number"),
        experienceNames: experiences.map(e => e.name).filter(Boolean),
        // Kept only so minion_feature_x can read the X out of "Minion (N)".
        features: (doc.items ?? []).filter(i => i.type === "feature").map(i => i.name)
    };
}

// --- Aggregation ---

/**
 * Percentile of a sorted numeric array, nearest-rank.
 * @param {number[]} sorted - Ascending values.
 * @param {number} q - Quantile in [0, 1].
 * @returns {number} Value at that rank.
 */
function percentile(sorted, q) {
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))];
}

/**
 * Trimmed range for a cell, falling back to the curated value when the sample is too thin.
 * @param {number[]} values - Observed values.
 * @param {[number, number]|null} curated - Range already in rules.js, if any.
 * @returns {[number, number]|null} Inclusive range.
 */
function band(values, curated) {
    const clean = values.filter(v => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
    if (!clean.length) return curated;
    // A 1-3 adversary cell cannot outvote the curated number, so it widens it instead of replacing it.
    const thin = clean.length < 4;
    let lo = thin ? clean[0] : percentile(clean, 0.15);
    let hi = thin ? clean[clean.length - 1] : percentile(clean, 0.85);
    if (thin && curated) {
        lo = Math.min(lo, curated[0]);
        hi = Math.max(hi, curated[1]);
    }
    // A tightly clustered cell can trim down to a single number, which would make every re-tier
    // roll the same value. Give it one step of room back, but never past what was observed.
    if (lo === hi && clean[0] < clean[clean.length - 1]) {
        lo = Math.max(clean[0], lo - 1);
        hi = Math.min(clean[clean.length - 1], hi + 1);
    }
    return [Math.round(lo), Math.round(hi)];
}

/**
 * Parses "12/14" or "+2/+4" into a numeric range.
 * @param {string|number|null} text - Range string from rules.js.
 * @returns {[number, number]|null}
 */
function parseRange(text) {
    if (text === null || text === undefined) return null;
    const nums = String(text).match(/[+-]?\d+/g);
    if (!nums) return null;
    const values = nums.map(Number);
    return [Math.min(...values), Math.max(...values)];
}

/**
 * Formats a range the way rules.js stores it, collapsing a degenerate range to one value.
 * @param {[number, number]|null} range - Inclusive range.
 * @param {boolean} signed - Render explicit "+" on non-negative values.
 * @returns {string|null}
 */
function formatRange(range, signed = false) {
    if (!range) return null;
    const render = n => (signed && n >= 0 ? `+${n}` : String(n));
    return range[0] === range[1] ? render(range[0]) : `${render(range[0])}/${render(range[1])}`;
}

/**
 * Forces each tier's floor and ceiling to be at least the previous tier's, so a thin cell can
 * never suggest weaker stats than the tier below it.
 * @param {Object<string, [number, number]|null>} byTier - Ranges keyed "tier_1".."tier_4".
 * @returns {Object<string, [number, number]|null>} The same object, adjusted in place.
 */
function enforceMonotonic(byTier) {
    let previous = null;
    for (const tier of TIERS) {
        const key = `tier_${tier}`;
        const range = byTier[key];
        if (!range) continue;
        if (previous) {
            range[0] = Math.max(range[0], previous[0]);
            range[1] = Math.max(range[1], previous[1], range[0]);
        }
        previous = range;
    }
    return byTier;
}

/**
 * Picks the representative damage formulas for a cell.
 * @param {Object[]} records - Adversaries in the cell.
 * @param {"damage"|"halved"} key - Which formula to read.
 * @param {number} limit - Maximum formulas to keep.
 * @returns {{rolls: string[], averages: number[]}}
 */
function damageOptions(records, key, limit) {
    const counts = new Map();
    for (const r of records) {
        const f = r[key];
        if (!f || !/d\d/.test(f)) continue;
        counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    if (!counts.size) return { rolls: [], averages: [] };

    const averages = [...counts.keys()].map(averageOf).filter(v => v !== null).sort((a, b) => a - b);
    const median = percentile(averages, 0.5);
    // A single gimmick attack ("1d6+40", "4d20") would otherwise widen every suggestion downstream.
    const kept = [...counts.entries()]
        .filter(([f]) => {
            const avg = averageOf(f);
            return avg !== null && avg >= median * 0.6 && avg <= median * 1.6;
        })
        .sort((a, b) => b[1] - a[1] || averageOf(a[0]) - averageOf(b[0]))
        .slice(0, limit)
        .map(([f]) => f);

    const keptAverages = kept.map(averageOf).filter(v => v !== null);
    return { rolls: kept.sort((a, b) => averageOf(a) - averageOf(b)), averages: keptAverages };
}

/**
 * Names reusable enough to carry into the table: on 2+ adversaries of the type, or 3+ overall.
 * @param {Object[]} records - All adversary records.
 * @param {(r: Object) => string[]} pick - Reads the names off one record.
 * @param {(name: string) => string|null} normalize - Folds or rejects a name.
 * @returns {Map<string, Map<string, number>>} type -> name -> first tier seen.
 */
function reusableByType(records, pick, normalize) {
    const perType = new Map();
    const global = new Map();
    const firstTier = new Map();

    for (const r of records) {
        const names = new Set(pick(r).map(normalize).filter(Boolean));
        for (const name of names) {
            const key = `${r.type}|${name}`;
            perType.set(key, (perType.get(key) ?? 0) + 1);
            global.set(name, (global.get(name) ?? 0) + 1);
            firstTier.set(key, Math.min(firstTier.get(key) ?? 99, r.tier));
        }
    }

    const out = new Map();
    for (const [key, count] of perType) {
        const [type, name] = key.split("|");
        if (count < 2 && (global.get(name) ?? 0) < 3) continue;
        if (!out.has(type)) out.set(type, new Map());
        out.get(type).set(name, firstTier.get(key));
    }
    return out;
}

// --- Build ---

/**
 * Builds the new ADVERSARY_BENCHMARKS object.
 * @param {Object[]} records - Adversary records.
 * @returns {Object} Benchmark table.
 */
function buildBenchmarks(records) {
    const cells = new Map();
    for (const r of records) {
        const key = `${r.type}|${r.tier}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(r);
    }

    const out = {};

    for (const type of Object.keys(ADVERSARY_BENCHMARKS)) {
        const curatedTiers = ADVERSARY_BENCHMARKS[type].tiers;
        const isMinion = type === "minion";
        const isHorde = type === "horde";

        // Ranges are gathered per stat across all four tiers first, because the monotonic pass
        // needs the whole column before any of it can be written out.
        const stats = {};
        const named = ["difficulty", "hp", "stress", "attack", "major", "severe", "expCount", "expValue"];
        for (const stat of named) stats[stat] = {};

        for (const tier of TIERS) {
            const key = `tier_${tier}`;
            const cell = cells.get(`${type}|${tier}`) ?? [];
            const curated = curatedTiers[key] ?? {};
            const curatedThresholdLow = parseRange(curated.threshold_min);
            const curatedThresholdHigh = parseRange(curated.threshold_max);

            stats.difficulty[key] = band(cell.map(r => r.difficulty), parseRange(curated.difficulty));
            stats.hp[key] = band(cell.map(r => r.hp), parseRange(curated.hp));
            stats.stress[key] = band(cell.map(r => r.stress), parseRange(curated.stress));
            stats.attack[key] = band(cell.map(r => r.attack), parseRange(curated.attack_modifier));
            stats.expCount[key] = band(cell.map(r => r.experienceCount), parseRange(curated.experiences?.amount));
            stats.expValue[key] = band(cell.flatMap(r => r.experienceValues), parseRange(curated.experiences?.modifier));

            if (isMinion) {
                stats.major[key] = null;
                stats.severe[key] = null;
            } else {
                stats.major[key] = band(
                    cell.map(r => r.major),
                    curatedThresholdLow && curatedThresholdHigh ? [curatedThresholdLow[0], curatedThresholdHigh[0]] : null
                );
                stats.severe[key] = band(
                    cell.map(r => r.severe),
                    curatedThresholdLow && curatedThresholdHigh ? [curatedThresholdLow[1], curatedThresholdHigh[1]] : null
                );
            }
        }

        for (const stat of named) enforceMonotonic(stats[stat]);

        const tiers = {};
        for (const tier of TIERS) {
            const key = `tier_${tier}`;
            const cell = cells.get(`${type}|${tier}`) ?? [];
            const curated = curatedTiers[key] ?? {};
            const entry = {};

            entry.difficulty = formatRange(stats.difficulty[key]);

            if (isMinion) {
                entry.threshold_thresholds = "None";
            } else {
                const major = stats.major[key];
                const severe = stats.severe[key];
                if (major && severe) {
                    entry.threshold_min = `${major[0]}/${severe[0]}`;
                    entry.threshold_max = `${major[1]}/${severe[1]}`;
                }
            }

            entry.hp = formatRange(stats.hp[key]);
            entry.stress = formatRange(stats.stress[key]);
            entry.attack_modifier = formatRange(stats.attack[key], true);

            const main = damageOptions(cell, "damage", 6);
            if (main.rolls.length) {
                entry.damage_rolls = main.rolls;
                entry.avg_damage = formatRange([
                    Math.round(Math.min(...main.averages)),
                    Math.round(Math.max(...main.averages))
                ]);
            } else if (curated.damage_rolls) {
                entry.damage_rolls = [...curated.damage_rolls];
                if (curated.avg_damage) entry.avg_damage = curated.avg_damage;
            }

            if (isHorde) {
                const halved = damageOptions(cell, "halved", 4);
                entry.halved_damage_x = halved.rolls.length ? halved.rolls : (curated.halved_damage_x ?? []);
            }

            if (isMinion) {
                const xs = cell.flatMap(r => r.features
                    .map(f => /^Minion\s*\((\d+)\)$/i.exec(f))
                    .filter(Boolean)
                    .map(m => Number(m[1])));
                entry.minion_feature_x = formatRange(band(xs, parseRange(curated.minion_feature_x))) ?? curated.minion_feature_x;

                // Hope & Fear minions often roll dice instead of dealing a flat number, so both
                // shapes have to be offered — see the note on basic_attack_y in damage-engine.js.
                const flats = cell.map(r => r.damage).filter(f => f && /^\d+$/.test(f)).map(Number);
                entry.basic_attack_y = formatRange(band(flats, parseRange(curated.basic_attack_y))) ?? curated.basic_attack_y;
            }

            entry.experiences = {
                amount: formatRange(stats.expCount[key]) ?? curated.experiences?.amount,
                modifier: formatRange(stats.expValue[key], true) ?? curated.experiences?.modifier
            };

            tiers[key] = entry;
        }

        out[type] = { tiers };
    }

    return out;
}

/**
 * Builds the new ADVERSARY_EXPERIENCES lists (curated names kept, reusable ones added).
 * @param {Object[]} records - Adversary records.
 * @returns {Object<string, string[]>} Experience names by type.
 */
function buildExperiences(records) {
    const reusable = reusableByType(records, r => r.experienceNames, name => name);
    const out = {};
    for (const [type, names] of Object.entries(ADVERSARY_EXPERIENCES)) {
        const discovered = [...(reusable.get(type) ?? new Map()).keys()];
        out[type] = [...new Set([...names, ...discovered])];
    }
    return out;
}

// --- Output ---

/**
 * Serializes a value as the JS literal rules.js stores, matching the file's 2-space style.
 * @param {*} value - Value to render.
 * @param {number} indent - Current indent depth.
 * @returns {string}
 */
function literal(value, indent = 0) {
    const pad = "  ".repeat(indent);
    const padInner = "  ".repeat(indent + 1);
    if (Array.isArray(value)) {
        if (!value.length) return "[]";
        return `[\n${value.map(v => padInner + literal(v, indent + 1)).join(",\n")}\n${pad}]`;
    }
    if (value && typeof value === "object") {
        const keys = Object.keys(value);
        if (!keys.length) return "{}";
        return `{\n${keys.map(k => `${padInner}${JSON.stringify(k)}: ${literal(value[k], indent + 1)}`).join(",\n")}\n${pad}}`;
    }
    return JSON.stringify(value);
}

/**
 * Replaces one `export const NAME = {...};` block in the rules source.
 * @param {string} source - Full file text.
 * @param {string} name - Exported constant name.
 * @param {*} value - Replacement value.
 * @param {string} eol - Line ending used by the file.
 * @returns {string} Updated source.
 */
function replaceExport(source, name, value, eol) {
    const marker = `export const ${name} = {`;
    const start = source.indexOf(marker);
    if (start === -1) throw new Error(`${name} not found in scripts/rules.js`);

    let depth = 0;
    let end = -1;
    for (let i = start + marker.length - 1; i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") {
            depth--;
            if (depth === 0) { end = i + 1; break; }
        }
    }
    if (end === -1) throw new Error(`Unbalanced braces after ${name}`);

    const block = `export const ${name} = ${literal(value)};`.split("\n").join(eol);
    return source.slice(0, start) + block + source.slice(end + 1);
}

/**
 * Reports how each numeric range moved, so a rebuild is reviewable rather than a wall of diff.
 * @param {Object} next - Newly built benchmark table.
 */
function report(next) {
    const fields = ["difficulty", "hp", "stress", "attack_modifier", "threshold_min", "threshold_max", "minion_feature_x", "basic_attack_y"];
    for (const type of Object.keys(next)) {
        const lines = [];
        for (const tier of TIERS) {
            const key = `tier_${tier}`;
            const before = ADVERSARY_BENCHMARKS[type].tiers[key] ?? {};
            const after = next[type].tiers[key];
            for (const field of fields) {
                if (before[field] === undefined && after[field] === undefined) continue;
                if (String(before[field]) === String(after[field])) continue;
                lines.push(`    T${tier} ${field.padEnd(16)} ${String(before[field] ?? "-").padStart(9)} -> ${after[field] ?? "-"}`);
            }
        }
        if (lines.length) console.log(`${type}\n${lines.join("\n")}`);
    }
}

/**
 * Reads the system version off the data itself — every pack document carries the version of the
 * system that wrote it, so the snapshot's stamp can't drift from its contents.
 * @param {Object[]} records - Adversary records.
 * @returns {string|null} The version most of the documents were written by.
 */
function detectSystemVersion(records) {
    const counts = new Map();
    for (const r of records) {
        if (!r.systemVersion) continue;
        counts.set(r.systemVersion, (counts.get(r.systemVersion) ?? 0) + 1);
    }
    if (!counts.size) return null;
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

const args = process.argv.slice(2);
const write = args.includes("--write");
const dirs = args.filter(a => !a.startsWith("--"));

if (!dirs.length) {
    console.error("usage: node tools/build-benchmarks.mjs <unpacked-adversary-dir>... [--write]");
    process.exit(2);
}

const records = loadAdversaries(dirs).map(project);
console.log(`Read ${records.length} adversaries from ${dirs.join(", ")}\n`);

const benchmarks = buildBenchmarks(records);
const experiences = buildExperiences(records);
const systemVersion = detectSystemVersion(records);
report(benchmarks);

if (write) {
    const source = fs.readFileSync(RULES_PATH, "utf8");
    const eol = source.includes("\r\n") ? "\r\n" : "\n";
    let next = replaceExport(source, "ADVERSARY_BENCHMARKS", benchmarks, eol);
    next = replaceExport(next, "ADVERSARY_EXPERIENCES", experiences, eol);
    fs.writeFileSync(RULES_PATH, next);
    console.log(`\nWrote ${path.relative(ROOT, RULES_PATH)} from ${records.length} adversaries (system ${systemVersion ?? "unknown"}).`);
    console.log("Remember the statistics census is separate: run AM.BuildStatsSnapshot() in a world");
    console.log("and save the download as data/compendium-stats-core.json.");
} else {
    console.log("\n(dry run — pass --write to update scripts/rules.js)");
}
