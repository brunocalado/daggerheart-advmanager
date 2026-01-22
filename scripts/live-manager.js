import { Manager } from "./manager.js";
import { ADVERSARY_BENCHMARKS, ADVERSARY_EXPERIENCES } from "./rules.js"; 
import { MODULE_ID, SETTING_IMPORT_FOLDER, SETTING_EXTRA_COMPENDIUMS, SETTING_FEATURE_COMPENDIUMS, SETTING_LAST_SOURCE, SETTING_LAST_FILTER_TIER, SETTING_SUGGEST_FEATURES, SKULL_IMAGE_PATH } from "./module.js";
import { CompendiumManager } from "./compendium-manager.js";
import { CompendiumStats } from "./compendium-stats.js";
import { DiceProbability } from "./dice-probability.js"; 

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Live Manager Application for Daggerheart Adversaries.
 * Allows selecting an actor (World or Compendium) and previewing changes in real-time.
 */
export class LiveManager extends HandlebarsApplicationMixin(ApplicationV2) {
    
    constructor(options = {}) {
        super(options);
        
        // Initial setup
        this.initialActor = options.actor || null;
        this.selectedActorId = this.initialActor ? this.initialActor.id : (options.actorId || null);
        
        // Default target tier based on actor or default
        this.targetTier = options.targetTier || (this.initialActor ? (Number(this.initialActor.system.tier) || 1) : 1);
        this.previewData = null;
        
        // Cache for auto-suggested names to prevent flickering on re-renders
        this._suggestionCache = {};
        
        // Cache for simulated stats to prevent re-rolling on UI updates
        this._cachedValues = null;

        // Store overrides separated by type
        this.overrides = {
            features: {
                names: {},
                damage: {}
            },
            suggestedFeatures: null,
            suggestedFeaturesType: "default",
            suggestedFeaturesTier: "default",
            experiences: {},
            damageFormula: undefined,
            halvedDamageFormula: undefined,
            difficulty: undefined,
            hp: undefined,
            stress: undefined,
            major: undefined,
            severe: undefined,
            attackMod: undefined,
            expAmount: undefined,
            expMod: undefined,
            damageTypes: null,
            criticalThreshold: undefined,
            directDamage: undefined,
            previewActorName: undefined
        };

        // Initialize Settings
        if (this.initialActor) {
            // FORCE overrides for the provided actor so it's not filtered out
            this.filterTier = String(Number(this.initialActor.system.tier) || 1);
            this.filterType = (this.initialActor.system.type || "standard").toLowerCase();
            this.source = "world"; 
        } else {
            // Use saved persistence if no specific actor was requested
            this.filterTier = game.settings.get(MODULE_ID, SETTING_LAST_FILTER_TIER) || "all"; 
            this.source = game.settings.get(MODULE_ID, SETTING_LAST_SOURCE) || "world"; 
            this.filterType = "all"; 
        }

        // Cache for feature lookup
        this._featureCache = new Map();
    }

    static DEFAULT_OPTIONS = {
        id: "daggerheart-live-preview",
        tag: "form",
        window: {
            title: "Adversary Live Manager",
            icon: "fas fa-eye",
            resizable: true,
            width: 1000,
            height: 800 
        },
        position: { width: 1000, height: 800 },
        actions: {
            selectTier: LiveManager.prototype._onSelectTier,
            applyChanges: LiveManager.prototype._onApplyChanges,
            openSettings: LiveManager.prototype._onOpenSettings,
            openStats: LiveManager.prototype._onOpenStats,
            openDiceProb: LiveManager.prototype._onOpenDiceProb,
            openFeature: LiveManager.prototype._onOpenFeature,
            openSheet: LiveManager.prototype._onOpenSheet,
            addExperience: LiveManager.prototype._onAddExperience,
            deleteExperience: LiveManager.prototype._onDeleteExperience,
            rollExperienceName: LiveManager.prototype._onRollExperienceName
        },
        form: {
            handler: LiveManager.prototype.submitHandler,
            closeOnSubmit: false
        }
    };

    static PARTS = {
        form: {
            template: "modules/daggerheart-advmanager/templates/live-manager.hbs",
            scrollable: [".preview-body"]
        }
    };

    /**
     * Helper to get the actual actor object.
     */
    async _getActor(actorId) {
        if (!actorId) return null;
        
        if (this.initialActor && this.initialActor.id === actorId) {
            return this.initialActor;
        }

        if (this.source === "world") {
            return game.actors.get(actorId);
        }

        if (this.source === "all") {
             // 1. World
             const worldActor = game.actors.get(actorId);
             if (worldActor) return worldActor;

             // 2. System Pack
             const sysPack = game.packs.get("daggerheart.adversaries");
             if (sysPack) {
                 try {
                     const doc = await sysPack.getDocument(actorId);
                     if (doc) return doc;
                 } catch (e) { /* Ignore not found */ }
             }

             // 3. Extra Packs
             const extraCompendiums = game.settings.get(MODULE_ID, SETTING_EXTRA_COMPENDIUMS) || [];
             for (const packId of extraCompendiums) {
                 const pack = game.packs.get(packId);
                 if (pack) {
                      try {
                         const doc = await pack.getDocument(actorId);
                         if (doc) return doc;
                      } catch (e) { /* Ignore */ }
                 }
             }
             return null;
        }

        // Specific Compendiums
        if (this.source === "daggerheart.adversaries") {
            const pack = game.packs.get("daggerheart.adversaries");
            if (pack) return await pack.getDocument(actorId);
        }

        if (this.source !== "world" && this.source !== "daggerheart.adversaries") {
            const pack = game.packs.get(this.source);
            if (pack) return await pack.getDocument(actorId);
        }

        return null;
    }

    /**
     * Finds a feature item by name to retrieve its image, UUID, and Type (Action/Reaction/Passive).
     * Now also retrieves 'flags.importedFrom' for tagging.
     */
    async _findFeatureItem(name) {
        if (this._featureCache.has(name)) return this._featureCache.get(name);

        // --- SPECIAL HANDLING FOR MINION (X) ---
        const minionMatch = name.match(/^Minion\s*\((\d+)\)$/i);
        if (minionMatch) {
            const customPack = game.packs.get("daggerheart-advmanager.custom-features");
            if (customPack) {
                // We need featureForm and flags for consistent data return
                const index = await customPack.getIndex({ fields: ["system.featureForm", "system.description", "flags.importedFrom"] });
                // Explicitly look for the template item "Minion (X)"
                const entry = index.find(i => i.name === "Minion (X)");
                
                if (entry) {
                    const data = {
                        img: entry.img,
                        uuid: entry.uuid,
                        type: entry.system?.featureForm || "",
                        description: entry.system?.description || "",
                        flags: entry.flags || {}
                    };
                    // Cache it under the specific name "Minion (5)" so we don't re-fetch
                    this._featureCache.set(name, data);
                    return data;
                }
            }
        }

        const extraFeaturePacks = game.settings.get(MODULE_ID, SETTING_FEATURE_COMPENDIUMS) || [];
        
        const packIds = [
            "daggerheart-advmanager.all-features", 
            ...extraFeaturePacks
        ];
        
        let cleanName = name;
        const match = name.match(/^(.*?)\s*\([^)]+\)$/);
        if (match) cleanName = match[1];

        for (const packId of packIds) {
            const pack = game.packs.get(packId);
            if (!pack) continue;
            
            // Optimization: Load index with featureForm, description AND flags.importedFrom
            const index = await pack.getIndex({ fields: ["system.featureForm", "system.description", "flags.importedFrom"] }); 
            
            let entry = index.find(i => i.name === name);
            
            if (!entry && cleanName !== name) {
                entry = index.find(i => i.name === cleanName);
            }

            if (entry) {
                const type = entry.system?.featureForm || "";
                const flags = entry.flags || {};
                const description = entry.system?.description || "";
                const data = {
                    img: entry.img,
                    uuid: entry.uuid,
                    type: type,
                    description: description,
                    flags: flags
                };
                this._featureCache.set(name, data);
                return data;
            }
        }

        const defaultData = { img: "icons/svg/item-bag.svg", uuid: null, type: "", description: "", flags: {} };
        this._featureCache.set(name, defaultData);
        return defaultData;
    }

    _getFeatureTypeLabel(type) {
        if (!type) return "";
        const t = type.toLowerCase();
        if (t === "action") return "(A)";
        if (t === "reaction") return "(R)";
        if (t === "passive") return "(P)";
        return "";
    }

    async updateSelectedActor(actor) {
        if (!actor) return;
        this.source = "world";
        this.initialActor = actor; 
        this.selectedActorId = actor.id;
        this.targetTier = Number(actor.system.tier) || 1;
        
        this.overrides = { features: { names: {}, damage: {} }, suggestedFeatures: null, experiences: {}, suggestedFeaturesType: "default", suggestedFeaturesTier: "default", damageTypes: null, criticalThreshold: undefined, directDamage: undefined, previewActorName: undefined }; 
        this._suggestionCache = {}; 
        this._cachedValues = null; 

        this.filterTier = String(this.targetTier); 
        this.filterType = (actor.system.type || "standard").toLowerCase();

        this.render();
    }

    _getRandomExperienceName(typeKey, excludeList = []) {
        if (!typeKey || typeKey === "all") typeKey = "standard";
        
        const list = ADVERSARY_EXPERIENCES[typeKey];
        if (list && Array.isArray(list)) {
            const candidates = list.filter(n => !excludeList.includes(n));
            
            if (candidates.length > 0) {
                return candidates[Math.floor(Math.random() * candidates.length)];
            } else if (list.length > 0) {
                return list[Math.floor(Math.random() * list.length)];
            }
        }
        return "New Experience"; 
    }

    _calculateCritChance(threshold) {
        if (!threshold) return "";
        const chance = Math.max(0, (21 - threshold) * 5);
        return `(${chance}%)`;
    }

    async _prepareContext(_options) {
        let rawAdversaries = [];

        // --- Determine Source List ---
        const sourceOptions = [
            { value: "all", label: "All Sources", selected: this.source === "all" }, 
            { value: "world", label: "World", selected: this.source === "world" },
            { value: "daggerheart.adversaries", label: "System Compendium", selected: this.source === "daggerheart.adversaries" }
        ];

        // --- NEW: Add Template Option (New Adversary) ---
        const templatePackId = "daggerheart-advmanager.templates";
        const templatePack = game.packs.get(templatePackId);
        if (templatePack) {
            sourceOptions.push({
                value: templatePackId,
                label: "New Adversary",
                selected: this.source === templatePackId
            });
        }

        const extraCompendiums = game.settings.get(MODULE_ID, SETTING_EXTRA_COMPENDIUMS) || [];
        let currentSourceIsValid = (this.source === "world" || this.source === "daggerheart.adversaries" || this.source === "all");

        // Validate Template Source
        if (this.source === templatePackId && templatePack) {
            currentSourceIsValid = true;
        }

        extraCompendiums.forEach(packId => {
            const pack = game.packs.get(packId);
            if (pack) {
                sourceOptions.push({
                    value: packId,
                    label: pack.metadata.label,
                    selected: this.source === packId
                });
                if (this.source === packId) currentSourceIsValid = true;
            }
        });

        if (!currentSourceIsValid) {
            this.source = "world";
            sourceOptions.forEach(o => o.selected = (o.value === "world"));
        }

        // --- Fetch Adversaries based on Source ---
        if (this.source === "world") {
            rawAdversaries = game.actors
                .filter(a => a.type === "adversary")
                .map(a => ({ 
                    id: a.id, 
                    name: a.name, 
                    tier: Number(a.system.tier) || 1,
                    advType: (a.system.type || "standard").toLowerCase() 
                }));
            
            if (this.initialActor) {
                const matchIndex = rawAdversaries.findIndex(a => a.id === this.initialActor.id);
                const tokenData = {
                    id: this.initialActor.id,
                    name: this.initialActor.name + (this.initialActor.isToken ? " (Token)" : ""),
                    tier: Number(this.initialActor.system.tier) || 1,
                    advType: (this.initialActor.system.type || "standard").toLowerCase()
                };
                if (matchIndex > -1) {
                    rawAdversaries[matchIndex] = tokenData;
                } else {
                    rawAdversaries.push(tokenData);
                }
            }
        } else if (this.source === "all") {
            // 1. World
            const worldAdvs = game.actors
                .filter(a => a.type === "adversary")
                .map(a => ({ 
                    id: a.id, 
                    name: a.name, 
                    tier: Number(a.system.tier) || 1,
                    advType: (a.system.type || "standard").toLowerCase(),
                    sourceLabel: "World"
                }));
            rawAdversaries.push(...worldAdvs);

            // 2. System Compendium
            const sysPack = game.packs.get("daggerheart.adversaries");
            if (sysPack) {
                const index = await sysPack.getIndex({ fields: ["system.tier", "system.type", "type"] });
                const sysAdvs = index
                    .filter(i => i.type === "adversary")
                    .map(i => ({
                        id: i._id,
                        name: i.name,
                        tier: Number(i.system?.tier) || 1,
                        advType: (i.system?.type || "standard").toLowerCase(),
                        sourceLabel: "System"
                    }));
                rawAdversaries.push(...sysAdvs);
            }

            // 3. Extra Compendiums
            for (const packId of extraCompendiums) {
                const pack = game.packs.get(packId);
                if (pack) {
                    const index = await pack.getIndex({ fields: ["system.tier", "system.type", "type"] });
                    const packAdvs = index
                        .filter(i => i.type === "adversary")
                        .map(i => ({
                            id: i._id,
                            name: i.name,
                            tier: Number(i.system?.tier) || 1,
                            advType: (i.system?.type || "standard").toLowerCase(),
                            sourceLabel: pack.metadata.label
                        }));
                    rawAdversaries.push(...packAdvs);
                }
            }

        } else {
            const pack = game.packs.get(this.source);
            if (pack) {
                const index = await pack.getIndex({ fields: ["system.tier", "system.type", "type"] });
                rawAdversaries = index
                    .filter(i => i.type === "adversary")
                    .map(i => ({
                        id: i._id,
                        name: i.name,
                        tier: Number(i.system?.tier) || 1,
                        advType: (i.system?.type || "standard").toLowerCase()
                    }));
            }
        }

        rawAdversaries.sort((a, b) => a.name.localeCompare(b.name));

        let displayedAdversaries = rawAdversaries;
        if (this.filterTier !== "all") {
            displayedAdversaries = displayedAdversaries.filter(a => a.tier === Number(this.filterTier));
        }
        if (this.filterType !== "all") {
            displayedAdversaries = displayedAdversaries.filter(a => a.advType === this.filterType);
        }

        if (!this.selectedActorId && displayedAdversaries.length > 0) {
             this.selectedActorId = displayedAdversaries[0].id;
        } else if (this.selectedActorId && !displayedAdversaries.find(a => a.id === this.selectedActorId)) {
             if (displayedAdversaries.length > 0) this.selectedActorId = displayedAdversaries[0].id;
             else this.selectedActorId = null;
        }

        displayedAdversaries = displayedAdversaries.map(a => ({
            ...a, selected: a.id === this.selectedActorId
        }));

        let currentStats = null;
        let previewStats = null;
        let actor = null;
        let featurePreviewData = []; 
        let allSuggestedFeatures = []; 
        let linkData = null;
        let damageOptions = []; 
        let halvedDamageOptions = [];
        let damageTooltip = ""; 
        let halvedDamageTooltip = ""; 
        let isMinion = false;
        let isHorde = false;
        let actorTypeLabel = "";
        let portraitImg = null;
        let suggestedFeaturesTypeOptions = []; 
        let suggestedFeaturesTierOptions = [];
        let criticalOptions = []; 
        let directOptions = []; 

        let isPhysical = false;
        let isMagical = false;

        if (this.selectedActorId) {
            actor = await this._getActor(this.selectedActorId);
            
            if (actor) {
                const currentTier = Number(actor.system.tier) || 1;
                const isLinked = actor.isToken ? actor.token?.actorLink : actor.prototypeToken?.actorLink;
                const typeKey = (actor.system.type || "standard").toLowerCase();
                isMinion = typeKey === "minion";
                isHorde = typeKey === "horde"; 
                actorTypeLabel = typeKey.charAt(0).toUpperCase() + typeKey.slice(1); 
                
                const rawImg = actor.img;
                const defaultIcons = [
                    "systems/daggerheart/assets/icons/documents/actors/dragon-head.svg",
                    "icons/svg/mystery-man.svg"
                ];

                if (!rawImg || defaultIcons.includes(rawImg)) {
                    portraitImg = SKULL_IMAGE_PATH;
                } else {
                    portraitImg = rawImg;
                }

                linkData = {
                    isLinked: isLinked,
                    icon: isLinked ? "fa-link" : "fa-unlink",
                    cssClass: isLinked ? "status-linked" : "status-unlinked",
                    label: isLinked ? "Linked" : "Unlinked"
                };
                if (actor.compendium || actor.pack) linkData = null;

                let previewDamageTypes = this.overrides.damageTypes;
                
                if (previewDamageTypes === null) {
                    const actorData = actor.toObject();
                    const mainPart = actorData.system.attack?.damage?.parts?.[0];
                    
                    if (mainPart) {
                        if (Array.isArray(mainPart.type)) {
                            previewDamageTypes = mainPart.type;
                        } else if (typeof mainPart.type === "string") {
                            previewDamageTypes = [mainPart.type];
                        } else {
                            previewDamageTypes = [];
                        }
                    } else {
                        previewDamageTypes = [];
                    }
                }
                
                const activeTypes = (previewDamageTypes || []).map(t => String(t).toLowerCase());
                
                isPhysical = activeTypes.includes("physical");
                isMagical = activeTypes.includes("magical");

                currentStats = this._extractStats(actor.toObject(), currentTier);
                const simResult = await this._simulateStats(actor, this.targetTier, currentTier);
                const benchmark = ADVERSARY_BENCHMARKS[typeKey]?.tiers[`tier_${this.targetTier}`];
                
                if (benchmark) {
                    if (benchmark.damage_rolls && Array.isArray(benchmark.damage_rolls)) {
                        damageOptions = benchmark.damage_rolls.map(d => ({ value: d, label: d }));
                    } else if (benchmark.basic_attack_y) {
                        const parts = benchmark.basic_attack_y.toString().split(/[/-]/).map(n => parseInt(n));
                        if (parts.length >= 2) {
                            const min = Math.min(...parts);
                            const max = Math.max(...parts);
                            for (let i = min; i <= max; i++) {
                                damageOptions.push({ value: String(i), label: String(i) });
                            }
                        } else {
                            damageOptions.push({ value: benchmark.basic_attack_y, label: benchmark.basic_attack_y });
                        }
                    }
                    if (benchmark.halved_damage_x && Array.isArray(benchmark.halved_damage_x)) {
                        halvedDamageOptions = benchmark.halved_damage_x.map(d => ({ value: d, label: d }));
                    }
                }
                
                if (damageOptions.length > 0) {
                    damageTooltip = "Suggested:<br>" + damageOptions.map(o => `• ${o.label}`).join("<br>");
                }
                if (halvedDamageOptions.length > 0) {
                    halvedDamageTooltip = "Suggested:<br>" + halvedDamageOptions.map(o => `• ${o.label}`).join("<br>");
                }

                const currentCritical = currentStats.critical;
                const previewCritical = this.overrides.criticalThreshold !== undefined ? Number(this.overrides.criticalThreshold) : currentCritical;
                
                const previewCritChance = this._calculateCritChance(previewCritical);

                criticalOptions = [];
                for (let i = 1; i <= 20; i++) {
                    criticalOptions.push({
                        value: i,
                        label: i,
                        selected: i === previewCritical
                    });
                }

                const currentDirect = actor.system.attack?.damage?.direct ?? false;
                const previewDirect = this.overrides.directDamage !== undefined ? (this.overrides.directDamage === "true") : currentDirect;
                
                directOptions = [
                    { value: "true", label: "Yes", selected: previewDirect === true },
                    { value: "false", label: "No", selected: previewDirect === false }
                ];

                previewStats = {
                    difficulty: this.overrides.difficulty !== undefined ? this.overrides.difficulty : simResult.stats.difficultyRaw,
                    hp: this.overrides.hp !== undefined ? this.overrides.hp : simResult.stats.hpRaw,
                    stress: this.overrides.stress !== undefined ? this.overrides.stress : simResult.stats.stressRaw,
                    major: this.overrides.major !== undefined ? this.overrides.major : simResult.stats.majorRaw,
                    severe: this.overrides.severe !== undefined ? this.overrides.severe : simResult.stats.severeRaw,
                    attackMod: this.overrides.attackMod !== undefined ? this.overrides.attackMod : simResult.stats.attackModRaw,
                    
                    difficultyDisplay: simResult.stats.difficulty,
                    hpDisplay: simResult.stats.hp,
                    stressDisplay: simResult.stats.stress,
                    thresholdsDisplay: simResult.stats.thresholds,
                    attackModDisplay: simResult.stats.attackMod,
                    experiences: simResult.stats.previewExperiences || [],
                    expTooltip: `Suggested:<br>Amount: ${simResult.stats.expAmountRange || "?"}<br>Modifier: ${simResult.stats.expModRange || "?"}`,
                    damage: simResult.stats.damage,
                    damageStats: simResult.stats.damageStats, 
                    mainDamageFormula: simResult.stats.mainDamageRaw,
                    halvedDamage: simResult.stats.halvedDamage, 
                    halvedDamageStats: simResult.stats.halvedDamageStats, 
                    mainHalvedDamageFormula: simResult.stats.mainHalvedDamageRaw,
                    tier: this.targetTier,
                    isMinion: isMinion,
                    hitChance: simResult.stats.hitChance,
                    hitChanceAgainst: simResult.stats.hitChanceAgainst,
                    critChance: previewCritChance 
                };

                if (isMinion) {
                    previewStats.thresholdsDisplay = "None"; 
                    previewStats.hpDisplay = "(Fixed)"; 
                }
                
                featurePreviewData = await Promise.all(simResult.structuredFeatures.map(async f => {
                    let overrideVal = undefined;
                    if (f.type === 'damage' || f.type === 'name_horde') {
                         overrideVal = this.overrides.features.damage[f.itemId];
                    } else {
                         overrideVal = this.overrides.features.names[f.itemId];
                    }
                    
                    let displayFrom = f.from;
                    if (f.type === 'damage') {
                        displayFrom = `<strong>${f.itemName}</strong> <span class="old-value-sub">(${f.from})</span>`;
                    } else if (f.type === 'name_horde') {
                        displayFrom = `<strong>${f.from}</strong>`;
                    } else {
                        displayFrom = `<strong>${f.from}</strong>`;
                    }

                    let featureOptions = null;
                    let optionsTooltip = ""; 
                    let damageStats = "";
                    let isHordeFeature = false;
                    let valueToShow = overrideVal !== undefined ? overrideVal : f.to;

                    if (f.type === 'name_horde') {
                        isHordeFeature = true;
                        valueToShow = simResult.stats.mainHalvedDamageRaw || "0"; 
                    }

                    if ((f.type === 'damage') && !isHordeFeature) {
                         const currentVal = this.overrides.features.damage[f.itemId]?.[f.from] || f.to;
                         valueToShow = currentVal;
                         featureOptions = damageOptions.map(d => ({
                             value: d.value,
                             label: d.label,
                             selected: d.value === currentVal
                         }));
                         if (featureOptions.length > 0) {
                             optionsTooltip = "Suggested:<br>" + featureOptions.map(o => `• ${o.label}`).join("<br>");
                         }
                         damageStats = this._calculateDamageStats(currentVal);
                    }

                    const isMinionFeature = f.type === 'name_minion';
                    let minionValue = "";
                    if (isMinionFeature) {
                        const targetStr = overrideVal !== undefined ? overrideVal : f.to;
                        const match = targetStr.toString().match(/\((\d+)\)/);
                        if (match) minionValue = match[1];
                    }

                    const itemData = await this._findFeatureItem(f.itemName);
                    const typeLabel = this._getFeatureTypeLabel(itemData.type);

                    return {
                        itemId: f.itemId,
                        originalName: displayFrom,
                        originalFormula: f.from, 
                        newName: valueToShow, 
                        isRenamed: f.type.startsWith("name_") && f.type !== 'name_horde' && f.type !== 'name_minion', 
                        options: featureOptions, 
                        optionsTooltip: optionsTooltip,
                        isMinionFeature: isMinionFeature,
                        isHordeFeature: isHordeFeature,
                        minionValue: minionValue,
                        img: itemData.img,
                        uuid: itemData.uuid,
                        stats: damageStats, 
                        typeLabel: typeLabel 
                    };
                }));

                let suggestionTypeKey = typeKey;
                if (this.overrides.suggestedFeaturesType && this.overrides.suggestedFeaturesType !== "default") {
                    suggestionTypeKey = this.overrides.suggestedFeaturesType;
                }

                let suggestionTier = this.targetTier; 
                if (this.overrides.suggestedFeaturesTier && this.overrides.suggestedFeaturesTier !== "default") {
                    suggestionTier = parseInt(this.overrides.suggestedFeaturesTier);
                }

                suggestedFeaturesTypeOptions = []; 
                const typeKeys = Object.keys(ADVERSARY_BENCHMARKS).sort();
                typeKeys.forEach(k => {
                    const isSelected = (this.overrides.suggestedFeaturesType === "default" && k === typeKey) ||
                                       (this.overrides.suggestedFeaturesType === k);
                    suggestedFeaturesTypeOptions.push({
                        value: k,
                        label: k.charAt(0).toUpperCase() + k.slice(1),
                        selected: isSelected
                    });
                });

                suggestedFeaturesTierOptions = [1, 2, 3, 4].map(t => ({
                    value: t,
                    label: `Tier ${t}`,
                    selected: t === suggestionTier
                }));

                // Helper to generate tags (UPDATED)
                const getTags = (type, flags, isHomebrew) => {
                    let actionTag = "";
                    let actionClass = "";
                    if (type) {
                        const t = type.toLowerCase();
                        if (t === "action") { actionTag = "Action"; actionClass = "tag-action"; }
                        else if (t === "reaction") { actionTag = "Reaction"; actionClass = "tag-reaction"; }
                        else if (t === "passive") { actionTag = "Passive"; actionClass = "tag-passive"; }
                    }

                    const imported = flags?.importedFrom || {};
                    const tierTag = imported.tier ? `T${imported.tier}` : null; // <--- Changed from `Tier ${imported.tier}` to `T${imported.tier}`
                    const typeTag = imported.type || null;
                    const customTag = imported.customTag || null; 

                    let sourceLabel = null;
                    if (customTag && customTag.trim() !== "") {
                         sourceLabel = customTag; 
                    } else if (isHomebrew) {
                         sourceLabel = "Homebrew";
                    }
                    
                    return {
                        action: { label: actionTag, css: actionClass },
                        tier: tierTag,
                        type: typeTag,
                        homebrew: sourceLabel 
                    };
                };

                let possibleMatches = [];
                let ruleSuggestions = [];

                const suggestionBenchmark = ADVERSARY_BENCHMARKS[suggestionTypeKey]?.tiers[`tier_${suggestionTier}`];
                if (suggestionBenchmark && suggestionBenchmark.suggested_features) {
                    if (Array.isArray(suggestionBenchmark.suggested_features)) {
                        ruleSuggestions = [...suggestionBenchmark.suggested_features];
                    } else if (typeof suggestionBenchmark.suggested_features === "string" && suggestionBenchmark.suggested_features !== "") {
                        ruleSuggestions = [suggestionBenchmark.suggested_features];
                    }
                }

                const extraFeaturePacks = game.settings.get(MODULE_ID, SETTING_FEATURE_COMPENDIUMS) || [];
                // Changed: Removed "daggerheart-advmanager.custom-features" from hardcoded list
                const packsToQuery = [...new Set(["daggerheart-advmanager.all-features", ...extraFeaturePacks])];
                const enableSuggestions = game.settings.get(MODULE_ID, SETTING_SUGGEST_FEATURES);

                if (enableSuggestions) {
                    for (const packId of packsToQuery) {
                        const pack = game.packs.get(packId);
                        if (!pack) continue;
                        
                        const index = await pack.getIndex({ fields: ["img", "system.featureForm", "system.description", "flags.importedFrom"] });
                        
                        const matches = index.filter(i => {
                            if (i.type !== "feature") return false;

                            const imported = i.flags?.importedFrom;
                            
                            if (imported && imported.tier !== undefined && imported.type) {
                                const matchesTier = imported.tier === suggestionTier;
                                const matchesType = imported.type?.toLowerCase() === suggestionTypeKey.toLowerCase();
                                return matchesTier && matchesType;
                            } 
                            
                            i.isHomebrew = true;
                            return true;
                        });

                        matches.forEach(m => {
                            if (!possibleMatches.find(pm => pm._id === m._id)) {
                                possibleMatches.push(m);
                            }
                        });
                    }
                }
                
                possibleMatches.sort((a, b) => a.name.localeCompare(b.name));

                allSuggestedFeatures = [];
                
                const allItems = actor.items instanceof Array ? actor.items : actor.items.contents || [];
                const isOwned = (name) => allItems.some(i => i.name === name);

                if (this.overrides.suggestedFeatures === null) {
                    this.overrides.suggestedFeatures = [];
                }

                const addedSet = new Set();
                const isRuleSuggested = (name) => ruleSuggestions.includes(name);

                const selectedNames = [...this.overrides.suggestedFeatures].sort((a, b) => a.localeCompare(b));
                
                for (const name of selectedNames) {
                    if (!isOwned(name)) {
                        let itemData = possibleMatches.find(pm => pm.name === name);

                        if (!itemData) {
                            const found = await this._findFeatureItem(name);
                            itemData = {
                                name: name,
                                img: found.img,
                                uuid: found.uuid,
                                system: { featureForm: found.type, description: found.description },
                                flags: found.flags
                            };
                        }

                        allSuggestedFeatures.push({
                            name: itemData.name,
                            checked: true,
                            isRuleSuggestion: isRuleSuggested(itemData.name),
                            img: itemData.img,
                            uuid: itemData.uuid || itemData._id,
                            description: itemData.system?.description || "",
                            tags: getTags(itemData.system?.featureForm, itemData.flags, itemData.isHomebrew)
                        });
                        addedSet.add(name);
                    }
                }

                for (const item of possibleMatches) {
                    const name = item.name;

                    if (addedSet.has(name)) continue;

                    if (!isOwned(name)) {
                        allSuggestedFeatures.push({
                            name: item.name,
                            checked: false,
                            isRuleSuggestion: isRuleSuggested(item.name),
                            img: item.img,
                            uuid: item.uuid || item._id,
                            description: item.system?.description || "",
                            tags: getTags(item.system?.featureForm, item.flags, item.isHomebrew)
                        });
                        addedSet.add(name);
                    }
                }
            }
        }

        const tiers = [1, 2, 3, 4].map(t => ({
            value: t,
            label: `Tier ${t}`,
            isCurrent: t === this.targetTier,
            cssClass: t === this.targetTier ? "active" : ""
        }));

        const filterOptions = [
            { value: "all", label: "All Tiers", selected: this.filterTier === "all" },
            { value: "1", label: "Tier 1", selected: this.filterTier === "1" },
            { value: "2", label: "Tier 2", selected: this.filterTier === "2" },
            { value: "3", label: "Tier 3", selected: this.filterTier === "3" },
            { value: "4", label: "Tier 4", selected: this.filterTier === "4" }
        ];

        const typeKeys = Object.keys(ADVERSARY_BENCHMARKS).sort();
        const typeOptions = [
            { value: "all", label: "All Types", selected: this.filterType === "all" },
            ...typeKeys.map(k => ({ 
                value: k, 
                label: k.charAt(0).toUpperCase() + k.slice(1), 
                selected: this.filterType === k 
            }))
        ];

        // Generate preview actor name
        let previewActorName = "";
        if (this.overrides.previewActorName !== undefined) {
            previewActorName = this.overrides.previewActorName;
        } else if (actor) {
            const baseName = actor.name;
            const currentTier = Number(actor.system.tier) || 1;
            if (this.targetTier !== currentTier) {
                previewActorName = `${baseName} (T${this.targetTier})`;
            } else {
                previewActorName = baseName;
            }
        }

        return {
            adversaries: displayedAdversaries,
            hasActor: !!actor,
            selectedActorId: this.selectedActorId,
            currentStats,
            previewStats,
            featurePreviewData,
            allSuggestedFeatures,
            tiers,
            linkData,
            sourceOptions,
            filterOptions,
            typeOptions,
            damageOptions,
            halvedDamageOptions,
            damageTooltip,
            halvedDamageTooltip,
            actorName: actor?.name || "None",
            portraitImg: portraitImg,
            isHorde: isHorde,
            actorTypeLabel: actorTypeLabel,
            suggestedFeaturesTypeOptions,
            suggestedFeaturesTierOptions,
            isPhysical,
            isMagical,
            criticalOptions,
            directOptions,
            previewActorName: previewActorName
        };
    }

    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;

        const sourceSelect = html.querySelector('.source-select');
        if (sourceSelect) sourceSelect.addEventListener('change', (e) => this._onSelectSource(e, sourceSelect));

        const filterSelect = html.querySelector('.filter-tier-select');
        if (filterSelect) filterSelect.addEventListener('change', (e) => this._onFilterTier(e, filterSelect));

        const typeSelect = html.querySelector('.filter-type-select');
        if (typeSelect) typeSelect.addEventListener('change', (e) => this._onFilterType(e, typeSelect));

        const actorSelect = html.querySelector('.main-actor-select');
        if (actorSelect) actorSelect.addEventListener('change', (e) => this._onSelectActor(e, actorSelect));

        html.querySelectorAll('.override-input').forEach(input => {
            if (!input.classList.contains('critical-select') && !input.classList.contains('direct-select')) {
                input.addEventListener('change', (e) => this._onOverrideChange(e, input));
            }
        });

        const critSelect = html.querySelector('.critical-select');
        if (critSelect) critSelect.addEventListener('change', (e) => this._onCriticalChange(e, critSelect));

        const directSelect = html.querySelector('.direct-select');
        if (directSelect) directSelect.addEventListener('change', (e) => this._onDirectChange(e, directSelect));

        html.querySelectorAll('.feature-override-input, .feature-override-select').forEach(input => {
            input.addEventListener('change', (e) => this._onFeatureOverrideChange(e, input));
        });

        html.querySelectorAll('.minion-val-input').forEach(input => {
            input.addEventListener('change', (e) => this._onMinionOverrideChange(e, input));
            input.addEventListener('click', (e) => e.stopPropagation());
        });

        html.querySelectorAll('.feature-checkbox').forEach(input => {
            input.addEventListener('change', (e) => this._onFeatureCheckboxChange(e, input));
        });
        
        html.querySelectorAll('.exp-name-input').forEach(input => {
            input.addEventListener('change', (e) => this._onExpNameChange(e, input));
        });
        html.querySelectorAll('.exp-mod-select').forEach(input => {
            input.addEventListener('change', (e) => this._onExpModChange(e, input));
        });

        html.querySelectorAll('.damage-type-checkbox').forEach(input => {
            input.addEventListener('change', (e) => this._onDamageTypeChange(e, input));
        });

        const suggestionTypeSelect = html.querySelector('.suggestion-type-select');
        if (suggestionTypeSelect) {
            suggestionTypeSelect.addEventListener('change', (e) => this._onChangeSuggestedType(e, suggestionTypeSelect));
        }

        const suggestionTierSelect = html.querySelector('.suggestion-tier-select');
        if (suggestionTierSelect) {
            suggestionTierSelect.addEventListener('change', (e) => this._onChangeSuggestedTier(e, suggestionTierSelect));
        }

        const previewActorNameInput = html.querySelector('.preview-actor-name-input');
        if (previewActorNameInput) {
            previewActorNameInput.addEventListener('change', (e) => this._onPreviewActorNameChange(e, previewActorNameInput));
        }
    }

    async _onOpenSettings(event, target) {
        new CompendiumManager().render(true);
    }

    async _onOpenStats(event, target) {
        new CompendiumStats().render(true);
    }
    
    async _onOpenDiceProb(event, target) {
        new DiceProbability().render(true);
    }

    async _onSelectSource(event, target) {
        event.preventDefault();
        event.stopPropagation();
        this.source = target.value;
        this.selectedActorId = null;
        this.overrides = { features: { names: {}, damage: {} }, suggestedFeatures: null, experiences: {}, suggestedFeaturesType: "default", suggestedFeaturesTier: "default", damageTypes: null, criticalThreshold: undefined, directDamage: undefined, previewActorName: undefined }; 
        this._suggestionCache = {}; 
        this._cachedValues = null;
        await game.settings.set(MODULE_ID, SETTING_LAST_SOURCE, this.source);
        this.render();
    }

    async _onFilterTier(event, target) {
        event.preventDefault();
        event.stopPropagation();
        this.filterTier = target.value;
        await game.settings.set(MODULE_ID, SETTING_LAST_FILTER_TIER, this.filterTier);
        this.render();
    }

    async _onFilterType(event, target) {
        event.preventDefault();
        event.stopPropagation();
        this.filterType = target.value;
        this.render();
    }

    async _onSelectActor(event, target) {
        event.preventDefault();
        event.stopPropagation();
        this.selectedActorId = target.value;
        this.overrides = { features: { names: {}, damage: {} }, suggestedFeatures: null, experiences: {}, suggestedFeaturesType: "default", suggestedFeaturesTier: "default", damageTypes: null, criticalThreshold: undefined, directDamage: undefined, previewActorName: undefined }; 
        this._suggestionCache = {}; 
        this._cachedValues = null;
        
        const actor = await this._getActor(this.selectedActorId);
        if (actor) {
            this.targetTier = Number(actor.system.tier) || 1;
        }
        this.render();
    }

    async _onSelectTier(event, target) {
        const tier = Number(target.dataset.tier);
        if (tier) {
            this.targetTier = tier;
            this.overrides = { features: { names: {}, damage: {} }, suggestedFeatures: null, experiences: {}, suggestedFeaturesType: "default", suggestedFeaturesTier: "default", damageTypes: null, criticalThreshold: undefined, directDamage: undefined, previewActorName: undefined }; 
            this._suggestionCache = {}; 
            this._cachedValues = null;
            this.render();
        }
    }

    async _onApplyChanges(event, target) {
        if (!this.selectedActorId) return;
        
        let actor = await this._getActor(this.selectedActorId);
        if (!actor) return;

        try {
            if (actor.compendium || actor.pack) {
                const folderName = game.settings.get(MODULE_ID, SETTING_IMPORT_FOLDER) || "Imported Adversaries";
                let folder = game.folders.find(f => f.name === folderName && f.type === "Actor");
                if (!folder) {
                    folder = await Folder.create({ name: folderName, type: "Actor", color: "#430047" });
                }

                const pack = actor.compendium || game.packs.get(actor.pack);
                if (pack) {
                     actor = await game.actors.importFromCompendium(pack, this.selectedActorId, { folder: folder.id });
                }
                
                if (actor) {
                    this.source = "world";
                    this.selectedActorId = actor.id;
                    await game.settings.set(MODULE_ID, SETTING_LAST_SOURCE, "world");
                }
            }

            const result = await Manager.updateSingleActor(actor, this.targetTier, this.overrides);
            
            let freshActor = actor;
            if (!actor.pack && !actor.compendium && !actor.isToken) {
                 freshActor = game.actors.get(actor.id) || actor;
            }

            const manualUpdates = {};
            let hasManualUpdates = false;

            if (this.overrides.damageTypes) {
                const actorData = freshActor.toObject();
                const parts = actorData.system.attack?.damage?.parts ? foundry.utils.deepClone(actorData.system.attack.damage.parts) : [];
                
                if (parts && parts.length > 0) {
                    parts[0].type = this.overrides.damageTypes; 
                    manualUpdates["system.attack.damage.parts"] = parts;
                    hasManualUpdates = true;
                }
            }

            if (this.overrides.criticalThreshold !== undefined) {
                manualUpdates["system.criticalThreshold"] = parseInt(this.overrides.criticalThreshold);
                hasManualUpdates = true;
            }

            if (this.overrides.directDamage !== undefined) {
                manualUpdates["system.attack.damage.direct"] = (this.overrides.directDamage === "true");
                hasManualUpdates = true;
            }

            if (this.overrides.previewActorName !== undefined && this.overrides.previewActorName.trim() !== "") {
                manualUpdates["name"] = this.overrides.previewActorName;
                hasManualUpdates = true;
            }

            if (hasManualUpdates) {
                const updatedActor = await freshActor.update(manualUpdates);
                if (updatedActor && updatedActor.id) {
                    freshActor = updatedActor;
                }
            }

            if (!result && !hasManualUpdates) {
                ui.notifications.warn("No changes were necessary.");
            }

            this.filterTier = String(this.targetTier); 
            await game.settings.set(MODULE_ID, SETTING_LAST_FILTER_TIER, this.filterTier);

            const typeKey = (freshActor.system.type || "standard").toLowerCase();
            this.filterType = typeKey; 

            this.overrides = { features: { names: {}, damage: {} }, suggestedFeatures: null, experiences: {}, suggestedFeaturesType: "default", suggestedFeaturesTier: "default", damageTypes: null, criticalThreshold: undefined, directDamage: undefined, previewActorName: undefined };
            this._suggestionCache = {}; 
            this._cachedValues = null;

            if (this.selectedActorId && !actor.pack && !actor.compendium && !actor.isToken) {
                 this.initialActor = game.actors.get(this.selectedActorId);
            } else {
                 this.initialActor = freshActor;
            }

            this.render();

        } catch (e) {
            console.error(e);
            ui.notifications.error("Error applying changes. Check console.");
        }
    }

    _onChangeSuggestedType(event, target) {
        event.preventDefault();
        this.overrides.suggestedFeaturesType = target.value;
        this.render();
    }

    _onChangeSuggestedTier(event, target) {
        event.preventDefault();
        this.overrides.suggestedFeaturesTier = target.value;
        this.render();
    }

    _onExpNameChange(event, target) {
        const id = target.dataset.id;
        if (!this.overrides.experiences[id]) this.overrides.experiences[id] = {};
        this.overrides.experiences[id].name = target.value;
        this.render();
    }

    _onExpModChange(event, target) {
        const id = target.dataset.id;
        if (!this.overrides.experiences[id]) this.overrides.experiences[id] = {};
        this.overrides.experiences[id].value = parseInt(target.value);
        this.render();
    }

    _onDeleteExperience(event, target) {
        const id = target.dataset.id;
        if (!this.overrides.experiences[id]) this.overrides.experiences[id] = {};
        this.overrides.experiences[id].deleted = true;
        this.render();
    }

    _onAddExperience(event, target) {
        const newId = "new_" + foundry.utils.randomID();
        if (!this.overrides.experiences[newId]) this.overrides.experiences[newId] = {};
        
        let typeKey = this.filterType;
        if (!typeKey || typeKey === "all") typeKey = "standard";
        
        const usedNames = Object.values(this.overrides.experiences).map(e => e.name);
        const pickedName = this._getRandomExperienceName(typeKey, usedNames);

        this.overrides.experiences[newId].name = pickedName;
        this.overrides.experiences[newId].value = 2; 
        this.render();
    }

    _onRollExperienceName(event, target) {
        const id = target.dataset.id;
        let typeKey = this.filterType;
        if (!typeKey || typeKey === "all") typeKey = "standard";

        const usedNames = Object.values(this.overrides.experiences).map(e => e.name);
        const pickedName = this._getRandomExperienceName(typeKey, usedNames);
        
        if (pickedName) {
            if (!this.overrides.experiences[id]) this.overrides.experiences[id] = {};
            this.overrides.experiences[id].name = pickedName;
            this.render();
        }
    }

    _onDamageTypeChange(event, target) {
        const checkboxPhysical = this.element.querySelector('.damage-type-checkbox[value="physical"]');
        const checkboxMagical = this.element.querySelector('.damage-type-checkbox[value="magical"]');
        
        const newTypes = [];
        if (checkboxPhysical && checkboxPhysical.checked) newTypes.push("physical");
        if (checkboxMagical && checkboxMagical.checked) newTypes.push("magical");
        
        this.overrides.damageTypes = newTypes;
    }

    _onCriticalChange(event, target) {
        const val = parseInt(target.value);
        if (!isNaN(val)) {
            this.overrides.criticalThreshold = val;
        }
        this.render(); 
    }

    _onDirectChange(event, target) {
        const val = target.value;
        this.overrides.directDamage = val;
        this.render();
    }

    _onPreviewActorNameChange(event, target) {
        this.overrides.previewActorName = target.value;
    }

    async _onOpenFeature(event, target) {
        event.preventDefault();
        event.stopPropagation();
        const uuid = target.dataset.uuid;
        if (!uuid) return;
        const item = await fromUuid(uuid);
        if (item && item.sheet) {
            item.sheet.render(true);
        } else {
            ui.notifications.warn("Item not found or has no sheet.");
        }
    }

    async _onOpenSheet(event, target) {
        event.preventDefault();
        event.stopPropagation();
        if (this.selectedActorId) {
            const actor = await this._getActor(this.selectedActorId);
            if (actor && actor.sheet) {
                actor.sheet.render(true);
            }
        }
    }

    _onOverrideChange(event, target) {
        const field = target.dataset.field;
        const value = target.value;
        this.overrides[field] = value;
        this.render();
    }

    _onFeatureCheckboxChange(event, target) {
        const featureName = target.dataset.feature;
        const isChecked = target.checked;

        if (!this.overrides.suggestedFeatures) {
            this.overrides.suggestedFeatures = [];
        }

        if (isChecked) {
            if (!this.overrides.suggestedFeatures.includes(featureName)) {
                this.overrides.suggestedFeatures.push(featureName);
            }
        } else {
            this.overrides.suggestedFeatures = this.overrides.suggestedFeatures.filter(f => f !== featureName);
        }
    }

    _onFeatureOverrideChange(event, target) {
        const itemId = target.dataset.itemid;
        const value = target.value;
        const isDamage = target.classList.contains('feature-override-select') || target.classList.contains('feature-damage-input');
        
        if (!this.overrides.features) this.overrides.features = { names: {}, damage: {} };
        if (!this.overrides.features.names) this.overrides.features.names = {};
        if (!this.overrides.features.damage) this.overrides.features.damage = {};

        if (isDamage) {
            const originalFormula = target.dataset.original;
            if (originalFormula) {
                if (!this.overrides.features.damage[itemId] || typeof this.overrides.features.damage[itemId] !== 'object') {
                    this.overrides.features.damage[itemId] = {};
                }
                this.overrides.features.damage[itemId][originalFormula] = value;
            } else {
                this.overrides.features.damage[itemId] = value;
            }
            delete this.overrides.features.names[itemId];
        } else {
            this.overrides.features.names[itemId] = value;
        }
        
        this.render(); 
    }

    _onMinionOverrideChange(event, target) {
        const itemId = target.dataset.itemid;
        const val = parseInt(target.value);
        
        if (!this.overrides.features) this.overrides.features = { names: {}, damage: {} };
        if (!this.overrides.features.names) this.overrides.features.names = {};

        if (!isNaN(val)) {
            this.overrides.features.names[itemId] = `Minion (${val})`;
        } else {
            delete this.overrides.features.names[itemId];
        }
        this.render();
    }

    _calculateDamageStats(formula) {
        if (!formula) return "";
        const parsed = Manager.parseDamageString(formula);
        if (!parsed) return "";

        let min, max, mean;

        if (parsed.die === null) {
            let val = parsed.count;
            min = val;
            max = val;
            mean = val;
        } else {
            const faces = parseInt(parsed.die.replace('d', ''));
            const count = parsed.count;
            const bonus = parsed.bonus;

            min = (count * 1) + bonus;
            max = (count * faces) + bonus;
            const avg = (count * ((faces + 1) / 2)) + bonus;
            mean = Math.ceil(avg);
        }

        return `(Min: ${min}, Mean: ${mean}, Max: ${max})`;
    }

    _extractStats(actorData, tier) {
        const sys = actorData.system;
        const damageParts = [];
        const halvedParts = []; 
        let firstDamageFormula = null;
        let firstHalvedFormula = null;
        let damageTypesLabel = "";
        
        if (sys.attack?.damage?.parts) {
            sys.attack.damage.parts.forEach((p, idx) => {
                if(p.value) {
                    let formula = p.value.custom?.enabled ? p.value.custom.formula : 
                        (p.value.dice ? `${p.value.flatMultiplier || 1}${p.value.dice}${p.value.bonus ? (p.value.bonus > 0 ? '+'+p.value.bonus : p.value.bonus) : ''}` : p.value.flatMultiplier);
                    
                    damageParts.push(formula); 
                    if (idx === 0) {
                        firstDamageFormula = formula;
                        let types = [];
                        if (p.type) {
                            if (Array.isArray(p.type)) types = p.type;
                            else if (typeof p.type === "string") types = [p.type];
                        }
                        
                        if (types.length > 0) {
                            const typeNames = types.map(t => t.charAt(0).toUpperCase() + t.slice(1));
                            damageTypesLabel = `(${typeNames.join("/")})`;
                        }
                    }
                }
                if (p.valueAlt) {
                    let formula = p.valueAlt.custom?.enabled ? p.valueAlt.custom.formula : 
                        (p.valueAlt.dice ? `${p.valueAlt.flatMultiplier || 1}${p.valueAlt.dice}${p.valueAlt.bonus ? (p.valueAlt.bonus > 0 ? '+'+p.valueAlt.bonus : p.valueAlt.bonus) : ''}` : p.valueAlt.flatMultiplier);
                    halvedParts.push(formula);
                    if (idx === 0) firstHalvedFormula = formula;
                }
            });
        }
        
        const attackMod = Number(sys.attack?.roll?.bonus) || 0;
        const hitChance = Manager.calculateHitChance(attackMod, tier);
        const difficulty = Number(sys.difficulty) || 0;
        const hitChanceAgainst = Manager.calculateHitChanceAgainst(difficulty, tier);
        const critical = Number(sys.criticalThreshold) || 20; 

        const critChance = this._calculateCritChance(critical);

        const experiences = sys.experiences || {};
        const expList = [];
        for (const k in experiences) {
             const val = Number(experiences[k].value) || 0;
             const sign = val >= 0 ? "+" : "";
             expList.push({
                 name: experiences[k].name,
                 value: `${sign}${val}`
             });
        }

        const isDirect = sys.attack?.damage?.direct ?? false;
        const directLabel = isDirect ? "Direct: Yes" : "Direct: No";

        return {
            tier,
            difficulty: sys.difficulty,
            hp: sys.resources?.hitPoints?.max,
            stress: sys.resources?.stress?.max,
            thresholds: `${sys.damageThresholds?.major} / ${sys.damageThresholds?.severe}`,
            attackMod: sys.attack?.roll?.bonus,
            damage: damageParts.join(", ") || "None",
            damageTypesLabel: damageTypesLabel, 
            damageStats: this._calculateDamageStats(firstDamageFormula), 
            halvedDamage: halvedParts.join(", ") || null,
            halvedDamageStats: this._calculateDamageStats(firstHalvedFormula), 
            hitChance: hitChance,
            hitChanceAgainst: hitChanceAgainst,
            experiences: expList,
            critical: critical, 
            critChance: critChance, 
            directLabel: directLabel 
        };
    }

    async _simulateStats(actor, targetTier, currentTier) {
        const actorData = actor.toObject();
        const typeKey = (actorData.system.type || "standard").toLowerCase();
        
        let suggestionTypeKey = typeKey;
        if (this.overrides.suggestedFeaturesType && this.overrides.suggestedFeaturesType !== "default") {
            suggestionTypeKey = this.overrides.suggestedFeaturesType;
        }

        let suggestionTier = targetTier;
        if (this.overrides.suggestedFeaturesTier && this.overrides.suggestedFeaturesTier !== "default") {
            suggestionTier = parseInt(this.overrides.suggestedFeaturesTier);
        }

        if (!ADVERSARY_BENCHMARKS[typeKey]) return { stats: { error: "Unknown Type" }, features: [], structuredFeatures: [] };
        
        const benchmark = ADVERSARY_BENCHMARKS[typeKey].tiers[`tier_${targetTier}`];

        if (!benchmark) return { stats: { error: "Benchmark missing" }, features: [], structuredFeatures: [] };

        if (!this._cachedValues) {
            this._cachedValues = {};
            this._cachedValues.difficulty = Manager.getRollFromRange(benchmark.difficulty);
            this._cachedValues.hp = Manager.getRollFromRange(benchmark.hp);
            this._cachedValues.stress = Manager.getRollFromRange(benchmark.stress);
            this._cachedValues.attackMod = Manager.getRollFromSignedRange(benchmark.attack_modifier);
            
            if (benchmark.threshold_min && benchmark.threshold_max) {
                 const minPair = Manager.parseThresholdPair(benchmark.threshold_min);
                 const maxPair = Manager.parseThresholdPair(benchmark.threshold_max);
                 if (minPair && maxPair) {
                     this._cachedValues.major = Math.floor(Math.random() * (maxPair.major - minPair.major + 1)) + minPair.major;
                     this._cachedValues.severe = Math.floor(Math.random() * (maxPair.severe - minPair.severe + 1)) + minPair.severe;
                 }
            }

            if (benchmark.basic_attack_y) this._cachedValues.basic_attack_y = Manager.getRollFromRange(benchmark.basic_attack_y);
            if (benchmark.minion_feature_x) this._cachedValues.minion_feature_x = Manager.getRollFromRange(benchmark.minion_feature_x);
            if (benchmark.halved_damage_x && Array.isArray(benchmark.halved_damage_x) && benchmark.halved_damage_x.length > 0 && benchmark.halved_damage_x[0].includes("-")) {
            }
        }

        const frozenBenchmark = foundry.utils.deepClone(benchmark);
        if (this._cachedValues.basic_attack_y !== undefined) frozenBenchmark.basic_attack_y = String(this._cachedValues.basic_attack_y);
        if (this._cachedValues.minion_feature_x !== undefined) frozenBenchmark.minion_feature_x = String(this._cachedValues.minion_feature_x);

        const sim = {};
        sim.difficultyRaw = this._cachedValues.difficulty;
        sim.hpRaw = this._cachedValues.hp;
        sim.stressRaw = this._cachedValues.stress;
        sim.attackModRaw = this._cachedValues.attackMod;
        
        if (this._cachedValues.major && this._cachedValues.severe) {
            sim.majorRaw = this._cachedValues.major;
            sim.severeRaw = this._cachedValues.severe;
        }

        sim.previewExperiences = [];
        if (benchmark.experiences) {
            const targetMod = this.overrides.expMod !== undefined ? this.overrides.expMod : Manager.getRollFromSignedRange(benchmark.experiences.modifier);
            
            let targetAmount = 0;
            if (this.overrides.expAmount !== undefined) {
                targetAmount = this.overrides.expAmount;
            } else {
                targetAmount = Manager.getRollFromRange(benchmark.experiences.amount);
                this.overrides.expAmount = targetAmount; 
            }
            
            sim.expAmountRange = benchmark.experiences.amount;
            sim.expModRange = benchmark.experiences.modifier;

            const currentExpMap = actorData.system.experiences || {};
            let activeCount = 0;
            const usedNames = [];
            
            for (const [key, exp] of Object.entries(currentExpMap)) {
                const override = this.overrides.experiences[key];
                if (override && override.deleted) continue;
                
                activeCount++;
                let finalVal = targetMod;
                let finalName = exp.name;
                
                if (override) {
                    if (override.value !== undefined) finalVal = override.value;
                    if (override.name !== undefined) finalName = override.name;
                }
                
                usedNames.push(finalName);

                sim.previewExperiences.push({
                    id: key,
                    name: finalName,
                    value: finalVal,
                    options: [2, 3, 4, 5].map(v => ({ value: v, label: `+${v}`, selected: v === finalVal }))
                });
            }

            for (const [key, data] of Object.entries(this.overrides.experiences)) {
                if (!currentExpMap[key] && !data.deleted) {
                     activeCount++;
                     const val = data.value !== undefined ? data.value : targetMod;
                     const name = data.name || "New Experience";
                     usedNames.push(name);
                     
                     sim.previewExperiences.push({
                        id: key,
                        name: name,
                        value: val,
                        isNew: true,
                        options: [2, 3, 4, 5].map(v => ({ value: v, label: `+${v}`, selected: v === val }))
                     });
                }
            }

            if (activeCount < targetAmount) {
                const needed = targetAmount - activeCount;
                for (let i = 0; i < needed; i++) {
                    const tempId = `new_auto_${i}`;
                    
                    if (!this.overrides.experiences[tempId]) {
                        
                        let suggestedName = "New Experience";
                        if (this._suggestionCache[tempId]) {
                            suggestedName = this._suggestionCache[tempId];
                        } else {
                            suggestedName = this._getRandomExperienceName(typeKey, usedNames);
                            this._suggestionCache[tempId] = suggestedName;
                        }
                        usedNames.push(suggestedName);

                        sim.previewExperiences.push({
                            id: tempId, 
                            name: suggestedName,
                            value: targetMod,
                            isNew: true,
                            isSuggestion: true,
                            options: [2, 3, 4, 5].map(v => ({ value: v, label: `+${v}`, selected: v === targetMod }))
                        });
                    }
                }
            }
        }

        sim.difficulty = `<span class="range-hint">(${benchmark.difficulty})</span>`;
        sim.hp = `<span class="range-hint">(${benchmark.hp})</span>`;
        sim.stress = `<span class="range-hint">(${benchmark.stress})</span>`;
        sim.thresholds = `<span class="range-hint">(${benchmark.threshold_min} - ${benchmark.threshold_max})</span>`;
        sim.attackMod = `<span class="range-hint">(${benchmark.attack_modifier})</span>`;
        sim.tier = targetTier;

        const previewAttackMod = this.overrides.attackMod !== undefined ? Number(this.overrides.attackMod) : sim.attackModRaw;
        sim.hitChance = Manager.calculateHitChance(previewAttackMod, targetTier);

        const previewDifficulty = this.overrides.difficulty !== undefined ? Number(this.overrides.difficulty) : sim.difficultyRaw;
        sim.hitChanceAgainst = Manager.calculateHitChanceAgainst(previewDifficulty, targetTier);

        const damageParts = [];
        const halvedParts = []; 
        let mainDamageRaw = ""; 
        let mainHalvedDamageRaw = ""; 

        if (actorData.system.attack?.damage?.parts) {
            const tempParts = foundry.utils.deepClone(actorData.system.attack.damage.parts);
            tempParts.forEach((part, index) => {
                
                let rawVal = "";
                if (this.overrides.damageFormula) {
                    rawVal = this.overrides.damageFormula;
                    damageParts.push(`<span class="stat-changed">${this.overrides.damageFormula}</span>`);
                } else {
                    if (frozenBenchmark.basic_attack_y && part.value) {
                         const newVal = frozenBenchmark.basic_attack_y; 
                         rawVal = String(newVal);
                         damageParts.push(`<span class="stat-changed">${newVal}</span>`);
                    } else if (part.value) {
                        const result = Manager.processDamageValue(part.value, targetTier, currentTier, frozenBenchmark.damage_rolls);
                        if (result) {
                            rawVal = result.to;
                            damageParts.push(`<span class="stat-changed">${result.to}</span>`);
                        } else {
                             let existing = "";
                             if (part.value.custom?.enabled) existing = part.value.custom.formula;
                             else if (part.value.dice) existing = `${part.value.flatMultiplier||1}${part.value.dice}${part.value.bonus ? (part.value.bonus>0?'+'+part.value.bonus:part.value.bonus):''}`;
                             else existing = part.value.flatMultiplier;
                             rawVal = existing;
                             damageParts.push(existing);
                        }
                    }
                }
                
                if (index === 0) mainDamageRaw = rawVal;

                if (part.valueAlt && frozenBenchmark.halved_damage_x) {
                    let rawHalved = "";
                    if (this.overrides.halvedDamageFormula) {
                        rawHalved = this.overrides.halvedDamageFormula;
                        halvedParts.push(`<span class="stat-changed">${this.overrides.halvedDamageFormula}</span>`);
                    } else {
                        const result = Manager.processDamageValue(part.valueAlt, targetTier, currentTier, frozenBenchmark.halved_damage_x);
                        if (result) {
                            rawHalved = result.to;
                            halvedParts.push(`<span class="stat-changed">${result.to}</span>`);
                        } else {
                             let existing = "";
                             if (part.valueAlt.custom?.enabled) existing = part.valueAlt.custom.formula;
                             else if (part.valueAlt.dice) existing = `${part.valueAlt.flatMultiplier||1}${part.valueAlt.dice}${part.valueAlt.bonus ? (part.valueAlt.bonus?'+'+part.valueAlt.bonus:part.valueAlt.bonus):''}`;
                             else existing = part.valueAlt.flatMultiplier;
                             rawHalved = existing;
                             halvedParts.push(existing);
                        }
                    }
                    if (index === 0) mainHalvedDamageRaw = rawHalved;
                }
            });
        }
        sim.damage = damageParts.join(", ") || "None";
        sim.damageStats = this._calculateDamageStats(mainDamageRaw); 

        sim.mainDamageRaw = mainDamageRaw;
        
        sim.halvedDamage = halvedParts.join(", ") || null;
        sim.halvedDamageStats = this._calculateDamageStats(mainHalvedDamageRaw); 

        sim.mainHalvedDamageRaw = mainHalvedDamageRaw;

        const featureLog = [];
        const structuredFeatures = [];
        
        if (actorData.items) {
            for (const item of actorData.items) {
                const result = Manager.processFeatureUpdate(
                    item, 
                    targetTier, 
                    currentTier, 
                    frozenBenchmark, 
                    featureLog, 
                    this.overrides.features.names, 
                    this.overrides.features.damage
                );
                if (result && result.structured) {
                    structuredFeatures.push(...result.structured);
                }
            }
        }

        const allItems = actorData.items instanceof Array ? actorData.items : actorData.items.contents || [];
        for (const [itemId, overrideVal] of Object.entries(this.overrides.features.names)) {
            if (!structuredFeatures.find(f => f.itemId === itemId)) {
                const item = allItems.find(i => i._id === itemId);
                if (item) {
                     const isMinion = item.name.trim().match(/^Minion\s*\((\d+)\)$/i);
                     const type = isMinion ? "name_minion" : "name_override";
                     
                     structuredFeatures.push({
                        itemId: itemId,
                        itemName: item.name,
                        type: type,
                        from: item.name,
                        to: overrideVal
                     });
                }
            }
        }
        
        return { 
            stats: sim, 
            features: featureLog, 
            structuredFeatures: structuredFeatures,
            suggestedFeatures: [] 
        };
    }
}