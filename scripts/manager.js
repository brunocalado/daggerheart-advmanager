const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
import { ADVERSARY_BENCHMARKS } from "./rules.js";
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
                updateDesc = true;
            }
        } else {
            // Automatic Calculation
            
            // Horde Logic
            const hordeMatch = itemData.name.trim().match(/^Horde\s*\((.+)\)$/i);
            if (hordeMatch) {
                const oldDmgInName = hordeMatch[1];
                let newDmgStr = null;

                // Priority: Manual Damage Override > Calculated Replacement > Standard Calc
                if (manualDamage) {
                    newDmgStr = manualDamage;
                } else {
                    const matchingRep = replacements.find(r => r.from === oldDmgInName && !r.labelSuffix); 
                    if (matchingRep) {
                        newDmgStr = matchingRep.to;
                    } else {
                        // Fallback calc if action didn't trigger it
                        const parsed = Manager.parseDamageString(oldDmgInName);
                        if (parsed) {
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
                             replacements.push({ from: oldDmgInName, to: newDmgStr });
                        }
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
                }
            }

            // Minion Logic (Renaming Feature)
            const minionMatch = itemData.name.trim().match(/^Minion\s*\((\d+)\)$/i);
            if (minionMatch && benchmark.minion_feature_x) {
                const newVal = Manager.getRollFromRange(benchmark.minion_feature_x);
                if (newVal !== null) {
                    newName = `Minion (${newVal})`;
                    minionVal = newVal;
                    if (itemData.name !== newName) {
                        changeLog.push(`<strong>Name Update:</strong> ${itemData.name} -> ${newName}`);
                        hasChanges = true;
                        updateDesc = true;
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

        // Apply Description Updates (Minion)
        if (updateDesc && minionVal !== null) {
            const newDesc = `<p>This adversary is defeated when they take any damage. For every <strong>${minionVal}</strong> damage a PC deals to this adversary, defeat an additional Minion within range the attack would succeed against.</p>`;
            if (system.description !== newDesc) {
                system.description = newDesc;
                hasChanges = true;
            }
        }

        // 4. Apply Text Replacements (for descriptions using old numbers)
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

            if (system.description) system.description = performReplacement(system.description);
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
    static async handleNewFeatures(actor, typeKey, newTier, currentTier, changeLog) {
        if (!game.settings.get(MODULE_ID, SETTING_ADD_FEATURES)) return { toCreate: [], toDelete: [] };
        if (newTier <= currentTier) return { toCreate: [], toDelete: [] };

        const benchmarkRoot = ADVERSARY_BENCHMARKS[typeKey];
        if (!benchmarkRoot) return { toCreate: [], toDelete: [] };

        const tierBenchmark = benchmarkRoot.tiers[`tier_${newTier}`];
        
        if (!tierBenchmark || !tierBenchmark.suggested_features || !Array.isArray(tierBenchmark.suggested_features) || tierBenchmark.suggested_features.length === 0) {
            return { toCreate: [], toDelete: [] };
        }

        const resolvedSuggestions = tierBenchmark.suggested_features.map(name => {
            if (name.includes("Relentless (X)")) {
                return `Relentless (${newTier})`;
            }
            return name;
        });

        const currentItems = actor.items.contents || actor.items;
        const candidates = resolvedSuggestions.filter(name => !currentItems.some(i => i.name === name));
        
        if (candidates.length === 0) return { toCreate: [], toDelete: [] };

        const pickedName = candidates[Math.floor(Math.random() * candidates.length)];
        
        const pack = game.packs.get("daggerheart-advmanager.features");
        if (!pack) return { toCreate: [], toDelete: [] }; // No pack, no feature

        const index = await pack.getIndex();
        const entry = index.find(e => e.name === pickedName);
        if (!entry) return { toCreate: [], toDelete: [] };

        const featureData = (await pack.getDocument(entry._id)).toObject();
        const toCreate = [featureData];
        const toDelete = [];

        const relentlessMatch = pickedName.match(/^Relentless\s*\((\d+)\)$/i);
        if (relentlessMatch) {
            const existingRelentless = currentItems.find(i => i.name.match(/^Relentless\s*\((\d+)\)$/i));
            if (existingRelentless) {
                toDelete.push(existingRelentless.id);
                changeLog.push(`<strong>New Feature:</strong> ${pickedName} (Replaced ${existingRelentless.name})`);
            } else {
                changeLog.push(`<strong>New Feature:</strong> ${pickedName}`);
            }
        } else {
            changeLog.push(`<strong>New Feature:</strong> ${pickedName}`);
        }

        return { toCreate, toDelete };
    }

    /**
     * UPDATE SINGLE ACTOR - NOW ACCEPTS MANUAL OVERRIDES
     * overrides: { difficulty, hp, stress, major, severe, attackMod, damageFormula, features: { names: {}, damage: {} } }
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
                        statsLog.push(`<strong>Sheet Dmg:</strong> (Manual) -> ${overrides.damageFormula}`);
                    }
                }
            } else {
                // Standard Logic
                const result = Manager.updateDamageParts(sheetDamageParts, newTier, currentTier, benchmark);
                if (result.hasChanges) {
                    updateData["system.attack.damage.parts"] = sheetDamageParts;
                    result.changes.forEach(c => {
                        statsLog.push(`<strong>Sheet Dmg:</strong> ${c.from} -> ${c.to}`);
                    });
                }
            }
        }

        // --- 4. Update Experiences (Standard) ---
        if (game.settings.get(MODULE_ID, SETTING_UPDATE_EXP)) {
            if (actorData.system.experiences) {
                const tierDiff = newTier - currentTier;
                for (const [key, exp] of Object.entries(actorData.system.experiences)) {
                    const currentVal = Number(exp.value) || 0;
                    let newVal = currentVal + tierDiff;
                    if (newVal < 2) newVal = 2;
                    if (newVal > 5) newVal = 5;
                    if (newVal !== currentVal) updateData[`system.experiences.${key}.value`] = newVal;
                }
            }
            if (currentTier <= 2 && newTier >= 3) {
                const newExpValue = newTier === 3 ? 3 : 4;
                const newExpId = foundry.utils.randomID();
                updateData[`system.experiences.${newExpId}`] = { name: "New Experience", value: newExpValue, description: "Added by Adversary Manager" };
            }
        }

        // --- 5. Update Features (Items) ---
        // Ensure overrides structure exists for features
        const featureNames = (overrides.features && overrides.features.names) ? overrides.features.names : {};
        const featureDamage = (overrides.features && overrides.features.damage) ? overrides.features.damage : {};

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

        // --- 6. Add Suggested Features ---
        const newFeatures = await Manager.handleNewFeatures(actor, typeKey, newTier, currentTier, featureLog);
        
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
            newFeaturesList: newFeatures.toCreate // Return raw new features for UI preview
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