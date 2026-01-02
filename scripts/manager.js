// ... existing imports
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
import { ADVERSARY_BENCHMARKS, PC_BENCHMARKS } from "./rules.js";
import { MODULE_ID, SETTING_CHAT_LOG, SETTING_UPDATE_EXP, SETTING_ADD_FEATURES, SKULL_IMAGE_PATH } from "./module.js";

export class Manager extends HandlebarsApplicationMixin(ApplicationV2) {
    
    constructor(options = {}) {
        super(options);
        if (options.actors) {
            this.actors = options.actors;
        } else {
            this.actors = options.actor ? [options.actor] : [];
        }
    }

    static DEFAULT_OPTIONS = {
        id: "daggerheart-adv-manager",
        tag: "form",
        window: {
            title: "Adversary Manager",
            icon: "fas fa-skull",
            resizable: false,
            width: 420
        },
        position: {
            width: 420,
            height: "auto"
        },
        form: {
            handler: Manager.submitHandler,
            closeOnSubmit: true
        }
    };

    static PARTS = {
        form: {
            template: "modules/daggerheart-advmanager/templates/manager.hbs"
        }
    };

    async _prepareContext(_options) {
        const actorList = this.actors.map(a => {
            const tier = Number(a.system.tier) || 1;
            const isLinked = a.isToken ? a.actorLink : a.prototypeToken?.actorLink;

            return {
                name: a.name,
                tier: tier,
                isLinked: isLinked,
                linkIcon: isLinked ? "fa-link" : "fa-unlink",
                linkClass: isLinked ? "status-linked" : "status-unlinked"
            };
        });

        const distinctTiers = new Set(actorList.map(a => a.tier));
        const isMixedTier = distinctTiers.size > 1;
        const currentSharedTier = isMixedTier ? null : (distinctTiers.values().next().value);

        const tiers = [1, 2, 3, 4].map(t => ({
            value: t,
            label: `Tier ${t}`,
            disabled: !isMixedTier && t === currentSharedTier,
            isCurrent: !isMixedTier && t === currentSharedTier
        }));

        return {
            actorList: actorList,
            hasMultiple: this.actors.length > 1,
            tiers: tiers
        };
    }

    // --- Utility Parsers ---

    static getRollFromRange(rangeString) {
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

    static getRollFromSignedRange(rangeString) {
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

    static parseThresholdPair(str) {
        if (!str) return null;
        const parts = str.toString().split("/").map(p => parseInt(p.trim()));
        if (parts.length >= 2) {
            return { major: parts[0], severe: parts[1] };
        }
        return null;
    }

    static parseDamageString(dmgString) {
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

    static resolveFeatureName(name, tier) {
        if (name.includes("Relentless (X)")) {
            return `Relentless (${tier})`;
        }
        return name;
    }

    static getAvailableFeaturesForTier(typeKey, tier) {
        const benchmarkRoot = ADVERSARY_BENCHMARKS[typeKey];
        if (!benchmarkRoot) return [];
        const tierBenchmark = benchmarkRoot.tiers[`tier_${tier}`];
        if (!tierBenchmark || !tierBenchmark.suggested_features || !Array.isArray(tierBenchmark.suggested_features)) {
            return [];
        }
        return tierBenchmark.suggested_features.map(name => Manager.resolveFeatureName(name, tier));
    }

    /**
     * Calculates the hit probability of an adversary against a PC (1d20 vs Evasion).
     * @param {Number} attackBonus 
     * @param {Number} tier 
     * @returns {Object|null}
     */
    static calculateHitChance(attackBonus, tier) {
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
     * @param {Number} difficulty 
     * @param {Number} tier 
     * @returns {Object|null}
     */
    static calculateHitChanceAgainst(difficulty, tier) {
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
                    // Success if doubles (Hope/Fear) OR meets difficulty
                    if (d1 === d2 || (d1 + d2 + bonus >= difficulty)) {
                        hits++;
                    }
                }
            }
            
            // Use Math.round to get integer percentage (e.g. 58 instead of 58.33)
            return Math.round((hits / totalOutcomes) * 100);
        };

        const minChance = calculate(minBonus);
        const maxChance = calculate(maxBonus);

        return {
            text: `(Min: ${minChance}% | Max: ${maxChance}%)`,
            // Cleaned up tooltip
            tooltip: `PC Hit Chance (2d12 + Trait vs Diff ${difficulty}):\nStandard Trait (+${minBonus}): ${minChance}%\nMax Trait (+${maxBonus}): ${maxChance}%`
        };
    }

    // --- Core Logic ---

    static calculateNewDamage(currentDie, currentBonus, newTier, currentTier, damageRolls) {
        let result = { count: 1, die: "d12", bonus: 0 };

        if (currentDie === null) {
            const tierDiff = newTier - currentTier;
            result = { count: 0, die: null, bonus: currentBonus + (tierDiff * 2) };
        } else {
            const options = (damageRolls || []).map(str => Manager.parseDamageString(str)).filter(o => o !== null && o.die !== null);
            
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

    static processDamageValue(val, newTier, currentTier, damageRolls) {
        if (!val) return null;

        let currentDie = val.dice || "d12";
        let currentBonus = val.bonus || 0;
        let currentCount = val.flatMultiplier || 1; 
        
        let isCustom = false;
        let isFlatFixed = false;
        let oldFormula = "";

        if (val.custom?.enabled === true && val.custom.formula) {
            const parsed = Manager.parseDamageString(val.custom.formula);
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

        if (!isCustom && !val.dice) {
                isFlatFixed = true;
                currentDie = null;
                currentBonus = val.flatMultiplier || 0;
                oldFormula = `${currentBonus}`;
        } else if (!isCustom) {
            const sign = (currentBonus && currentBonus >= 0) ? "+" : "";
            const bonusStr = currentBonus ? `${sign}${currentBonus}` : "";
            oldFormula = `${currentCount}${currentDie}${bonusStr}`;
        }

        const bonusInput = isFlatFixed ? (isCustom ? currentCount : currentBonus) : currentBonus;
        
        const newDmg = Manager.calculateNewDamage(currentDie, bonusInput, newTier, currentTier, damageRolls);

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
                val.flatMultiplier = newDmg.bonus;
                val.dice = "";
                val.bonus = null;
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

    static updateDamageParts(parts, newTier, currentTier, benchmark, forceFormula = null) {
        let hasChanges = false;
        const changes = [];

        if (!parts || !Array.isArray(parts)) return { hasChanges, changes };

        // If a manual override formula is provided, apply it to the first valid part
        if (forceFormula) {
            const parsed = Manager.parseDamageString(forceFormula);
            if (parsed) {
                const part = parts.find(p => p.value);
                if (part) {
                    let oldFormula = part.value.custom?.enabled ? part.value.custom.formula : (part.value.dice ? `${part.value.flatMultiplier}${part.value.dice}` : `${part.value.flatMultiplier}`);
                    
                    if (parsed.die === null) {
                        // Flat damage (Minion style or fixed)
                        if (!part.value.custom) part.value.custom = {};
                        part.value.custom.enabled = true;
                        part.value.custom.formula = `${parsed.count}`;
                        part.value.flatMultiplier = parsed.count;
                        part.value.dice = ""; // Clear dice
                        part.value.bonus = null;
                    } else {
                        // Dice damage
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

        // Standard logic
        parts.forEach(part => {
            // MINION CHECK: If benchmark has 'basic_attack_y', use it instead of scaling
            if (benchmark.basic_attack_y && part.value) {
                const currentFormula = part.value.custom?.enabled ? part.value.custom.formula : `${part.value.flatMultiplier}`;
                const newVal = Manager.getRollFromRange(benchmark.basic_attack_y);
                
                if (newVal !== null) {
                    // Minions use custom formula for flat damage
                    if (!part.value.custom) part.value.custom = {};
                    
                    part.value.custom.enabled = true;
                    part.value.custom.formula = String(newVal);
                    part.value.flatMultiplier = newVal;
                    // Usually we don't clear dice for minions if they have a visual dice set, but for damage calc, formula is king.
                    
                    // Only record change if value actually changed
                    if (currentFormula !== String(newVal)) {
                        hasChanges = true;
                        changes.push({ from: currentFormula, to: String(newVal), isCustom: true, labelSuffix: "" });
                    }
                    return; // Skip standard processing for this part
                }
            }

            // Normal Adversary Logic
            if (part.value) {
                const update = Manager.processDamageValue(part.value, newTier, currentTier, benchmark.damage_rolls);
                if (update) {
                    hasChanges = true;
                    changes.push({ ...update, labelSuffix: "" });
                }
            }
            if (part.valueAlt && benchmark.halved_damage_x) {
                const updateAlt = Manager.processDamageValue(part.valueAlt, newTier, currentTier, benchmark.halved_damage_x);
                if (updateAlt) {
                    hasChanges = true;
                    changes.push({ ...updateAlt, labelSuffix: " (Alt)" });
                }
            }
        });

        return { hasChanges, changes };
    }

    /**
     * Process Features (Items).
     * @param {Object} itemData 
     * @param {Number} newTier 
     * @param {Number} currentTier 
     * @param {Object} benchmark 
     * @param {Array} changeLog (Optional) - legacy array of strings
     * @param {Object} nameOverrides (Optional) - map of itemId -> newName
     * @param {Object} damageOverrides (Optional) - map of itemId -> newDamageFormula
     * @returns {Object|null} Update object or null
     */
    static processFeatureUpdate(itemData, newTier, currentTier, benchmark, changeLog = [], nameOverrides = {}, damageOverrides = {}) {
        let hasChanges = false;
        const system = foundry.utils.deepClone(itemData.system);
        const replacements = [];
        const structuredChanges = []; // Stores details for UI inputs
        
        let actionsRaw = system.actions;
        let manualDamage = damageOverrides[itemData._id] || null;
        
        // 1. Process Actions & Damage
        if (actionsRaw) {
            for (const actionId in actionsRaw) {
                const action = actionsRaw[actionId];
                if (action.damage && action.damage.parts) {
                    const result = Manager.updateDamageParts(action.damage.parts, newTier, currentTier, benchmark, manualDamage);
                    if (result.hasChanges) {
                        hasChanges = true;
                        result.changes.forEach(c => {
                            const customLabel = c.isCustom ? " (Custom)" : "";
                            const altLabel = c.labelSuffix || "";
                            const logMsg = `<strong>${itemData.name}:</strong> ${c.from} -> ${c.to}${customLabel}${altLabel}`;
                            changeLog.push(logMsg);
                            replacements.push(c);
                            
                            // Track for UI
                            structuredChanges.push({
                                itemId: itemData._id,
                                itemName: itemData.name,
                                type: "damage",
                                from: c.from,
                                to: c.to
                            });
                        });
                    }
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
            }
            // For minions/horde, we assume the user typed the Full string "Minion (5)"
            const mMatch = newName.match(/^Minion\s*\((\d+)\)$/i);
            if (mMatch) {
                minionVal = parseInt(mMatch[1]);
                // Removed updateDesc = true here because we handle it below via [X] replacement
            }
        } else {
            // Automatic Calculation
            
            // Horde Logic
            // Regex to match "Horde (X)" or "Horde"
            const hordeMatch = itemData.name.trim().match(/^Horde(\s*\((.+)\))?$/i);
            if (hordeMatch) {
                // If manualDamage is provided (passed from halved damage calc), use it strictly
                let newDmgStr = null;

                if (manualDamage) {
                    newDmgStr = manualDamage;
                } else {
                    const oldDmgInName = hordeMatch[2];
                    if (oldDmgInName && oldDmgInName !== "X") {
                        // Standard fallback calc
                        const parsed = Manager.parseDamageString(oldDmgInName);
                        if (parsed) {
                            // ... calc logic ...
                            let bonusInput = parsed.bonus;
                            if (parsed.die === null) bonusInput = parsed.count; 

                            const newDmg = Manager.calculateNewDamage(
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
                         // Fallback for "Horde (X)" to Benchmark HALVED Damage
                         // NOTE: Previously this might have defaulted to MAIN damage. Fixed to use halved.
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
                            to: newName
                        });
                    }
                    
                    // CRITICAL: Force Replace [X] in description with new damage string
                    // Updated to handle both [X] placeholder and direct replacement of old value
                    if (system.description) {
                         // 1. Try Standard Placeholder [X] or X
                         if (system.description.includes("[X]")) {
                             system.description = system.description.replace(/\[X\]/g, newDmgStr);
                             hasChanges = true;
                         } else if (system.description.includes("(X)")) {
                             system.description = system.description.replace(/\(X\)/g, `(${newDmgStr})`);
                             hasChanges = true;
                         }
                         // 2. Fallback: If [X] is missing (maybe reset failed), try replacing the old value from the name
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
            // Regex to match "Minion (X)" or "Minion"
            const minionMatch = itemData.name.trim().match(/^Minion(\s*\((\d+)\))?$/i);
            if (minionMatch && benchmark.minion_feature_x) {
                const newVal = Manager.getRollFromRange(benchmark.minion_feature_x);
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
                            to: newName
                        });
                    }
                }
            }
        }

        // Apply Name Change
        if (hasChanges && itemData.name !== newName) {
            itemData.name = newName; 
        }

        // Apply Description Updates (Minion - Updated to use [X] replacement like Horde)
        if (minionVal !== null) {
            if (system.description) {
                // 1. Try Standard Placeholder [X] or X
                if (system.description.includes("[X]")) {
                    system.description = system.description.replace(/\[X\]/g, minionVal);
                    hasChanges = true;
                } else if (system.description.includes("(X)")) {
                    system.description = system.description.replace(/\(X\)/g, `(${minionVal})`);
                    hasChanges = true;
                }
            }
        }

        // 4. Apply Text Replacements (for descriptions using old numbers, excluding new Horde/Minion logic)
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

            // Only run legacy replacement if not already handled by [X] logic
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
        return null;
    }

    // --- Add Suggested Features Logic ---
    static async handleNewFeatures(actor, typeKey, newTier, currentTier, changeLog, specificFeatureNames = null) {
        if (!game.settings.get(MODULE_ID, SETTING_ADD_FEATURES)) return { toCreate: [], toDelete: [] };
        if (newTier <= currentTier) return { toCreate: [], toDelete: [] };

        const currentItems = actor.items.contents || actor.items;
        let featuresToAdd = [];

        if (specificFeatureNames && Array.isArray(specificFeatureNames)) {
            // --- UI/MANUAL MODE: User selected specific features ---
            // Filter out any features the actor already has
            featuresToAdd = specificFeatureNames.filter(name => !currentItems.some(i => i.name === name));
        } else {
            // --- AUTOMATIC/BATCH MODE: Pick random ---
            const benchmarkRoot = ADVERSARY_BENCHMARKS[typeKey];
            if (!benchmarkRoot) return { toCreate: [], toDelete: [] };

            const possibleFeatures = Manager.getAvailableFeaturesForTier(typeKey, newTier);
            if (possibleFeatures.length === 0) return { toCreate: [], toDelete: [] };

            const candidates = possibleFeatures.filter(name => !currentItems.some(i => i.name === name));
            if (candidates.length === 0) return { toCreate: [], toDelete: [] };

            const pickedName = candidates[Math.floor(Math.random() * candidates.length)];
            featuresToAdd.push(pickedName);
        }

        if (featuresToAdd.length === 0) return { toCreate: [], toDelete: [] };

        // Fetch Items
        const pack = game.packs.get("daggerheart-advmanager.features");
        if (!pack) return { toCreate: [], toDelete: [] }; 

        const index = await pack.getIndex();
        const toCreate = [];
        const toDelete = [];

        for (const featureName of featuresToAdd) {
            const entry = index.find(e => e.name === featureName);
            if (!entry) continue;

            const featureData = (await pack.getDocument(entry._id)).toObject();
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

    /**
     * UPDATE SINGLE ACTOR - NOW ACCEPTS MANUAL OVERRIDES
     * overrides: { difficulty, hp, stress, major, severe, attackMod, damageFormula, halvedDamageFormula, experiences: {}, suggestedFeatures: [], features: { names: {}, damage: {} }, minionThreshold: number }
     */
    static async updateSingleActor(actor, newTier, overrides = {}) {
        const actorData = actor.toObject();
        const currentTier = Number(actorData.system.tier) || 1;

        if (newTier === currentTier) return null;

        const updateData = { "system.tier": newTier };
        const typeKey = (actorData.system.type || "standard").toLowerCase();
        const statsLog = [];
        const featureLog = [];
        const structuredFeatureChanges = []; // For UI reporting

        if (!ADVERSARY_BENCHMARKS[typeKey]) return null;
        const benchmark = ADVERSARY_BENCHMARKS[typeKey].tiers[`tier_${newTier}`];
        if (!benchmark) return null;

        // --- 1. Update Name ---
        let newName = actorData.name;
        const tierTagRegex = /\s*\(T\d+\)$/;
        const newTag = ` (T${newTier})`;
        if (tierTagRegex.test(newName)) newName = newName.replace(tierTagRegex, newTag);
        else newName = newName + newTag;
        updateData["name"] = newName;

        // --- 2. Update Stats (With Overrides) ---
        
        // Difficulty
        const diff = overrides.difficulty !== undefined ? Number(overrides.difficulty) : Manager.getRollFromRange(benchmark.difficulty);
        if (diff) { updateData["system.difficulty"] = diff; statsLog.push(`<strong>Diff:</strong> ${actorData.system.difficulty} -> ${diff}`); }

        // HP
        const hp = overrides.hp !== undefined ? Number(overrides.hp) : Manager.getRollFromRange(benchmark.hp);
        if (hp) { updateData["system.resources.hitPoints.max"] = hp; updateData["system.resources.hitPoints.value"] = 0; statsLog.push(`<strong>HP:</strong> ${actorData.system.resources.hitPoints.max} -> ${hp}`); }

        // Stress
        const stress = overrides.stress !== undefined ? Number(overrides.stress) : Manager.getRollFromRange(benchmark.stress);
        if (stress) { updateData["system.resources.stress.max"] = stress; statsLog.push(`<strong>Stress:</strong> ${actorData.system.resources.stress.max} -> ${stress}`); }

        // Thresholds
        if (benchmark.threshold_min && benchmark.threshold_max) {
            let major, severe;
            if (overrides.major && overrides.severe) {
                major = Number(overrides.major); severe = Number(overrides.severe);
            } else {
                const minPair = Manager.parseThresholdPair(benchmark.threshold_min);
                const maxPair = Manager.parseThresholdPair(benchmark.threshold_max);
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

        // Attack Mod
        const atkMod = overrides.attackMod !== undefined ? Number(overrides.attackMod) : Manager.getRollFromSignedRange(benchmark.attack_modifier);
        if (atkMod !== null && !isNaN(atkMod)) {
            updateData["system.attack.roll.bonus"] = atkMod;
            const oldAtk = actorData.system.attack.roll.bonus;
            const sign = atkMod >= 0 ? "+" : "";
            statsLog.push(`<strong>Atk Mod:</strong> ${oldAtk} -> ${sign}${atkMod}`);
        }

        // --- 3. Update Sheet Damage (Main Attack) ---
        // NEW: Capture HALVED DAMAGE for Horde feature update later
        let calculatedHalvedDamage = null;

        if (actorData.system.attack && actorData.system.attack.damage && actorData.system.attack.damage.parts) {
            const sheetDamageParts = foundry.utils.deepClone(actorData.system.attack.damage.parts);
            
            // Check for full damage string override
            if (overrides.damageFormula && sheetDamageParts.length > 0) {
                // Parse override string
                const parsed = Manager.parseDamageString(overrides.damageFormula);
                if (parsed) {
                    const part = sheetDamageParts[0];
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
                        updateData["system.attack.damage.parts"] = sheetDamageParts;
                        statsLog.push(`<strong>Sheet Dmg (Manual):</strong> ${overrides.damageFormula}`);
                    }
                }
            }
            
            // NEW: Check for halved damage override (Horde)
            if (overrides.halvedDamageFormula && sheetDamageParts.length > 0) {
                 calculatedHalvedDamage = overrides.halvedDamageFormula; // Capture for Horde feature
                 const parsed = Manager.parseDamageString(overrides.halvedDamageFormula);
                 if (parsed && sheetDamageParts[0].valueAlt) {
                     const part = sheetDamageParts[0]; // Assume first part usually carries the alt value
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

            // Simplified approach: Run standard updater FIRST, then apply overrides ON TOP.
            // Note: If no manual override, this will calculate the halved damage from rules
            const result = Manager.updateDamageParts(sheetDamageParts, newTier, currentTier, benchmark);
            if (result.hasChanges) {
                // Apply standard changes first
                updateData["system.attack.damage.parts"] = sheetDamageParts;
                result.changes.forEach(c => {
                    statsLog.push(`<strong>Sheet Dmg:</strong> ${c.from} -> ${c.to}`);
                    // Capture calculated halved damage if present in changes
                    // FIX: Only update calculatedHalvedDamage if NO override exists
                    if (c.labelSuffix === " (Alt)" && !overrides.halvedDamageFormula) {
                         calculatedHalvedDamage = c.to;
                    }
                });
            }

            // ROBUSTNESS: If calculatedHalvedDamage wasn't set by change log (no change needed) or override, 
            // extract it from the updated sheet parts directly so we can pass it to the Feature logic.
            if (!calculatedHalvedDamage && sheetDamageParts.length > 0 && sheetDamageParts[0].valueAlt) {
                const part = sheetDamageParts[0];
                // Construct the string from the current state (which might have been updated in place by updateDamageParts)
                const altFormula = part.valueAlt.custom?.enabled ? part.valueAlt.custom.formula : (part.valueAlt.dice ? `${part.valueAlt.flatMultiplier||1}${part.valueAlt.dice}${part.valueAlt.bonus?(part.valueAlt.bonus>0?'+'+part.valueAlt.bonus:part.valueAlt.bonus):''}` : `${part.valueAlt.flatMultiplier}`);
                calculatedHalvedDamage = altFormula;
            }
            
            // NOW Apply Overrides (Overrides win)
            if (overrides.damageFormula && sheetDamageParts.length > 0) {
                const parsed = Manager.parseDamageString(overrides.damageFormula);
                if (parsed && sheetDamageParts[0].value) {
                     const part = sheetDamageParts[0];
                     // Reset custom if switching to dice, set custom if switching to flat? 
                     // Daggerheart logic is flexible. Let's just set the primitive values.
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
                     updateData["system.attack.damage.parts"] = sheetDamageParts;
                     statsLog.push(`<strong>Sheet Dmg (Manual):</strong> ${overrides.damageFormula}`);
                }
            }

            if (overrides.halvedDamageFormula && sheetDamageParts.length > 0) {
                const parsed = Manager.parseDamageString(overrides.halvedDamageFormula);
                if (parsed && sheetDamageParts[0].valueAlt) {
                     const part = sheetDamageParts[0];
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
                     updateData["system.attack.damage.parts"] = sheetDamageParts;
                     statsLog.push(`<strong>Halved Dmg (Manual):</strong> ${overrides.halvedDamageFormula}`);
                }
            }
        }

        // --- 4. Update Experiences (NEW LOGIC V2: Detailed Overrides + Reduction Logic) ---
        if (game.settings.get(MODULE_ID, SETTING_UPDATE_EXP) && benchmark.experiences) {
            const expData = benchmark.experiences;
            const currentExperiences = actorData.system.experiences || {};
            const expOverrides = overrides.experiences || {};
            
            // Determine Target Mod (used for new or existing without override)
            const targetMod = Manager.getRollFromSignedRange(expData.modifier);
            
            // --- AUTOMATIC LOGIC (if no granular overrides provided) ---
            // BUT here we assume if we are in LiveManager, overrides.experiences might exist.
            // Even in Batch mode, we need basic logic.
            
            // 1. Identify which keys are deleted
            const keysToDelete = [];
            const keysToKeep = [];
            
            // Map existing experiences
            for (const [key, exp] of Object.entries(currentExperiences)) {
                // Check granular override for deletion
                if (expOverrides[key] && expOverrides[key].deleted) {
                    keysToDelete.push(key);
                } else {
                    keysToKeep.push(key);
                }
            }

            // Logic: If scaling down (newTier < currentTier), DO NOT remove experiences automatically.
            // If scaling up or same, match amount logic (unless manually managed via UI).
            // In LiveManager, the user sees the list. If they didn't click delete, we keep it.
            
            // If running via Manager (Batch), expOverrides is likely empty.
            // We implement the reduction logic here:
            if (Object.keys(expOverrides).length === 0) {
                 // Batch Mode / No Manual Overrides
                 const targetAmount = Manager.getRollFromRange(expData.amount);
                 const currentKeys = Object.keys(currentExperiences);
                 
                 // If reducing tier, keep ALL current (don't reduce amount)
                 if (newTier < currentTier) {
                     // Keep all, just update mod
                     currentKeys.forEach(key => keysToKeep.push(key));
                 } else {
                     // Standard logic: Keep up to targetAmount
                     // (Note: keysToKeep was populated above, let's reset for batch logic clarity)
                     const kept = currentKeys.slice(0, targetAmount);
                     const removed = currentKeys.slice(targetAmount);
                     
                     kept.forEach(k => {
                         updateData[`system.experiences.${k}.value`] = targetMod;
                     });
                     removed.forEach(k => {
                         updateData[`system.experiences.-=${k}`] = null;
                     });

                     // Add new if needed
                     if (targetAmount > currentKeys.length) {
                         const needed = targetAmount - currentKeys.length;
                         for (let i = 0; i < needed; i++) {
                             const newId = foundry.utils.randomID();
                             updateData[`system.experiences.${newId}`] = {
                                 name: "New Experience",
                                 value: targetMod,
                                 description: "Added by Adversary Manager"
                             };
                         }
                     }
                     statsLog.push(`<strong>Experiences:</strong> Adjusted to Qty ${targetAmount}, Mod ${targetMod >=0 ? '+'+targetMod : targetMod}`);
                 }
                 
                 if (newTier < currentTier) {
                      // Just update mods of kept
                      currentKeys.forEach(k => {
                          updateData[`system.experiences.${k}.value`] = targetMod;
                      });
                      statsLog.push(`<strong>Experiences:</strong> Tier Reduced (Kept All), Mod ${targetMod >=0 ? '+'+targetMod : targetMod}`);
                 }

            } else {
                // --- MANUAL OVERRIDES (Live Manager) ---
                // Process Updates/Deletes on Existing
                keysToKeep.forEach(key => {
                    const override = expOverrides[key];
                    const currentVal = Number(currentExperiences[key].value) || 0;
                    
                    let finalMod = targetMod;
                    let finalName = currentExperiences[key].name;

                    if (override) {
                        if (override.value !== undefined) finalMod = override.value;
                        if (override.name !== undefined) finalName = override.name;
                    } else {
                        // No specific override, applying scaling? 
                        // If user didn't touch it in UI, it comes in as just standard. 
                        // But wait, the UI sends the whole list. 
                        // If it's in expOverrides, we use that.
                        // If it's NOT in expOverrides but exists (shouldn't happen with full list sync), use targetMod.
                    }

                    // Apply update
                    updateData[`system.experiences.${key}.value`] = finalMod;
                    updateData[`system.experiences.${key}.name`] = finalName;
                });

                // Process Deletions
                keysToDelete.forEach(key => {
                    updateData[`system.experiences.-=${key}`] = null;
                });

                // Process Additions (New items with temp IDs in overrides)
                for (const [tempId, data] of Object.entries(expOverrides)) {
                     // Check if it's a new item (not in currentExperiences)
                     if (!currentExperiences[tempId] && !data.deleted) {
                         const newId = foundry.utils.randomID();
                         updateData[`system.experiences.${newId}`] = {
                             name: data.name || "New Experience",
                             value: data.value !== undefined ? data.value : targetMod,
                             description: "Added by Live Manager"
                         };
                     }
                }
                statsLog.push(`<strong>Experiences:</strong> Manual Updates Applied`);
            }
        }

        // --- 5. Update Features (Items) ---
        
        // NEW: PRE-FETCH AND RESET MINION/HORDE FEATURES
        // Fetch "daggerheart-advmanager.custom-features"
        const customPack = game.packs.get("daggerheart-advmanager.custom-features");
        let cleanMinion = null;
        let cleanHorde = null;

        if (customPack) {
            const index = await customPack.getIndex();
            // Look specifically for "Minion (X)" and "Horde (X)"
            const minionIdx = index.find(i => i.name === "Minion (X)");
            const hordeIdx = index.find(i => i.name === "Horde (X)");
            
            if (minionIdx) cleanMinion = (await customPack.getDocument(minionIdx._id)).toObject();
            if (hordeIdx) cleanHorde = (await customPack.getDocument(hordeIdx._id)).toObject();
        }

        if (actorData.items) {
            for (const item of actorData.items) {
                // Check if it's a Minion or Horde feature to reset
                // Regex matches "Minion" or "Minion (X)"
                const isMinion = item.name.trim().match(/^Minion(\s*\(.*\))?$/i);
                const isHorde = item.name.trim().match(/^Horde(\s*\(.*\))?$/i);

                if (isMinion && cleanMinion) {
                    const oldId = item._id;
                    foundry.utils.mergeObject(item, cleanMinion);
                    item._id = oldId; // Keep ID
                    // Resetting ensures we have clean description/data. 
                    // processFeatureUpdate will see the new name "Minion" and update it to "Minion (NewVal)"
                } else if (isHorde && cleanHorde) {
                    const oldId = item._id;
                    foundry.utils.mergeObject(item, cleanHorde);
                    item._id = oldId;
                }
            }
        }

        // Ensure overrides structure exists for features
        const featureNames = (overrides.features && overrides.features.names) ? overrides.features.names : {};
        // Make sure damageOverrides (which will be passed) is defined and initialized with overrides.features.damage
        const featureDamage = (overrides.features && overrides.features.damage) ? overrides.features.damage : {};

        // CRITICAL FIX: IF we have a calculated halved damage for Horde, ensure it's passed to features
        // Find any Horde item and inject the manual damage if not already overriden
        if (calculatedHalvedDamage) {
            if (actorData.items) {
                for (const item of actorData.items) {
                    if (item.name.trim().match(/^Horde(\s*\(.*\))?$/i)) {
                        // If no specific override for this item ID, use the calculated halved damage
                        if (!featureDamage[item._id]) {
                            featureDamage[item._id] = calculatedHalvedDamage;
                        }
                    }
                }
            }
        }

        // MINION OVERRIDE: Check if we have a manual Minion Threshold from LiveManager
        if (overrides.minionThreshold) {
            if (actorData.items) {
                for (const item of actorData.items) {
                    if (item.name.trim().match(/^Minion(\s*\(.*\))?$/i)) {
                        // Pass the threshold as a name override: "Minion (5)"
                        // This allows processFeatureUpdate to parse the "5"
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
                // Pass overrides separated
                const result = Manager.processFeatureUpdate(item, newTier, currentTier, benchmark, featureLog, featureNames, featureDamage);
                if (result) {
                    itemsToUpdate.push(result.update);
                    if (result.structured) structuredFeatureChanges.push(...result.structured);
                }
            }
        }

        // --- 6. Add Suggested Features (Updated to accept manual list) ---
        const newFeatures = await Manager.handleNewFeatures(
            actor, 
            typeKey, 
            newTier, 
            currentTier, 
            featureLog, 
            overrides.suggestedFeatures // Pass selected features
        );
        
        // --- Execute Update ---
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
            structuredFeatures: structuredFeatureChanges, // Return for UI
            newFeaturesList: newFeatures.toCreate // Return raw new features for UI preview (though mostly useful for visual feedback of what WOULD be created)
        };
    }

    static async submitHandler(event, form, formData) {
        // Batch logic
        const app = this;
        const newTier = Number(formData.object.selectedTier);
        if (!newTier) return;
        const batchResults = [];
        let updatedCount = 0;
        for (const actor of app.actors) {
            try {
                const result = await Manager.updateSingleActor(actor, newTier);
                if (result) { updatedCount++; batchResults.push(result); }
            } catch (err) { console.error(err); }
        }
        if (updatedCount > 0) {
            if (game.settings.get(MODULE_ID, SETTING_CHAT_LOG) && batchResults.length > 0) {
                Manager.sendBatchChatLog(batchResults, newTier);
            }
            app.close(); 
        } else { ui.notifications.info("No Adversaries updated."); }
    }

    static sendBatchChatLog(results, targetTier) {
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
}