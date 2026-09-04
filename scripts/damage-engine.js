/**
 * Shared utility functions for adversary stat calculation, damage processing,
 * and tier-scaling logic. Extracted from Manager to decouple business logic
 * from UI classes.
 *
 * Used by: Manager (batch update), LiveManager (preview + apply), EncounterBuilder.
 */
import { ADVERSARY_BENCHMARKS, PC_BENCHMARKS, ADVERSARY_EXPERIENCES } from "./rules.js";
import { MODULE_ID } from "./constants.js";
import { SETTING_CHAT_LOG, SETTING_UPDATE_EXP, SKULL_IMAGE_PATH } from "./module.js";
import { prepareDocumentCreateData, getCompendiumSource } from "./foundry-compat.js";

// --- Utility Parsers ---

/**
 * Parses a "min/max" range string and returns a random integer in that range.
 * @param {string} rangeString - A string like "10/15" or "10-15".
 * @returns {number|null} Random integer in range, or the single parsed value, or null.
 */
export function getRollFromRange(rangeString) {
    if (!rangeString) return null;
    const parts = rangeString.toString().split(/[\/–-]/).map(p => parseInt(p.trim())).filter(n => !isNaN(n));

    if (parts.length >= 2) {
        const min = parts[0];
        const max = parts[1];
        return Math.floor(Math.random() * (max - min + 1)) + min;
    } else if (parts.length === 1) {
        return parts[0];
    }
    return null;
}

/**
 * Parses a signed range string like "+2/+4" and returns a random integer.
 * @param {string} rangeString - A signed range string.
 * @returns {number|null} Random integer in range, or null.
 */
export function getRollFromSignedRange(rangeString) {
    if (!rangeString) return null;
    const matches = rangeString.toString().match(/[+-]?\d+/g);
    if (!matches) return null;
    if (matches.length >= 2) {
        const nums = matches.map(n => parseInt(n)).sort((a, b) => a - b);
        const min = nums[0];
        const max = nums[nums.length - 1];
        return Math.floor(Math.random() * (max - min + 1)) + min;
    } else if (matches.length === 1) {
        return parseInt(matches[0]);
    }
    return null;
}

/**
 * Splits a "major/severe" threshold string into an object.
 * @param {string} str - A string like "5/10".
 * @returns {{major: number, severe: number}|null}
 */
export function parseThresholdPair(str) {
    if (!str) return null;
    const parts = str.toString().split("/").map(p => parseInt(p.trim()));
    if (parts.length >= 2) {
        return { major: parts[0], severe: parts[1] };
    }
    return null;
}

/**
 * Parses a dice formula string like "2d8+6" into its components.
 * @param {string} dmgString - A damage formula string.
 * @returns {{count: number, die: string|null, bonus: number}|null}
 */
export function parseDamageString(dmgString) {
    if (!dmgString) return null;
    const str = dmgString.toString().trim();
    if (/^\d+$/.test(str)) {
         return { count: parseInt(str), die: null, bonus: 0 };
    }
    const regex = /(\d+)?(d\d+)\s*([+-]\s*\d+)?/;
    const match = str.match(regex);
    if (match) {
        return {
            count: match[1] ? parseInt(match[1]) : 1,
            die: match[2],
            bonus: match[3] ? parseInt(match[3].replace(/\s/g, '')) : 0
        };
    }
    return null;
}

// --- Hit Probability ---

/**
 * Calculates the hit probability of an adversary against a PC (1d20 vs Evasion).
 * Uses PC_BENCHMARKS evasion range for the given tier.
 * @param {number} attackBonus - The adversary's attack modifier.
 * @param {number} tier - The PC tier to compare against.
 * @returns {{text: string, tooltip: string}|null}
 */
export function calculateHitChance(attackBonus, tier) {
    if (isNaN(attackBonus) || !tier) return null;

    const pcStats = PC_BENCHMARKS[`tier_${tier}`];
    if (!pcStats || !pcStats.evasion) return null;

    const parts = pcStats.evasion.split("/").map(p => parseInt(p.trim()));
    if (parts.length < 2) return null;

    const minEvasion = Math.min(...parts);
    const maxEvasion = Math.max(...parts);

    const calculateChance = (target) => {
        let t = target;
        if (t < 1) t = 1;
        if (t > 20) return 0;
        return Math.round(((21 - t) / 20) * 100);
    };

    const bestCaseTarget = minEvasion - attackBonus;
    const maxChance = calculateChance(bestCaseTarget);

    const worstCaseTarget = maxEvasion - attackBonus;
    const minChance = calculateChance(worstCaseTarget);

    return {
        text: `(Min: ${minChance}% | Max: ${maxChance}%)`,
        tooltip: `Vs PC Tier ${tier} Evasion (${pcStats.evasion}):\nMin Evasion: ${maxChance}% chance to hit.\nMax Evasion: ${minChance}% chance to hit.`
    };
}

/**
 * Calculates the hit probability of a PC against the Adversary (2d12 vs Difficulty).
 * Success if (Roll + Bonus >= Difficulty) OR (Doubles).
 * @param {number} difficulty - The adversary's difficulty value.
 * @param {number} tier - The PC tier to compare against.
 * @returns {{text: string, tooltip: string}|null}
 */
export function calculateHitChanceAgainst(difficulty, tier) {
    if (!difficulty || isNaN(difficulty) || !tier) return null;

    const pcStats = PC_BENCHMARKS[`tier_${tier}`];
    if (!pcStats) return null;

    const minBonus = pcStats.standard_max_character_trait || 0;
    const maxBonus = pcStats.absolute_max_character_trait || 0;

    const calculate = (bonus) => {
        let hits = 0;
        const totalOutcomes = 144; // 12 * 12

        for (let d1 = 1; d1 <= 12; d1++) {
            for (let d2 = 1; d2 <= 12; d2++) {
                if (d1 === d2 || (d1 + d2 + bonus >= difficulty)) {
                    hits++;
                }
            }
        }

        return Math.round((hits / totalOutcomes) * 100);
    };

    const minChance = calculate(minBonus);
    const maxChance = calculate(maxBonus);

    return {
        text: `(Min: ${minChance}% | Max: ${maxChance}%)`,
        tooltip: `PC Hit Chance (2d12 + Trait vs Diff ${difficulty}):\nStandard Trait (+${minBonus}): ${minChance}%\nMax Trait (+${maxBonus}): ${maxChance}%`
    };
}

// --- Core Damage Logic ---

/**
 * Normalizes damage parts to an iterable array. Daggerheart v14 may store parts as a
 * keyed object instead of an array.
 * @param {Array|Object|null|undefined} parts - Raw damage parts container.
 * @returns {Array} Damage part objects.
 */
export function getDamagePartsArray(parts) {
    const isDamagePart = p => p && typeof p === "object" && ("value" in p || "valueAlt" in p || "type" in p);
    if (Array.isArray(parts)) return parts.filter(isDamagePart);
    if (parts && typeof parts === "object") {
        if (isDamagePart(parts)) return [parts];
        return Object.values(parts).filter(isDamagePart);
    }
    return [];
}

/**
 * Reports whether an action's damage object still uses the pre-2.6 `parts` container.
 * Daggerheart 2.6 replaced `damage.parts` with `damage.main` (the hitPoints part, which also
 * carries `direct`/`includeBase`/`groupAttack`) plus `damage.resources` (every other applyTo).
 * The system migrates `parts` away on load, so anything written to that path is silently
 * dropped by schema cleaning — hence the explicit branch instead of writing both shapes.
 * @param {Object|null|undefined} damage - An action's `damage` object.
 * @returns {boolean} True when the legacy `parts` container is the one in use.
 */
export function isLegacyDamageSchema(damage) {
    if (!damage) return false;
    return damage.main === undefined && damage.resources === undefined && damage.parts !== undefined;
}

/**
 * Resolves an action's damage container into a flat list of parts, main/hitPoints part first.
 * Parts are returned by reference so callers can keep mutating them in place.
 * @param {Object|null|undefined} damage - An action's `damage` object.
 * @returns {Array} Damage part objects.
 */
export function getActionDamageParts(damage) {
    if (!damage) return [];
    if (isLegacyDamageSchema(damage)) return getDamagePartsArray(damage.parts);

    const parts = [];
    if (damage.main) parts.push(damage.main);
    parts.push(...getDamagePartsArray(damage.resources));
    return parts;
}

/**
 * Returns the main (hitPoints) damage part of an action, or null when it has none.
 * @param {Object|null|undefined} damage - An action's `damage` object.
 * @returns {Object|null}
 */
export function getMainDamagePart(damage) {
    return getActionDamageParts(damage)[0] ?? null;
}

/**
 * Reads a damage part's type list. The system stores it in a SetField, so a live DataModel
 * hands back a Set while source data hands back an array.
 * @param {Object|null|undefined} part - A damage part.
 * @returns {string[]} Damage type ids, as stored.
 */
export function getDamageTypeList(part) {
    const type = part?.type;
    if (!type) return [];
    if (typeof type === "string") return [type];
    if (Array.isArray(type) || type instanceof Set) return Array.from(type, t => String(t));
    return [];
}

/**
 * Reports how many dice a damage value actually rolls.
 * A flat attack is stored two ways in the system's own data: with no die at all, or — the shape
 * the Hope & Fear adversaries use — as `flatMultiplier: 0` with the die string left in place.
 * So the die count, never the presence of `dice`, is what decides whether anything is rolled.
 * @param {Object|null|undefined} value - A damage part's `value` or `valueAlt`.
 * @returns {number} Number of dice rolled; 0 for flat damage.
 */
export function getDiceCount(value) {
    if (!value?.dice) return 0;
    const count = value.flatMultiplier;
    return (count === undefined || count === null) ? 1 : (Number(count) || 0);
}

/**
 * Reads the flat damage number out of a value that rolls no dice. Pre-2.6 data keeps it in
 * `flatMultiplier` with an empty die; Hope & Fear data keeps it in `bonus` with the die zeroed.
 * @param {Object|null|undefined} value - A damage part's `value` or `valueAlt`.
 * @returns {number} The flat damage dealt.
 */
export function getFlatDamage(value) {
    if (!value) return 0;
    return value.dice ? (Number(value.bonus) || 0) : (Number(value.flatMultiplier) || 0);
}

/**
 * Renders a damage value as the formula string shown in the UI and in the change log.
 * @param {Object|null|undefined} value - A damage part's `value` or `valueAlt`.
 * @returns {string} Formula such as "2d10+4" or "12".
 */
export function formatDamageValue(value) {
    if (!value) return "";
    if (value.custom?.enabled && value.custom.formula) return String(value.custom.formula);

    const count = getDiceCount(value);
    if (count === 0) return String(getFlatDamage(value));

    const bonus = Number(value.bonus) || 0;
    const bonusStr = bonus ? (bonus > 0 ? `+${bonus}` : `${bonus}`) : "";
    return `${count}${value.dice}${bonusStr}`;
}

/**
 * Reads the "direct damage" flag, which moved onto the main part in Daggerheart 2.6.
 * @param {Object|null|undefined} damage - An action's `damage` object.
 * @returns {boolean}
 */
export function getDamageDirect(damage) {
    if (!damage) return false;
    if (isLegacyDamageSchema(damage)) return damage.direct ?? false;
    return damage.main?.direct ?? false;
}

/**
 * Builds the update payload that writes a mutated damage container back to an actor's attack.
 * `system.attack` is an ObjectField, so this merges rather than replacing sibling keys — which
 * lets us submit the whole container and stay agnostic about which schema shape it holds.
 * @param {Object|null|undefined} damage - The mutated `damage` object (from source data).
 * @returns {Object} Partial update data keyed by document path.
 */
export function buildAttackDamageUpdate(damage) {
    return damage ? { "system.attack.damage": damage } : {};
}

/**
 * Sets the "direct damage" flag on a damage container, which moved onto the main part in
 * Daggerheart 2.6. Mutates `damage` in place so the caller can submit it as one payload.
 * @param {Object|null|undefined} damage - An action's `damage` object (from source data).
 * @param {boolean} value - The flag to store.
 * @returns {boolean} True when the flag had somewhere to go.
 */
export function applyDirectDamage(damage, value) {
    if (!damage) return false;
    if (isLegacyDamageSchema(damage)) {
        damage.direct = value;
        return true;
    }
    // A null `main` means the adversary has no hitPoints damage to mark as direct.
    if (!damage.main) return false;
    damage.main.direct = value;
    return true;
}

/**
 * Selects the best matching damage formula from the benchmark list for the new tier.
 * @param {string|null} currentDie - Current die type (e.g. "d8") or null for flat damage.
 * @param {number} currentBonus - Current bonus value.
 * @param {number} newTier - Target tier.
 * @param {number} currentTier - Current tier.
 * @param {string[]} damageRolls - Array of benchmark damage formula strings.
 * @returns {{count: number, die: string|null, bonus: number}}
 */
export function calculateNewDamage(currentDie, currentBonus, newTier, currentTier, damageRolls) {
    let result = { count: 1, die: "d12", bonus: 0 };

    if (currentDie === null) {
        const tierDiff = newTier - currentTier;
        result = { count: 0, die: null, bonus: currentBonus + (tierDiff * 2) };
    } else {
        const options = (damageRolls || []).map(str => parseDamageString(str)).filter(o => o !== null && o.die !== null);

        let chosenOption = options.find(o => o.die === currentDie);
        if (!chosenOption) {
            chosenOption = options.find(o => o.die === currentDie);
        }
        if (!chosenOption) {
            chosenOption = options[0];
        }

        if (chosenOption) {
            result = { count: chosenOption.count, die: chosenOption.die, bonus: chosenOption.bonus };
        } else {
            result = { count: newTier, die: "d12", bonus: newTier * 2 };
        }
    }

    if (newTier > currentTier) {
        if (result.bonus < currentBonus) {
            result.bonus = currentBonus;
        }
    }
    return result;
}

/**
 * Processes a single damage part value object and applies tier scaling.
 * Handles custom formulas, flat damage, and standard dice.
 * @param {Object} val - The damage value object from the actor data.
 * @param {number} newTier - Target tier.
 * @param {number} currentTier - Current tier.
 * @param {string[]} damageRolls - Benchmark damage formula strings.
 * @returns {{from: string, to: string, isCustom: boolean}|null}
 */
export function processDamageValue(val, newTier, currentTier, damageRolls) {
    if (!val) return null;

    let currentDie = val.dice || "d12";
    let currentBonus = val.bonus || 0;
    let currentCount = val.flatMultiplier || 1;

    let isCustom = false;
    let isFlatFixed = false;
    let oldFormula = "";

    if (val.custom?.enabled === true && val.custom.formula) {
        const parsed = parseDamageString(val.custom.formula);
        oldFormula = val.custom.formula;

        if (parsed && parsed.die === null) return null;

        if (parsed) {
            currentDie = parsed.die;
            currentBonus = parsed.bonus;
            currentCount = parsed.count;
            isCustom = true;
        } else {
            return null;
        }
    }

    if (!isCustom && getDiceCount(val) === 0) {
            isFlatFixed = true;
            currentDie = null;
            currentBonus = getFlatDamage(val);
            oldFormula = `${currentBonus}`;
    } else if (!isCustom) {
        const sign = (currentBonus && currentBonus >= 0) ? "+" : "";
        const bonusStr = currentBonus ? `${sign}${currentBonus}` : "";
        oldFormula = `${currentCount}${currentDie}${bonusStr}`;
    }

    const bonusInput = isFlatFixed ? (isCustom ? currentCount : currentBonus) : currentBonus;

    const newDmg = calculateNewDamage(currentDie, bonusInput, newTier, currentTier, damageRolls);

    let newFormula = "";
    let changesApplied = false;

    if (isCustom) {
        if (newDmg.die === null) {
                newFormula = `${newDmg.bonus}`;
        } else {
            const sign = newDmg.bonus >= 0 ? "+" : "";
            const bonusStr = newDmg.bonus !== 0 ? `${sign}${newDmg.bonus}` : "";
            newFormula = `${newDmg.count}${newDmg.die}${bonusStr}`;
        }

        if (val.custom.formula !== newFormula) {
            val.custom.formula = newFormula;
            changesApplied = true;
        }

    } else {
        if (newDmg.die === null) {
            // Written back in the shape it arrived in: pre-2.6 data carries the flat number in
            // flatMultiplier with no die, Hope & Fear data keeps the die and carries it in bonus.
            if (val.dice) {
                val.flatMultiplier = 0;
                val.bonus = newDmg.bonus;
            } else {
                val.flatMultiplier = newDmg.bonus;
                val.dice = "";
                val.bonus = null;
            }
            newFormula = `${newDmg.bonus}`;
        } else {
            val.flatMultiplier = newDmg.count;
            val.dice = newDmg.die;
            val.bonus = newDmg.bonus;

            const sign = newDmg.bonus >= 0 ? "+" : "";
            const bonusStr = newDmg.bonus !== 0 ? `${sign}${newDmg.bonus}` : "";
            newFormula = `${newDmg.count}${newDmg.die}${bonusStr}`;
        }
        val.multiplier = "flat";
        changesApplied = true;
    }

    if (changesApplied) {
        return { from: oldFormula, to: newFormula, isCustom: isCustom };
    }
    return null;
}

/**
 * Iterates all damage parts of an attack, applying auto-scaling or forced overrides.
 * Handles Minion flat-damage and Horde halved-damage paths.
 * @param {Array|Object} parts - Damage part objects as an array or keyed object.
 * @param {number} newTier - Target tier.
 * @param {number} currentTier - Current tier.
 * @param {Object} benchmark - Tier benchmark data.
 * @param {string|Object|null} forceFormula - Manual override formula or map of overrides.
 * @returns {{hasChanges: boolean, changes: Array}}
 */
export function updateDamageParts(parts, newTier, currentTier, benchmark, forceFormula = null) {
    let hasChanges = false;
    const changes = [];
    const damageParts = getDamagePartsArray(parts);

    if (!damageParts.length) return { hasChanges, changes };

    // Handle Legacy String Override (Applies to first part only)
    if (typeof forceFormula === 'string' && forceFormula) {
        const parsed = parseDamageString(forceFormula);
        if (parsed) {
            const part = damageParts.find(p => p.value);
            if (part) {
                let oldFormula = formatDamageValue(part.value);

                if (parsed.die === null) {
                    if (!part.value.custom) part.value.custom = {};
                    part.value.custom.enabled = true;
                    part.value.custom.formula = `${parsed.count}`;
                    part.value.flatMultiplier = parsed.count;
                    part.value.dice = "";
                    part.value.bonus = null;
                } else {
                    part.value.flatMultiplier = parsed.count;
                    part.value.dice = parsed.die;
                    part.value.bonus = parsed.bonus;
                    if (part.value.custom) part.value.custom.enabled = false;
                }

                hasChanges = true;
                changes.push({ from: oldFormula, to: forceFormula, isCustom: false, labelSuffix: "" });
                return { hasChanges, changes };
            }
        }
    }

    // Standard logic with Multipart Override Support (Object Map)
    damageParts.forEach(part => {
        // MINION CHECK: If benchmark has 'basic_attack_y', use it instead of scaling
        if (benchmark.basic_attack_y && part.value) {
            const currentFormula = formatDamageValue(part.value);
            const newVal = getRollFromRange(benchmark.basic_attack_y);

            if (newVal !== null) {
                if (!part.value.custom) part.value.custom = {};

                part.value.custom.enabled = true;
                part.value.custom.formula = String(newVal);
                part.value.flatMultiplier = newVal;
                // Hope & Fear minions carry their flat damage in `bonus` with the die zeroed.
                // Left behind, that bonus resurfaces as NdX+bonus the moment custom is unticked.
                part.value.bonus = null;

                if (currentFormula !== String(newVal)) {
                    hasChanges = true;
                    changes.push({ from: currentFormula, to: String(newVal), isCustom: true, labelSuffix: "" });
                } else {
                    changes.push({ from: currentFormula, to: String(newVal), isCustom: true, labelSuffix: "", unchanged: true });
                }
                return;
            }
        }

        // Determine Current Formula for Lookup
        const currentPartFormula = part.value ? formatDamageValue(part.value) : "";

        // Normal Adversary Logic
        if (part.value) {
            // CHECK SPECIFIC OVERRIDE FOR THIS PART
            let overrideVal = null;
            if (typeof forceFormula === 'object' && forceFormula !== null) {
                if (forceFormula[currentPartFormula]) {
                    overrideVal = forceFormula[currentPartFormula];
                }
            }

            if (overrideVal) {
                // Apply Manual Override
                const parsed = parseDamageString(overrideVal);
                if (parsed) {
                    let oldFormula = currentPartFormula;
                    if (parsed.die === null) {
                        if (!part.value.custom) part.value.custom = {};
                        part.value.custom.enabled = true;
                        part.value.custom.formula = `${parsed.count}`;
                        part.value.flatMultiplier = parsed.count;
                        part.value.dice = "";
                        part.value.bonus = null;
                    } else {
                        part.value.flatMultiplier = parsed.count;
                        part.value.dice = parsed.die;
                        part.value.bonus = parsed.bonus;
                        if (part.value.custom) part.value.custom.enabled = false;
                    }
                    hasChanges = true;
                    changes.push({ from: oldFormula, to: overrideVal, isCustom: false, labelSuffix: "" });
                }
            } else {
                // Apply Auto Calc
                const update = processDamageValue(part.value, newTier, currentTier, benchmark.damage_rolls);
                if (update) {
                    hasChanges = true;
                    changes.push({ ...update, labelSuffix: "" });
                }
            }
        }
        if (part.valueAlt && benchmark.halved_damage_x) {
            const updateAlt = processDamageValue(part.valueAlt, newTier, currentTier, benchmark.halved_damage_x);
            if (updateAlt) {
                hasChanges = true;
                changes.push({ ...updateAlt, labelSuffix: " (Alt)" });
            }
        }
    });

    return { hasChanges, changes };
}

/**
 * Processes a single feature item: scales damage actions, renames Horde/Minion features,
 * applies manual name/damage overrides. Returns update payload and structured change data.
 * @param {Object} itemData - The item data object.
 * @param {number} newTier - Target tier.
 * @param {number} currentTier - Current tier.
 * @param {Object} benchmark - Tier benchmark data.
 * @param {Array} changeLog - Array to push change log messages into.
 * @param {Object} nameOverrides - Map of itemId -> new name.
 * @param {Object} damageOverrides - Map of itemId -> damage formula override.
 * @param {Object} templates - Template data for Minion/Horde features.
 * @returns {{update: Object|null, structured: Array}|null}
 */
export function processFeatureUpdate(itemData, newTier, currentTier, benchmark, changeLog = [], nameOverrides = {}, damageOverrides = {}, templates = {}) {
    let hasChanges = false;
    const system = foundry.utils.deepClone(itemData.system);
    const replacements = [];
    const structuredChanges = [];

    let actionsRaw = system.actions;
    let manualDamage = damageOverrides[itemData._id] || null;

    // 1. Process Actions & Damage
    if (actionsRaw) {
        for (const actionId in actionsRaw) {
            const action = actionsRaw[actionId];
            const actionDamageParts = getActionDamageParts(action.damage);
            if (actionDamageParts.length) {
                const result = updateDamageParts(actionDamageParts, newTier, currentTier, benchmark, manualDamage);
                if (result.hasChanges) {
                    hasChanges = true;
                }
                result.changes.forEach(c => {
                    if (!c.unchanged) {
                        const customLabel = c.isCustom ? " (Custom)" : "";
                        const altLabel = c.labelSuffix || "";
                        const logMsg = `<strong>${itemData.name}:</strong> ${c.from} -> ${c.to}${customLabel}${altLabel}`;
                        changeLog.push(logMsg);
                        replacements.push(c);
                    }

                    structuredChanges.push({
                        itemId: itemData._id,
                        itemName: itemData.name,
                        type: c.unchanged ? "damage_readonly" : "damage",
                        from: c.from,
                        to: c.to
                    });
                });
            }
        }
    }

    // 2. Process Name Updates (Horde/Minion)
    let newName = itemData.name;
    let updateDesc = false;
    let minionVal = null;

    // Check for manual name overrides first
    if (nameOverrides && nameOverrides[itemData._id]) {
        newName = nameOverrides[itemData._id];
        if (newName !== itemData.name) {
            changeLog.push(`<strong>Name Override:</strong> ${itemData.name} -> ${newName}`);
            hasChanges = true;

            const isMinion = newName.match(/^Minion\s*\((\d+)\)$/i);
            const isHorde = newName.match(/^Horde\s*\((.+)\)$/i);

            let uiImg = itemData.img;
            let uiUuid = getCompendiumSource(itemData);
            let type = "name_override";

            if (isMinion) {
                type = "name_minion";
                uiImg = templates.minion?.img || uiImg;
                uiUuid = templates.minionUuid || uiUuid;
            } else if (isHorde) {
                type = "name_horde";
                uiImg = templates.horde?.img || uiImg;
                uiUuid = templates.hordeUuid || uiUuid;
            }

            structuredChanges.push({
                itemId: itemData._id,
                itemName: itemData.name,
                type: type,
                from: itemData.name,
                to: newName,
                img: uiImg,
                uuid: uiUuid
            });
        }
        const mMatch = newName.match(/^Minion\s*\((\d+)\)$/i);
        if (mMatch) {
            minionVal = parseInt(mMatch[1]);
        }
    } else {
        // Automatic Calculation

        // Horde Logic
        const hordeMatch = itemData.name.trim().match(/^Horde(\s*\((.+)\))?$/i);
        if (hordeMatch) {
            let newDmgStr = null;

            if (manualDamage) {
                if (typeof manualDamage === 'string') {
                    newDmgStr = manualDamage;
                }
            } else {
                const oldDmgInName = hordeMatch[2];
                if (oldDmgInName && oldDmgInName !== "X") {
                    const parsed = parseDamageString(oldDmgInName);
                    if (parsed) {
                        let bonusInput = parsed.bonus;
                        if (parsed.die === null) bonusInput = parsed.count;

                        const newDmg = calculateNewDamage(
                            parsed.die,
                            bonusInput,
                            newTier,
                            currentTier,
                            benchmark.damage_rolls
                        );

                        if (newDmg.die === null) {
                            newDmgStr = `${newDmg.bonus}`;
                        } else {
                            const sign = newDmg.bonus >= 0 ? "+" : "";
                            const bonusStr = newDmg.bonus !== 0 ? `${sign}${newDmg.bonus}` : "";
                            newDmgStr = `${newDmg.count}${newDmg.die}${bonusStr}`;
                        }
                    }
                } else if (benchmark.halved_damage_x) {
                     newDmgStr = benchmark.halved_damage_x[0];
                }
            }

            if (newDmgStr) {
                newName = `Horde (${newDmgStr})`;
                if (itemData.name !== newName) {
                    changeLog.push(`<strong>Name Update:</strong> ${itemData.name} -> ${newName}`);
                    hasChanges = true;
                    structuredChanges.push({
                        itemId: itemData._id,
                        itemName: itemData.name,
                        type: "name_horde",
                        from: itemData.name,
                        to: newName,
                        img: templates.horde?.img || itemData.img,
                        uuid: templates.hordeUuid || itemData.uuid || getCompendiumSource(itemData)
                    });
                }

                // Replace [X] in description with new damage string
                if (system.description) {
                     if (system.description.includes("[X]")) {
                         system.description = system.description.replace(/\[X\]/g, newDmgStr);
                         hasChanges = true;
                     } else if (system.description.includes("(X)")) {
                         system.description = system.description.replace(/\(X\)/g, `(${newDmgStr})`);
                         hasChanges = true;
                     }
                     else {
                         const oldVal = hordeMatch[2];
                         if (oldVal && oldVal !== "X" && system.description.includes(oldVal)) {
                             const escaped = oldVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                             const re = new RegExp(escaped, 'g');
                             system.description = system.description.replace(re, newDmgStr);
                             hasChanges = true;
                         }
                     }
                }
            }
        }

        // Minion Logic (Renaming Feature)
        const minionMatch = itemData.name.trim().match(/^Minion(\s*\((\d+)\))?$/i);
        if (minionMatch && benchmark.minion_feature_x) {
            const newVal = getRollFromRange(benchmark.minion_feature_x);
            if (newVal !== null) {
                newName = `Minion (${newVal})`;
                minionVal = newVal;
                if (itemData.name !== newName) {
                    changeLog.push(`<strong>Name Update:</strong> ${itemData.name} -> ${newName}`);
                    hasChanges = true;
                    structuredChanges.push({
                        itemId: itemData._id,
                        itemName: itemData.name,
                        type: "name_minion",
                        from: itemData.name,
                        to: newName,
                        img: templates.minion?.img || itemData.img,
                        uuid: templates.minionUuid || itemData.uuid || getCompendiumSource(itemData)
                    });
                }
            }
        }
    }

    // Apply Name Change
    if (hasChanges && itemData.name !== newName) {
        itemData.name = newName;
    }

    // Apply Description Updates (Minion)
    if (minionVal !== null) {
        if (system.description) {
            if (system.description.includes("[X]")) {
                system.description = system.description.replace(/\[X\]/g, minionVal);
                hasChanges = true;
            } else if (system.description.includes("(X)")) {
                system.description = system.description.replace(/\(X\)/g, `(${minionVal})`);
                hasChanges = true;
            }
        }
    }

    // 4. Apply Text Replacements
    if (hasChanges && replacements.length > 0) {
        const performReplacement = (text) => {
            if (!text) return text;
            let newText = text;
            for (const rep of replacements) {
                if (!rep.from || !rep.to || rep.from === rep.to) continue;
                const escapedFrom = rep.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(escapedFrom, 'g');

                if (/^\d+$/.test(rep.from) && rep.from.length < 2) {
                     const boldRegex = new RegExp(`<strong>${escapedFrom}</strong>`, 'g');
                     newText = newText.replace(boldRegex, `<strong>${rep.to}</strong>`);
                } else {
                    newText = newText.replace(regex, rep.to);
                }
            }
            return newText;
        };

        if (system.description && !system.description.includes("[X]")) {
             system.description = performReplacement(system.description);
        }
        if (actionsRaw) {
            for (const actionId in actionsRaw) {
                if (actionsRaw[actionId].description) {
                    actionsRaw[actionId].description = performReplacement(actionsRaw[actionId].description);
                }
            }
        }
    }

    if (hasChanges) {
        return {
            update: { _id: itemData._id, system: system, name: newName },
            structured: structuredChanges
        };
    }
    if (structuredChanges.length > 0) {
        return { update: null, structured: structuredChanges };
    }
    return null;
}

// --- Feature Management ---

/**
 * Finds features in module compendiums and prepares them for creation on an actor.
 * Handles Minion(X) template substitution and Relentless replacement logic.
 * Only adds what was asked for by name — the module has no opinion about which features suit a
 * tier, so nothing is ever added on its own.
 * @param {Actor} actor - The actor receiving new features.
 * @param {Array} changeLog - Array to push change log messages into.
 * @param {string[]|null} featureNames - Features to add, by name.
 * @returns {Promise<{toCreate: Array, toDelete: Array}>}
 */
export async function handleNewFeatures(actor, changeLog, featureNames = null) {
    if (!Array.isArray(featureNames) || featureNames.length === 0) return { toCreate: [], toDelete: [] };

    const currentItems = actor.items.contents || actor.items;
    const featuresToAdd = featureNames.filter(name => !currentItems.some(i => i.name === name));

    if (featuresToAdd.length === 0) return { toCreate: [], toDelete: [] };

    const packIds = ["daggerheart-advmanager.all-features", "daggerheart-advmanager.custom-features"];

    const toCreate = [];
    const toDelete = [];

    for (const featureName of featuresToAdd) {
        let featureData = null;
        let sourceUuid = null;

        for (const packId of packIds) {
            const pack = game.packs.get(packId);
            if (!pack) continue;

            const index = await pack.getIndex();
            const entry = index.find(e => e.name === featureName);

            if (entry) {
                const doc = await pack.getDocument(entry._id);
                featureData = prepareDocumentCreateData(doc, game.items);
                sourceUuid = doc.uuid;
                break;
            }
        }

        // Special Fallback: Minion (X) Logic
        if (!featureData) {
            const minionMatch = featureName.match(/^Minion\s*\((\d+)\)$/i);
            if (minionMatch) {
                const minionVal = minionMatch[1];
                const customPack = game.packs.get("daggerheart-advmanager.custom-features");
                if (customPack) {
                    const index = await customPack.getIndex();
                    const templateEntry = index.find(e => e.name === "Minion (X)");
                    if (templateEntry) {
                        const doc = await customPack.getDocument(templateEntry._id);
                        featureData = prepareDocumentCreateData(doc, game.items);
                        sourceUuid = doc.uuid;

                        featureData.name = featureName;
                        if (featureData.system.description) {
                            featureData.system.description = featureData.system.description.replace(/\[X\]/g, minionVal);
                            featureData.system.description = featureData.system.description.replace(/\(X\)/g, `(${minionVal})`);
                        }
                    }
                }
            }
        }

        if (!featureData) {
            console.warn(`Adversary Manager | Could not find feature "${featureName}" in any configured compendium.`);
            continue;
        }

        // Record provenance in the v13+ location. prepareDocumentCreateData already carries it
        // over from fromCompendium(); this also covers the Minion (X) template path, which is
        // renamed after cloning. flags.core.sourceId is the deprecated spot the system ignores.
        if (sourceUuid) foundry.utils.setProperty(featureData, "_stats.compendiumSource", sourceUuid);

        toCreate.push(featureData);

        // Handle Relentless Replacement Logic
        const relentlessMatch = featureName.match(/^Relentless\s*\((\d+)\)$/i);
        if (relentlessMatch) {
            const existingRelentless = currentItems.find(i => i.name.match(/^Relentless\s*\((\d+)\)$/i));
            if (existingRelentless) {
                toDelete.push(existingRelentless.id);
                changeLog.push(`<strong>New Feature:</strong> ${featureName} (Replaced ${existingRelentless.name})`);
            } else {
                changeLog.push(`<strong>New Feature:</strong> ${featureName}`);
            }
        } else {
            changeLog.push(`<strong>New Feature:</strong> ${featureName}`);
        }
    }

    return { toCreate, toDelete };
}

// --- Actor Update ---

/**
 * The central write method for updating a single actor's stats to a new tier.
 * Builds update data covering: name, difficulty, HP, stress, thresholds,
 * attack modifier, sheet damage, experiences, and features.
 * @param {Actor} actor - The actor to update.
 * @param {number} newTier - Target tier.
 * @param {Object} overrides - Manual override values from the UI.
 * @returns {Promise<Object|null>} Result object with logs, or null if no changes.
 */
export async function updateSingleActor(actor, newTier, overrides = {}) {
    const actorData = actor.toObject();
    const currentTier = Number(actorData.system.tier) || 1;

    const isBatchNoOp = (newTier === currentTier) && (Object.keys(overrides).length === 0);
    if (isBatchNoOp) return null;

    const updateData = { "system.tier": newTier };
    const typeKey = (actorData.system.type || "standard").toLowerCase();
    const statsLog = [];
    const featureLog = [];
    const structuredFeatureChanges = [];

    if (!ADVERSARY_BENCHMARKS[typeKey]) return null;
    const benchmark = ADVERSARY_BENCHMARKS[typeKey].tiers[`tier_${newTier}`];
    if (!benchmark) return null;

    // 1. Update Name
    let newName = actorData.name;
    const tierTagRegex = /\s*\(T\d+\)$/;
    const newTag = ` (T${newTier})`;
    if (tierTagRegex.test(newName)) newName = newName.replace(tierTagRegex, newTag);
    else newName = newName + newTag;
    updateData["name"] = newName;

    // 2. Update Stats (With Overrides)
    const diff = overrides.difficulty !== undefined ? Number(overrides.difficulty) : getRollFromRange(benchmark.difficulty);
    if (diff) { updateData["system.difficulty"] = diff; statsLog.push(`<strong>Diff:</strong> ${actorData.system.difficulty} -> ${diff}`); }

    const hp = overrides.hp !== undefined ? Number(overrides.hp) : getRollFromRange(benchmark.hp);
    if (hp) { updateData["system.resources.hitPoints.max"] = hp; updateData["system.resources.hitPoints.value"] = 0; statsLog.push(`<strong>HP:</strong> ${actorData.system.resources.hitPoints.max} -> ${hp}`); }

    const stress = overrides.stress !== undefined ? Number(overrides.stress) : getRollFromRange(benchmark.stress);
    if (stress) { updateData["system.resources.stress.max"] = stress; statsLog.push(`<strong>Stress:</strong> ${actorData.system.resources.stress.max} -> ${stress}`); }

    if (benchmark.threshold_min && benchmark.threshold_max) {
        let major, severe;
        if (overrides.major && overrides.severe) {
            major = Number(overrides.major); severe = Number(overrides.severe);
        } else {
            const minPair = parseThresholdPair(benchmark.threshold_min);
            const maxPair = parseThresholdPair(benchmark.threshold_max);
            if (minPair && maxPair) {
                major = Math.floor(Math.random() * (maxPair.major - minPair.major + 1)) + minPair.major;
                severe = Math.floor(Math.random() * (maxPair.severe - minPair.severe + 1)) + minPair.severe;
            }
        }
        if (major && severe) {
            updateData["system.damageThresholds.major"] = major;
            updateData["system.damageThresholds.severe"] = severe;
            statsLog.push(`<strong>Dmg Thresh:</strong> ${actorData.system.damageThresholds.major}/${actorData.system.damageThresholds.severe} -> ${major}/${severe}`);
        }
    }

    const atkMod = overrides.attackMod !== undefined ? Number(overrides.attackMod) : getRollFromSignedRange(benchmark.attack_modifier);
    if (atkMod !== null && !isNaN(atkMod)) {
        updateData["system.attack.roll.bonus"] = atkMod;
        const oldAtk = actorData.system.attack.roll.bonus;
        const sign = atkMod >= 0 ? "+" : "";
        statsLog.push(`<strong>Atk Mod:</strong> ${oldAtk} -> ${sign}${atkMod}`);
    }

    // 3. Update Sheet Damage (Main Attack)
    let calculatedHalvedDamage = null;

    const sheetDamage = actorData.system.attack?.damage
        ? foundry.utils.deepClone(actorData.system.attack.damage)
        : null;
    const sheetDamagePartList = getActionDamageParts(sheetDamage);

    if (sheetDamagePartList.length > 0) {
        if (overrides.damageFormula && sheetDamagePartList.length > 0) {
            const parsed = parseDamageString(overrides.damageFormula);
            if (parsed) {
                const part = sheetDamagePartList[0];
                if (part.value) {
                    if (parsed.die === null) {
                        part.value.flatMultiplier = parsed.count;
                        part.value.dice = "";
                        part.value.bonus = null;
                    } else {
                        part.value.flatMultiplier = parsed.count;
                        part.value.dice = parsed.die;
                        part.value.bonus = parsed.bonus;
                    }
                    Object.assign(updateData, buildAttackDamageUpdate(sheetDamage));
                    statsLog.push(`<strong>Sheet Dmg (Manual):</strong> ${overrides.damageFormula}`);
                }
            }
        }

        if (overrides.halvedDamageFormula && sheetDamagePartList.length > 0) {
             calculatedHalvedDamage = overrides.halvedDamageFormula;
             const parsed = parseDamageString(overrides.halvedDamageFormula);
             if (parsed && sheetDamagePartList[0].valueAlt) {
                 const part = sheetDamagePartList[0];
                 if (part.valueAlt) {
                     if (parsed.die === null) {
                        part.valueAlt.flatMultiplier = parsed.count;
                        part.valueAlt.dice = "";
                        part.valueAlt.bonus = null;
                     } else {
                        part.valueAlt.flatMultiplier = parsed.count;
                        part.valueAlt.dice = parsed.die;
                        part.valueAlt.bonus = parsed.bonus;
                     }
                 }
             }
        }

        const result = updateDamageParts(sheetDamagePartList, newTier, currentTier, benchmark);
        if (result.hasChanges) {
            Object.assign(updateData, buildAttackDamageUpdate(sheetDamage));
            result.changes.forEach(c => {
                statsLog.push(`<strong>Sheet Dmg:</strong> ${c.from} -> ${c.to}`);
                if (c.labelSuffix === " (Alt)" && !overrides.halvedDamageFormula) {
                     calculatedHalvedDamage = c.to;
                }
            });
        }

        if (!calculatedHalvedDamage && sheetDamagePartList.length > 0 && sheetDamagePartList[0].valueAlt) {
            const part = sheetDamagePartList[0];
            calculatedHalvedDamage = formatDamageValue(part.valueAlt);
        }

        // Apply Manual Overrides again to be safe
        if (overrides.damageFormula && sheetDamagePartList.length > 0) {
            const parsed = parseDamageString(overrides.damageFormula);
            if (parsed && sheetDamagePartList[0].value) {
                 const part = sheetDamagePartList[0];
                 if (parsed.die === null) {
                    part.value.flatMultiplier = parsed.count;
                    part.value.dice = "";
                    part.value.bonus = null;
                    if (!part.value.custom) part.value.custom = {};
                    part.value.custom.enabled = true;
                    part.value.custom.formula = String(parsed.count);
                 } else {
                    part.value.flatMultiplier = parsed.count;
                    part.value.dice = parsed.die;
                    part.value.bonus = parsed.bonus;
                    if (part.value.custom) part.value.custom.enabled = false;
                 }
                 Object.assign(updateData, buildAttackDamageUpdate(sheetDamage));
            }
        }

        if (overrides.halvedDamageFormula && sheetDamagePartList.length > 0) {
            const parsed = parseDamageString(overrides.halvedDamageFormula);
            if (parsed && sheetDamagePartList[0].valueAlt) {
                 const part = sheetDamagePartList[0];
                 if (parsed.die === null) {
                    part.valueAlt.flatMultiplier = parsed.count;
                    part.valueAlt.dice = "";
                    part.valueAlt.bonus = null;
                    if (!part.valueAlt.custom) part.valueAlt.custom = {};
                    part.valueAlt.custom.enabled = true;
                    part.valueAlt.custom.formula = String(parsed.count);
                 } else {
                    part.valueAlt.flatMultiplier = parsed.count;
                    part.valueAlt.dice = parsed.die;
                    part.valueAlt.bonus = parsed.bonus;
                    if (part.valueAlt.custom) part.valueAlt.custom.enabled = false;
                 }
                 Object.assign(updateData, buildAttackDamageUpdate(sheetDamage));
            }
        }
    }

    // 4. Update Experiences
    if (game.settings.get(MODULE_ID, SETTING_UPDATE_EXP) && benchmark.experiences) {
        const expData = benchmark.experiences;
        const currentExperiences = actorData.system.experiences || {};
        const expOverrides = overrides.experiences || {};

        const targetMod = overrides.expMod !== undefined ? overrides.expMod : getRollFromSignedRange(expData.modifier);
        const targetAmount = overrides.expAmount !== undefined ? overrides.expAmount : getRollFromRange(expData.amount);

        const keysToKeep = [];

        for (const [key, exp] of Object.entries(currentExperiences)) {
            if (expOverrides[key] && expOverrides[key].deleted) {
                updateData[`system.experiences.-=${key}`] = null;
            } else {
                keysToKeep.push(key);
                const override = expOverrides[key];
                const finalMod = (override && override.value !== undefined) ? override.value : targetMod;
                const finalName = (override && override.name !== undefined) ? override.name : exp.name;
                updateData[`system.experiences.${key}.value`] = finalMod;
                updateData[`system.experiences.${key}.name`] = finalName;
            }
        }

        let manualAddedCount = 0;
        for (const [tempId, data] of Object.entries(expOverrides)) {
             if (!currentExperiences[tempId] && !data.deleted) {
                 const newId = foundry.utils.randomID();
                 updateData[`system.experiences.${newId}`] = {
                     name: data.name || "New Experience",
                     value: data.value !== undefined ? data.value : targetMod,
                     description: "Added by Live Manager"
                 };
                 manualAddedCount++;
             }
        }

        const currentCount = keysToKeep.length + manualAddedCount;
        if (currentCount < targetAmount) {
            const needed = targetAmount - currentCount;
            let availableNames = [];
            if (ADVERSARY_EXPERIENCES[typeKey]) {
                const usedNames = new Set([
                    ...Object.values(currentExperiences).map(e => e.name),
                    ...Object.values(expOverrides).map(e => e.name)
                ]);
                availableNames = ADVERSARY_EXPERIENCES[typeKey].filter(n => !usedNames.has(n));
            } else if (ADVERSARY_EXPERIENCES["standard"]) {
                const usedNames = new Set([
                    ...Object.values(currentExperiences).map(e => e.name),
                    ...Object.values(expOverrides).map(e => e.name)
                ]);
                availableNames = ADVERSARY_EXPERIENCES["standard"].filter(n => !usedNames.has(n));
            }

            for (let i = 0; i < needed; i++) {
                const newId = foundry.utils.randomID();
                let name = "New Experience";
                if (availableNames.length > 0) {
                    const idx = Math.floor(Math.random() * availableNames.length);
                    name = availableNames[idx];
                    availableNames.splice(idx, 1);
                }
                updateData[`system.experiences.${newId}`] = {
                    name: name,
                    value: targetMod,
                    description: "Auto-Added by Tier Scaling"
                };
                statsLog.push(`<strong>New Exp:</strong> ${name}`);
            }
        }
        if (currentCount !== keysToKeep.length || manualAddedCount > 0) {
             statsLog.push(`<strong>Experiences:</strong> Adjusted`);
        }
    }

    // 5. Update Features (Items)
    const customPack = game.packs.get("daggerheart-advmanager.custom-features");
    let cleanMinion = null;
    let cleanHorde = null;
    let minionUuid = null;
    let hordeUuid = null;

    if (customPack) {
        const index = await customPack.getIndex();
        const minionIdx = index.find(i => i.name === "Minion (X)");
        const hordeIdx = index.find(i => i.name === "Horde (X)");

        if (minionIdx) {
            const doc = await customPack.getDocument(minionIdx._id);
            cleanMinion = doc.toObject();
            minionUuid = doc.uuid;
        }
        if (hordeIdx) {
            const doc = await customPack.getDocument(hordeIdx._id);
            cleanHorde = doc.toObject();
            hordeUuid = doc.uuid;
        }
    }

    if (actorData.items) {
        for (const item of actorData.items) {
            const isMinion = item.name.trim().match(/^Minion(\s*\(.*\))?$/i);
            const isHorde = item.name.trim().match(/^Horde(\s*\(.*\))?$/i);

            if (isMinion && cleanMinion) {
                const oldId = item._id;
                foundry.utils.mergeObject(item, cleanMinion);
                item._id = oldId;
            } else if (isHorde && cleanHorde) {
                const oldId = item._id;
                foundry.utils.mergeObject(item, cleanHorde);
                item._id = oldId;
            }
        }
    }

    const featureNames = (overrides.features && overrides.features.names) ? overrides.features.names : {};
    const featureDamage = (overrides.features && overrides.features.damage) ? overrides.features.damage : {};

    if (calculatedHalvedDamage) {
        if (actorData.items) {
            for (const item of actorData.items) {
                if (item.name.trim().match(/^Horde(\s*\(.*\))?$/i)) {
                    if (!featureDamage[item._id]) {
                        if (!featureDamage[item._id]) featureDamage[item._id] = calculatedHalvedDamage;
                    }
                }
            }
        }
    }

    if (overrides.minionThreshold) {
        if (actorData.items) {
            for (const item of actorData.items) {
                if (item.name.trim().match(/^Minion(\s*\(.*\))?$/i)) {
                    if (!featureNames[item._id]) {
                        featureNames[item._id] = `Minion (${overrides.minionThreshold})`;
                    }
                }
            }
        }
    }

    const itemsToUpdate = [];
    if (actorData.items) {
        for (const item of actorData.items) {
            const result = processFeatureUpdate(
                item,
                newTier,
                currentTier,
                benchmark,
                featureLog,
                featureNames,
                featureDamage,
                { minion: cleanMinion, horde: cleanHorde, minionUuid, hordeUuid }
            );
            if (result) {
                if (result.update) itemsToUpdate.push(result.update);
                if (result.structured) structuredFeatureChanges.push(...result.structured);
            }
        }
    }

    // 6. Add the features the user ticked in the preview
    const newFeatures = await handleNewFeatures(actor, featureLog, overrides.newFeatures);

    await actor.update(updateData);
    if (itemsToUpdate.length > 0) await actor.updateEmbeddedDocuments("Item", itemsToUpdate);
    if (newFeatures.toCreate.length > 0) await actor.createEmbeddedDocuments("Item", newFeatures.toCreate);
    if (newFeatures.toDelete.length > 0) await actor.deleteEmbeddedDocuments("Item", newFeatures.toDelete);

    return {
        actor: actor,
        currentTier: currentTier,
        newTier: newTier,
        statsLog: statsLog,
        featureLog: featureLog,
        structuredFeatures: structuredFeatureChanges,
        newFeaturesList: newFeatures.toCreate
    };
}

// --- Chat Log ---

/**
 * Constructs and sends a styled whisper chat message to GM with a batch update summary.
 * @param {Array} results - Array of update result objects from updateSingleActor.
 * @param {number} targetTier - The tier all actors were updated to.
 */
export function sendBatchChatLog(results, targetTier) {
    const bgImage = SKULL_IMAGE_PATH;
    let consolidatedContent = "";
    results.forEach((res, index) => {
        let actorBlock = `<div style="font-weight: bold; font-size: 1.1em; color: #ff9c5a; margin-bottom: 4px; text-transform: uppercase;">${res.actor.name} (T${res.currentTier} &rarr; T${targetTier})</div>`;
        if (res.statsLog.length > 0) actorBlock += `<div style="font-size: 0.9em; margin-bottom: 4px; color: #ccc;">${res.statsLog.join(" | ")}</div>`;
        if (res.featureLog.length > 0) res.featureLog.forEach(log => { actorBlock += `<div style="font-size: 0.9em; margin-left: 5px;">• ${log}</div>`; });
        consolidatedContent += actorBlock + (index < results.length - 1 ? `<hr style="border: 0; border-top: 1px solid rgba(201, 160, 96, 0.5); margin: 8px 0;">` : "");
    });
    const finalHtml = `<div class="chat-card" style="border: 2px solid #C9A060; border-radius: 8px; overflow: hidden;"><header class="card-header flexrow" style="background: #191919 !important; padding: 8px; border-bottom: 2px solid #C9A060;"><h3 class="noborder" style="margin: 0; font-weight: bold; color: #C9A060 !important; font-family: 'Aleo', serif; text-align: center; text-transform: uppercase; letter-spacing: 1px; width: 100%;">Batch Update: Tier ${targetTier}</h3></header><div class="card-content" style="background-image: url('${bgImage}'); background-repeat: no-repeat; background-position: center; background-size: cover; padding: 20px; min-height: 150px; display: flex; align-items: center; justify-content: center; text-align: center; position: relative;"><div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.8); z-index: 0;"></div><span style="color: #ffffff !important; font-size: 1.0em; text-shadow: 0px 0px 8px #000000; position: relative; z-index: 1; font-family: 'Lato', sans-serif; line-height: 1.4; width: 100%; text-align: left;">${consolidatedContent}</span></div></div>`;
    ChatMessage.create({ content: finalHtml, whisper: ChatMessage.getWhisperRecipients("GM"), speaker: ChatMessage.getSpeaker({ alias: "Adversary Manager" }) });
}
