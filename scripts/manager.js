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
     */
    static processFeatureUpdate(itemData, newTier, currentTier, benchmark, changeLog = [], nameOverrides = {}, damageOverrides = {}, templates = {}) {
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

                // FIX: Add structured change for manual override too, so UI shows it with correct icon/link
                const isMinion = newName.match(/^Minion\s*\((\d+)\)$/i);
                const isHorde = newName.match(/^Horde\s*\((.+)\)$/i);
                
                let uiImg = itemData.img;
                let uiUuid = itemData.flags?.core?.sourceId || ""; // Best guess if no template
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
                            to: newName,
                            img: templates.horde?.img || itemData.img,
                            uuid: templates.hordeUuid || itemData.uuid || itemData.flags?.core?.sourceId || ""
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
                            to: newName,
                            // Ensure UUID and Img are passed for UI link (fixes missing icon/link)
                            img: templates.minion?.img || itemData.img,
                            uuid: templates.minionUuid || itemData.uuid || itemData.flags?.core?.sourceId || ""
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
        if (specificFeatureNames && Array.isArray(specificFeatureNames)) {
            // UI/MANUAL MODE: Force processing
        } else {
            if (!game.settings.get(MODULE_ID, SETTING_ADD_FEATURES)) return { toCreate: [], toDelete: [] };
            if (newTier <= currentTier) return { toCreate: [], toDelete: [] };
        }

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

        // SEARCH IN ALL PACKS
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
                    featureData = doc.toObject();
                    sourceUuid = doc.uuid;
                    break;
                }
            }

            if (!featureData) {
                // Minion Fallback
                const minionMatch = featureName.match(/^Minion\s*\((\d+)\)$/i);
                if (minionMatch) {
                    const minionVal = minionMatch[1];
                    const customPack = game.packs.get("daggerheart-advmanager.custom-features");
                    if (customPack) {
                        const index = await customPack.getIndex();
                        const templateEntry = index.find(e => e.name === "Minion (X)");
                        if (templateEntry) {
                            const doc = await customPack.getDocument(templateEntry._id);
                            featureData = doc.toObject();
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

            if (!featureData) continue;

            if (sourceUuid) {
                featureData.uuid = sourceUuid;
            }

            toCreate.push(featureData);

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
     * UPDATE SINGLE ACTOR - UPDATED EXPERIENCE LOGIC
     */
    static async updateSingleActor(actor, newTier, overrides = {}) {
        const actorData = actor.toObject();
        const currentTier = Number(actorData.system.tier) || 1;

        // FIX: Allow update if tier is same BUT overrides exist
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

        // --- 1. Update Name ---
        let newName = actorData.name;
        const tierTagRegex = /\s*\(T\d+\)$/;
        const newTag = ` (T${newTier})`;
        if (tierTagRegex.test(newName)) newName = newName.replace(tierTagRegex, newTag);
        else newName = newName + newTag;
        updateData["name"] = newName;

        // --- 2. Update Stats (With Overrides) ---
        const diff = overrides.difficulty !== undefined ? Number(overrides.difficulty) : Manager.getRollFromRange(benchmark.difficulty);
        if (diff) { updateData["system.difficulty"] = diff; statsLog.push(`<strong>Diff:</strong> ${actorData.system.difficulty} -> ${diff}`); }

        const hp = overrides.hp !== undefined ? Number(overrides.hp) : Manager.getRollFromRange(benchmark.hp);
        if (hp) { updateData["system.resources.hitPoints.max"] = hp; updateData["system.resources.hitPoints.value"] = 0; statsLog.push(`<strong>HP:</strong> ${actorData.system.resources.hitPoints.max} -> ${hp}`); }

        const stress = overrides.stress !== undefined ? Number(overrides.stress) : Manager.getRollFromRange(benchmark.stress);
        if (stress) { updateData["system.resources.stress.max"] = stress; statsLog.push(`<strong>Stress:</strong> ${actorData.system.resources.stress.max} -> ${stress}`); }

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

        const atkMod = overrides.attackMod !== undefined ? Number(overrides.attackMod) : Manager.getRollFromSignedRange(benchmark.attack_modifier);
        if (atkMod !== null && !isNaN(atkMod)) {
            updateData["system.attack.roll.bonus"] = atkMod;
            const oldAtk = actorData.system.attack.roll.bonus;
            const sign = atkMod >= 0 ? "+" : "";
            statsLog.push(`<strong>Atk Mod:</strong> ${oldAtk} -> ${sign}${atkMod}`);
        }

        // --- 3. Update Sheet Damage (Main Attack) ---
        let calculatedHalvedDamage = null;

        if (actorData.system.attack && actorData.system.attack.damage && actorData.system.attack.damage.parts) {
            const sheetDamageParts = foundry.utils.deepClone(actorData.system.attack.damage.parts);
            
            if (overrides.damageFormula && sheetDamageParts.length > 0) {
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
            
            if (overrides.halvedDamageFormula && sheetDamageParts.length > 0) {
                 calculatedHalvedDamage = overrides.halvedDamageFormula;
                 const parsed = Manager.parseDamageString(overrides.halvedDamageFormula);
                 if (parsed && sheetDamageParts[0].valueAlt) {
                     const part = sheetDamageParts[0];
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

            const result = Manager.updateDamageParts(sheetDamageParts, newTier, currentTier, benchmark);
            if (result.hasChanges) {
                updateData["system.attack.damage.parts"] = sheetDamageParts;
                result.changes.forEach(c => {
                    statsLog.push(`<strong>Sheet Dmg:</strong> ${c.from} -> ${c.to}`);
                    if (c.labelSuffix === " (Alt)" && !overrides.halvedDamageFormula) {
                         calculatedHalvedDamage = c.to;
                    }
                });
            }

            if (!calculatedHalvedDamage && sheetDamageParts.length > 0 && sheetDamageParts[0].valueAlt) {
                const part = sheetDamageParts[0];
                const altFormula = part.valueAlt.custom?.enabled ? part.valueAlt.custom.formula : (part.valueAlt.dice ? `${part.valueAlt.flatMultiplier||1}${part.valueAlt.dice}${part.valueAlt.bonus?(part.valueAlt.bonus>0?'+'+part.valueAlt.bonus:part.valueAlt.bonus):''}` : `${part.valueAlt.flatMultiplier}`);
                calculatedHalvedDamage = altFormula;
            }
            
            if (overrides.damageFormula && sheetDamageParts.length > 0) {
                const parsed = Manager.parseDamageString(overrides.damageFormula);
                if (parsed && sheetDamageParts[0].value) {
                     const part = sheetDamageParts[0];
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

        // --- 4. Update Experiences (UPDATED HYBRID LOGIC) ---
        if (game.settings.get(MODULE_ID, SETTING_UPDATE_EXP) && benchmark.experiences) {
            const expData = benchmark.experiences;
            const currentExperiences = actorData.system.experiences || {};
            const expOverrides = overrides.experiences || {};
            
            // Determine Target Mod & Amount (Prioritize Overrides)
            const targetMod = overrides.expMod !== undefined ? overrides.expMod : Manager.getRollFromSignedRange(expData.modifier);
            const targetAmount = overrides.expAmount !== undefined ? overrides.expAmount : Manager.getRollFromRange(expData.amount);

            const keysToKeep = [];
            
            // 1. Process Existing Experiences
            for (const [key, exp] of Object.entries(currentExperiences)) {
                // If marked for deletion in overrides
                if (expOverrides[key] && expOverrides[key].deleted) {
                    updateData[`system.experiences.-=${key}`] = null;
                } else {
                    keysToKeep.push(key);
                    
                    // Update Values (Override > TargetMod > Current)
                    const override = expOverrides[key];
                    const finalMod = (override && override.value !== undefined) ? override.value : targetMod;
                    const finalName = (override && override.name !== undefined) ? override.name : exp.name;
                    
                    updateData[`system.experiences.${key}.value`] = finalMod;
                    updateData[`system.experiences.${key}.name`] = finalName;
                }
            }

            // 2. Process Manual Additions from Overrides
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

            // 3. Auto-Fill to Target Amount (Hybrid Logic)
            const currentCount = keysToKeep.length + manualAddedCount;
            
            if (currentCount < targetAmount) {
                const needed = targetAmount - currentCount;
                
                // Try to get available names from benchmark
                let availableNames = [];
                if (ADVERSARY_BENCHMARKS[typeKey] && ADVERSARY_BENCHMARKS[typeKey].experiences) {
                    // Filter out already used names?
                    const usedNames = new Set([
                        ...Object.values(currentExperiences).map(e => e.name),
                        ...Object.values(expOverrides).map(e => e.name)
                    ]);
                    availableNames = ADVERSARY_BENCHMARKS[typeKey].experiences.filter(n => !usedNames.has(n));
                }

                for (let i = 0; i < needed; i++) {
                    const newId = foundry.utils.randomID();
                    
                    // Pick name
                    let name = "New Experience";
                    if (availableNames.length > 0) {
                        const idx = Math.floor(Math.random() * availableNames.length);
                        name = availableNames[idx];
                        availableNames.splice(idx, 1); // remove picked to avoid duplicates in same batch
                    }

                    updateData[`system.experiences.${newId}`] = {
                        name: name,
                        value: targetMod,
                        description: "Auto-Added by Tier Scaling"
                    };
                    statsLog.push(`<strong>New Exp:</strong> ${name}`);
                }
            }
            
            if (statsLog.find(l => l.includes("Experiences"))) {
                 // Already logged?
            } else if (currentCount !== keysToKeep.length || manualAddedCount > 0) {
                 statsLog.push(`<strong>Experiences:</strong> Adjusted to Match Tier (Target ${targetAmount})`);
            }
        }

        // --- 5. Update Features (Items) ---
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
                            featureDamage[item._id] = calculatedHalvedDamage;
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
                const result = Manager.processFeatureUpdate(
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
                    itemsToUpdate.push(result.update);
                    if (result.structured) structuredFeatureChanges.push(...result.structured);
                }
            }
        }

        // --- 6. Add Suggested Features ---
        const newFeatures = await Manager.handleNewFeatures(
            actor, 
            typeKey, 
            newTier, 
            currentTier, 
            featureLog, 
            overrides.suggestedFeatures 
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
            structuredFeatures: structuredFeatureChanges,
            newFeaturesList: newFeatures.toCreate
        };
    }

    static async submitHandler(event, form, formData) {
        // ... existing
    }
    // ... existing
}