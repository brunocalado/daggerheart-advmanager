import { Manager } from "./manager.js";
import { ADVERSARY_BENCHMARKS } from "./rules.js";
import { MODULE_ID, SETTING_IMPORT_FOLDER, SETTING_EXTRA_COMPENDIUMS, SETTING_LAST_SOURCE, SETTING_LAST_FILTER_TIER, SETTING_SUGGEST_FEATURES, SKULL_IMAGE_PATH } from "./module.js";
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
        
        // Store overrides separated by type
        this.overrides = { 
            features: {
                names: {},
                damage: {}
            },
            suggestedFeatures: null, 
            suggestedFeaturesType: "default", 
            experiences: {}, // Map of ID -> { name: string, value: number, deleted: boolean }
            damageFormula: undefined,
            halvedDamageFormula: undefined,
            difficulty: undefined,
            hp: undefined,
            stress: undefined,
            major: undefined,
            severe: undefined,
            attackMod: undefined,
            expAmount: undefined,
            expMod: undefined
        };

        // Initialize Settings
        if (this.initialActor) {
            // FORCE overrides for the provided actor so it's not filtered out
            this.filterTier = String(Number(this.initialActor.system.tier) || 1);
            this.filterType = (this.initialActor.system.type || "standard").toLowerCase();
            this.source = "world"; // Token actors are effectively world/scene context
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
            resetDamageBonus: LiveManager.prototype._onResetDamageBonus
            // Removed changeSuggestedType from here to handle manually via 'change' event
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
     * Searches in: 
     * 1. daggerheart-advmanager.all-features (Priority)
     * 2. daggerheart-advmanager.features
     * 3. daggerheart.adversary-features
     */
    async _findFeatureItem(name) {
        if (this._featureCache.has(name)) return this._featureCache.get(name);

        const packIds = ["daggerheart-advmanager.all-features", "daggerheart-advmanager.features", "daggerheart.adversary-features"];
        
        // Prepare clean name (e.g., "Relentless (2)" or "Relentless (X)" becomes "Relentless")
        let cleanName = name;
        const match = name.match(/^(.*?)\s*\([^)]+\)$/);
        if (match) cleanName = match[1];

        for (const packId of packIds) {
            const pack = game.packs.get(packId);
            if (!pack) continue;
            
            // Optimization: Load index only if not loaded or just check efficiently
            const index = await pack.getIndex({ fields: ["system.featureForm"] }); // Request featureForm field
            
            // Try exact match first
            let entry = index.find(i => i.name === name);
            
            // If not found and name was cleaned, try cleaned name (e.g. Relentless)
            if (!entry && cleanName !== name) {
                entry = index.find(i => i.name === cleanName);
            }

            if (entry) {
                const type = entry.system?.featureForm || "";
                const data = { img: entry.img, uuid: entry.uuid, type: type };
                this._featureCache.set(name, data);
                return data;
            }
        }

        // Return default if not found
        const defaultData = { img: "icons/svg/item-bag.svg", uuid: null, type: "" };
        this._featureCache.set(name, defaultData);
        return defaultData;
    }

    /**
     * Helper to convert featureForm value to label (A), (R), or (P).
     */
    _getFeatureTypeLabel(type) {
        if (!type) return "";
        const t = type.toLowerCase();
        if (t === "action") return "(A)";
        if (t === "reaction") return "(R)";
        if (t === "passive") return "(P)";
        return "";
    }

    /**
     * Update the Live Manager to show a specific actor.
     * Designed to be called by external hooks (like controlToken).
     */
    async updateSelectedActor(actor) {
        if (!actor) return;
        this.source = "world";
        this.initialActor = actor; // Update initial reference
        this.selectedActorId = actor.id;
        this.targetTier = Number(actor.system.tier) || 1;
        
        // Reset overrides to avoid confusion
        this.overrides = { features: { names: {}, damage: {} }, suggestedFeatures: null, experiences: {}, suggestedFeaturesType: "default" }; 
        
        // Sync filter settings to match this new actor so they don't look weird
        this.filterTier = String(this.targetTier); 
        this.filterType = (actor.system.type || "standard").toLowerCase();

        this.render();
    }

    /**
     * Prepare data for the Handlebars template
     */
    async _prepareContext(_options) {
        let rawAdversaries = [];

        // --- Determine Source List ---
        const sourceOptions = [
            { value: "all", label: "All Sources", selected: this.source === "all" }, // Optional fallback
            { value: "world", label: "World", selected: this.source === "world" },
            { value: "daggerheart.adversaries", label: "System Compendium", selected: this.source === "daggerheart.adversaries" }
        ];

        const extraCompendiums = game.settings.get(MODULE_ID, SETTING_EXTRA_COMPENDIUMS) || [];
        let currentSourceIsValid = (this.source === "world" || this.source === "daggerheart.adversaries");

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
            
            // If we have an initial actor selected (from token selection), ensure it's in the list
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

        let allAdversaries = rawAdversaries.map(a => ({
            ...a,
            selected: a.id === this.selectedActorId
        }));

        // --- Filters ---
        let displayedAdversaries = allAdversaries;
        
        if (this.filterTier !== "all") {
            displayedAdversaries = displayedAdversaries.filter(a => a.tier === Number(this.filterTier));
        }

        if (this.filterType !== "all") {
            displayedAdversaries = displayedAdversaries.filter(a => a.advType === this.filterType);
        }

        // --- Auto-Select logic if current selection is invalid ---
        if (!this.selectedActorId && displayedAdversaries.length > 0) {
             this.selectedActorId = displayedAdversaries[0].id;
        } else if (this.selectedActorId && !displayedAdversaries.find(a => a.id === this.selectedActorId)) {
             if (displayedAdversaries.length > 0) this.selectedActorId = displayedAdversaries[0].id;
             else this.selectedActorId = null;
        }

        // Map for Template
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

        if (this.selectedActorId) {
            actor = await this._getActor(this.selectedActorId);
            
            if (actor) {
                const currentTier = Number(actor.system.tier) || 1;
                const isLinked = actor.isToken ? actor.token?.actorLink : actor.prototypeToken?.actorLink;
                const typeKey = (actor.system.type || "standard").toLowerCase();
                isMinion = typeKey === "minion";
                isHorde = typeKey === "horde"; 
                actorTypeLabel = typeKey.charAt(0).toUpperCase() + typeKey.slice(1); 
                
                // --- Portrait Logic ---
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
                // ---------------------

                linkData = {
                    isLinked: isLinked,
                    icon: isLinked ? "fa-link" : "fa-unlink",
                    cssClass: isLinked ? "status-linked" : "status-unlinked",
                    label: isLinked ? "Linked" : "Unlinked"
                };

                if (this.source !== "world") linkData = null;

                currentStats = this._extractStats(actor.toObject(), currentTier);
                
                const simResult = await this._simulateStats(actor, this.targetTier, currentTier);
                
                const benchmark = ADVERSARY_BENCHMARKS[typeKey]?.tiers[`tier_${this.targetTier}`];
                
                // Determine Damage Options
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
                
                // Build Tooltips
                if (damageOptions.length > 0) {
                    damageTooltip = "Suggested:<br>" + damageOptions.map(o => `• ${o.label}`).join("<br>");
                }
                
                if (halvedDamageOptions.length > 0) {
                    halvedDamageTooltip = "Suggested:<br>" + halvedDamageOptions.map(o => `• ${o.label}`).join("<br>");
                }

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
                    
                    // Experience Preview List
                    experiences: simResult.stats.previewExperiences || [],
                    expTooltip: `Suggested:<br>Amount: ${simResult.stats.expAmountRange || "?"}<br>Modifier: ${simResult.stats.expModRange || "?"}`,
                    
                    damage: simResult.stats.damage,
                    damageStats: simResult.stats.damageStats, 

                    mainDamageFormula: simResult.stats.mainDamageRaw, // Raw value for input
                    
                    halvedDamage: simResult.stats.halvedDamage, 
                    halvedDamageStats: simResult.stats.halvedDamageStats, 
                    
                    mainHalvedDamageFormula: simResult.stats.mainHalvedDamageRaw, // Raw value for input
                    
                    tier: this.targetTier,
                    isMinion: isMinion,
                    hitChance: simResult.stats.hitChance, // Adversary hits PC
                    hitChanceAgainst: simResult.stats.hitChanceAgainst // PC hits Adversary
                };

                if (isMinion) {
                    previewStats.thresholdsDisplay = "None"; 
                    previewStats.hpDisplay = "(Fixed)"; 
                }
                
                // --- PROCESS SUGGESTED FEATURES FOR UI ---
                const rawSuggested = simResult.suggestedFeatures;
                
                // Enrich with Image and UUID
                allSuggestedFeatures = [];
                for (const feat of rawSuggested) {
                    const itemData = await this._findFeatureItem(feat.name);
                    const typeLabel = this._getFeatureTypeLabel(itemData.type);
                    allSuggestedFeatures.push({
                        name: feat.name,
                        checked: feat.checked,
                        img: itemData.img,
                        uuid: itemData.uuid,
                        typeLabel: typeLabel
                    });
                }

                // Prepare Structured Feature Data
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

                    if (f.type === 'damage' || f.type === 'name_horde') {
                         const currentVal = overrideVal !== undefined ? overrideVal : f.to;
                         featureOptions = damageOptions.map(d => ({
                             value: d.value,
                             label: d.label,
                             selected: d.value === currentVal
                         }));
                         
                         if (featureOptions.length > 0) {
                             optionsTooltip = "Suggested:<br>" + featureOptions.map(o => `• ${o.label}`).join("<br>");
                         }

                         // Calculate Stats for the current value in preview
                         damageStats = this._calculateDamageStats(currentVal);
                    }

                    const isMinionFeature = f.type === 'name_minion';
                    let minionValue = "";
                    if (isMinionFeature) {
                        const targetStr = overrideVal !== undefined ? overrideVal : f.to;
                        const match = targetStr.toString().match(/\((\d+)\)/);
                        if (match) minionValue = match[1];
                    }

                    // Find Item Icon/UUID/Type
                    const itemData = await this._findFeatureItem(f.itemName);
                    const typeLabel = this._getFeatureTypeLabel(itemData.type);

                    return {
                        itemId: f.itemId,
                        originalName: displayFrom,
                        newName: overrideVal !== undefined ? overrideVal : f.to,
                        isRenamed: f.type.startsWith("name_") && f.type !== 'name_horde' && f.type !== 'name_minion', 
                        options: featureOptions, 
                        optionsTooltip: optionsTooltip,
                        isMinionFeature: isMinionFeature,
                        minionValue: minionValue,
                        img: itemData.img,
                        uuid: itemData.uuid,
                        stats: damageStats, // Stats string
                        typeLabel: typeLabel // NEW: (A), (R), (P)
                    };
                }));

                // --- BUILD SUGGESTED FEATURES TYPE OPTIONS ---
                suggestedFeaturesTypeOptions = [
                    { value: "default", label: "Default (Current Type)", selected: this.overrides.suggestedFeaturesType === "default" }
                ];
                
                // Add all keys from BENCHMARKS
                const typeKeys = Object.keys(ADVERSARY_BENCHMARKS).sort();
                typeKeys.forEach(k => {
                    suggestedFeaturesTypeOptions.push({
                        value: k,
                        label: k.charAt(0).toUpperCase() + k.slice(1),
                        selected: this.overrides.suggestedFeaturesType === k
                    });
                });
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
            suggestedFeaturesTypeOptions // Pass to template
        };
    }

    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;

        // --- Manual Listeners for Top Controls ---
        const sourceSelect = html.querySelector('.source-select');
        if (sourceSelect) sourceSelect.addEventListener('change', (e) => this._onSelectSource(e, sourceSelect));

        const filterSelect = html.querySelector('.filter-tier-select');
        if (filterSelect) filterSelect.addEventListener('change', (e) => this._onFilterTier(e, filterSelect));

        const typeSelect = html.querySelector('.filter-type-select');
        if (typeSelect) typeSelect.addEventListener('change', (e) => this._onFilterType(e, typeSelect));

        const actorSelect = html.querySelector('.main-actor-select');
        if (actorSelect) actorSelect.addEventListener('change', (e) => this._onSelectActor(e, actorSelect));

        // --- Overrides ---
        html.querySelectorAll('.override-input').forEach(input => {
            input.addEventListener('change', (e) => this._onOverrideChange(e, input));
        });

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
        
        // --- Experience Handlers ---
        html.querySelectorAll('.exp-name-input').forEach(input => {
            input.addEventListener('change', (e) => this._onExpNameChange(e, input));
        });
        html.querySelectorAll('.exp-mod-select').forEach(input => {
            input.addEventListener('change', (e) => this._onExpModChange(e, input));
        });

        // --- Suggestion Type Handler (Manual Listener instead of Action to avoid re-render race condition) ---
        const suggestionTypeSelect = html.querySelector('.suggestion-type-select');
        if (suggestionTypeSelect) {
            suggestionTypeSelect.addEventListener('change', (e) => this._onChangeSuggestedType(e, suggestionTypeSelect));
        }
    }

    // --- Action Handlers ---

    _onChangeSuggestedType(event, target) {
        event.preventDefault();
        this.overrides.suggestedFeaturesType = target.value;
        // Reset previously selected features because they might belong to another type
        this.overrides.suggestedFeatures = null; 
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
        this.overrides.experiences[newId].name = "New Experience";
        this.overrides.experiences[newId].value = 2; // Default starting value
        this.render();
    }

    _onResetDamageBonus(event, target) {
        const input = target.previousElementSibling; 
        if (!input || !input.classList.contains('feature-damage-input')) return;
        
        let value = input.value;
        // Strip trailing bonus (e.g., +5, -2) from the end
        // Regex looks for optional space, + or -, optional space, digits, end of string
        value = value.replace(/\s*[+-]\s*\d+$/, "");
        
        // Update input visually
        input.value = value;
        
        // Trigger update
        const itemId = input.dataset.itemid;
        if (itemId) {
             if (!this.overrides.features) this.overrides.features = { names: {}, damage: {} };
             if (!this.overrides.features.damage) this.overrides.features.damage = {};
             this.overrides.features.damage[itemId] = value;
             this.render();
        }
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
            this.overrides.features.damage[itemId] = value;
            delete this.overrides.features.names[itemId];
        } else {
            this.overrides.features.names[itemId] = value;
        }
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
            // Fixed damage (e.g., "5")
            // parseDamageString returns { count: 5, die: null, bonus: 0 } if regex matches number
            let val = parsed.count;
            min = val;
            max = val;
            mean = val;
        } else {
            // Dice damage (e.g., "1d8+2")
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
        
        if (sys.attack?.damage?.parts) {
            sys.attack.damage.parts.forEach((p, idx) => {
                if(p.value) {
                    let formula = p.value.custom?.enabled ? p.value.custom.formula : 
                        (p.value.dice ? `${p.value.flatMultiplier || 1}${p.value.dice}${p.value.bonus ? (p.value.bonus > 0 ? '+'+p.value.bonus : p.value.bonus) : ''}` : p.value.flatMultiplier);
                    damageParts.push(formula);
                    if (idx === 0) firstDamageFormula = formula;
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

        return {
            tier,
            difficulty: sys.difficulty,
            hp: sys.resources?.hitPoints?.max,
            stress: sys.resources?.stress?.max,
            thresholds: `${sys.damageThresholds?.major} / ${sys.damageThresholds?.severe}`,
            attackMod: sys.attack?.roll?.bonus,
            damage: damageParts.join(", ") || "None",
            damageStats: this._calculateDamageStats(firstDamageFormula), // Stats for current
            halvedDamage: halvedParts.join(", ") || null,
            halvedDamageStats: this._calculateDamageStats(firstHalvedFormula), // Stats for current
            hitChance: hitChance,
            hitChanceAgainst: hitChanceAgainst,
            experiences: expList
        };
    }

    async _simulateStats(actor, targetTier, currentTier) {
        const actorData = actor.toObject();
        const typeKey = (actorData.system.type || "standard").toLowerCase();
        
        // Decide which type to use for FEATURE SUGGESTIONS based on overrides
        let suggestionTypeKey = typeKey;
        if (this.overrides.suggestedFeaturesType && this.overrides.suggestedFeaturesType !== "default") {
            suggestionTypeKey = this.overrides.suggestedFeaturesType;
        }

        if (!ADVERSARY_BENCHMARKS[typeKey]) return { stats: { error: "Unknown Type" }, features: [], structuredFeatures: [] };
        
        // Benchmark for Stats (always based on actual actor type)
        const benchmark = ADVERSARY_BENCHMARKS[typeKey].tiers[`tier_${targetTier}`];
        // Benchmark for Suggestions (can be overriden)
        const suggestionBenchmarkRoot = ADVERSARY_BENCHMARKS[suggestionTypeKey];
        const suggestionBenchmark = suggestionBenchmarkRoot ? suggestionBenchmarkRoot.tiers[`tier_${targetTier}`] : benchmark;

        if (!benchmark) return { stats: { error: "Benchmark missing" }, features: [], structuredFeatures: [] };

        const sim = {};
        sim.difficultyRaw = Manager.getRollFromRange(benchmark.difficulty);
        sim.hpRaw = Manager.getRollFromRange(benchmark.hp);
        sim.stressRaw = Manager.getRollFromRange(benchmark.stress);
        sim.attackModRaw = Manager.getRollFromSignedRange(benchmark.attack_modifier);
        
        if (benchmark.threshold_min && benchmark.threshold_max) {
            const minPair = Manager.parseThresholdPair(benchmark.threshold_min);
            const maxPair = Manager.parseThresholdPair(benchmark.threshold_max);
            if (minPair && maxPair) {
                sim.majorRaw = Math.floor(Math.random() * (maxPair.major - minPair.major + 1)) + minPair.major;
                sim.severeRaw = Math.floor(Math.random() * (maxPair.severe - minPair.severe + 1)) + minPair.severe;
            }
        }

        // --- Experience Simulation ---
        sim.previewExperiences = [];
        if (benchmark.experiences) {
            // Base Target Mod for this Tier
            const autoMod = Manager.getRollFromSignedRange(benchmark.experiences.modifier);
            
            // Capture suggested ranges for tooltip
            sim.expAmountRange = benchmark.experiences.amount;
            sim.expModRange = benchmark.experiences.modifier;

            // Current Experiences
            const currentExpMap = actorData.system.experiences || {};
            
            // Build the preview list
            // 1. Existing experiences (respect deletions and updates)
            for (const [key, exp] of Object.entries(currentExpMap)) {
                const override = this.overrides.experiences[key];
                
                // Skip if deleted
                if (override && override.deleted) continue;
                
                let finalVal = autoMod; // Default to scaling to new tier logic
                let finalName = exp.name;
                
                // If override exists, take precedence
                if (override) {
                    if (override.value !== undefined) finalVal = override.value;
                    if (override.name !== undefined) finalName = override.name;
                }

                sim.previewExperiences.push({
                    id: key,
                    name: finalName,
                    value: finalVal,
                    options: [2, 3, 4, 5].map(v => ({ value: v, label: `+${v}`, selected: v === finalVal }))
                });
            }

            // 2. New Additions from Overrides
            for (const [key, data] of Object.entries(this.overrides.experiences)) {
                // If key is not in currentMap, it is new
                if (!currentExpMap[key] && !data.deleted) {
                     const val = data.value !== undefined ? data.value : autoMod;
                     sim.previewExperiences.push({
                        id: key,
                        name: data.name || "New Experience",
                        value: val,
                        isNew: true,
                        options: [2, 3, 4, 5].map(v => ({ value: v, label: `+${v}`, selected: v === val }))
                     });
                }
            }
        }

        // Display strings
        sim.difficulty = `<span class="range-hint">(${benchmark.difficulty})</span>`;
        sim.hp = `<span class="range-hint">(${benchmark.hp})</span>`;
        sim.stress = `<span class="range-hint">(${benchmark.stress})</span>`;
        sim.thresholds = `<span class="range-hint">(${benchmark.threshold_min} - ${benchmark.threshold_max})</span>`;
        sim.attackMod = `<span class="range-hint">(${benchmark.attack_modifier})</span>`;
        sim.tier = targetTier;

        // --- Calculate Hit Chances for PREVIEW Stats ---
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
                
                // --- MAIN ATTACK DAMAGE ---
                let rawVal = "";
                if (this.overrides.damageFormula) {
                    rawVal = this.overrides.damageFormula;
                    damageParts.push(`<span class="stat-changed">${this.overrides.damageFormula}</span>`);
                } else {
                    if (benchmark.basic_attack_y && part.value) {
                         const newVal = Manager.getRollFromRange(benchmark.basic_attack_y);
                         rawVal = String(newVal);
                         damageParts.push(`<span class="stat-changed">${newVal}</span>`);
                    } else if (part.value) {
                        const result = Manager.processDamageValue(part.value, targetTier, currentTier, benchmark.damage_rolls);
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

                // --- HALVED DAMAGE (HORDE) ---
                if (part.valueAlt && benchmark.halved_damage_x) {
                    let rawHalved = "";
                    if (this.overrides.halvedDamageFormula) {
                        rawHalved = this.overrides.halvedDamageFormula;
                        halvedParts.push(`<span class="stat-changed">${this.overrides.halvedDamageFormula}</span>`);
                    } else {
                        const result = Manager.processDamageValue(part.valueAlt, targetTier, currentTier, benchmark.halved_damage_x);
                        if (result) {
                            rawHalved = result.to;
                            halvedParts.push(`<span class="stat-changed">${result.to}</span>`);
                        } else {
                             let existing = "";
                             if (part.valueAlt.custom?.enabled) existing = part.valueAlt.custom.formula;
                             else if (part.valueAlt.dice) existing = `${part.valueAlt.flatMultiplier||1}${part.valueAlt.dice}${part.valueAlt.bonus ? (part.valueAlt.bonus>0?'+'+part.valueAlt.bonus:part.valueAlt.bonus):''}`;
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
        sim.damageStats = this._calculateDamageStats(mainDamageRaw); // Stats for Preview

        sim.mainDamageRaw = mainDamageRaw;
        
        sim.halvedDamage = halvedParts.join(", ") || null;
        sim.halvedDamageStats = this._calculateDamageStats(mainHalvedDamageRaw); // Stats for Preview

        sim.mainHalvedDamageRaw = mainHalvedDamageRaw;

        const featureLog = [];
        const structuredFeatures = [];
        
        if (actorData.items) {
            for (const item of actorData.items) {
                const result = Manager.processFeatureUpdate(
                    item, 
                    targetTier, 
                    currentTier, 
                    benchmark, 
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
        
        // --- SUGGESTED FEATURES LOGIC ---
        // 1. Get ALL possible features for this Tier (from Suggestion Benchmark)
        let possibleFeatures = [];
        if (suggestionBenchmark && suggestionBenchmark.suggested_features) {
            if (Array.isArray(suggestionBenchmark.suggested_features)) {
                possibleFeatures = [...suggestionBenchmark.suggested_features];
            } else if (typeof suggestionBenchmark.suggested_features === "string" && suggestionBenchmark.suggested_features !== "") {
                possibleFeatures = [suggestionBenchmark.suggested_features];
            }
        }
        
        // --- FEATURE FLAG CHECK ---
        const enableSuggestions = game.settings.get(MODULE_ID, SETTING_SUGGEST_FEATURES);
        if (!enableSuggestions) {
            possibleFeatures = []; // FORCE EMPTY LIST TO HIDE SUGGESTIONS
        }

        // 2. Filter out already owned features to avoid duplicates
        const validCandidates = possibleFeatures.filter(name => !allItems.some(i => i.name === name));

        // 3. Initialize default selection if null (random pick)
        if (this.overrides.suggestedFeatures === null) {
            this.overrides.suggestedFeatures = [];
            if (validCandidates.length > 0) {
                 // Pick one random one to start
                 const picked = validCandidates[Math.floor(Math.random() * validCandidates.length)];
                 this.overrides.suggestedFeatures.push(picked);
            }
        }

        // 4. Map to UI Objects with checked state
        const suggestedFeatures = validCandidates.map(name => ({
            name: name,
            checked: this.overrides.suggestedFeatures.includes(name)
        }));

        return { 
            stats: sim, 
            features: featureLog, 
            structuredFeatures: structuredFeatures,
            suggestedFeatures: suggestedFeatures // Return the UI list
        };
    }

    // --- Actions ---

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
        this.overrides = { features: { names: {}, damage: {} }, suggestedFeatures: null, experiences: {} }; 
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
        this.overrides = { features: { names: {}, damage: {} }, suggestedFeatures: null, experiences: {} }; 
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
            this.overrides = { features: { names: {}, damage: {} }, suggestedFeatures: null, experiences: {} }; 
            this.render();
        }
    }

    async _onApplyChanges(event, target) {
        if (!this.selectedActorId) return;
        
        let actor = await this._getActor(this.selectedActorId);
        if (!actor) return;

        try {
            if (this.source !== "world") {
                const folderName = game.settings.get(MODULE_ID, SETTING_IMPORT_FOLDER) || "Imported Adversaries";
                let folder = game.folders.find(f => f.name === folderName && f.type === "Actor");
                if (!folder) {
                    folder = await Folder.create({ name: folderName, type: "Actor", color: "#430047" });
                }

                const pack = game.packs.get(this.source);
                actor = await game.actors.importFromCompendium(pack, this.selectedActorId, { folder: folder.id });
                
                if (actor) {
                    this.source = "world";
                    this.selectedActorId = actor.id;
                    await game.settings.set(MODULE_ID, SETTING_LAST_SOURCE, "world");
                }
            }

            const result = await Manager.updateSingleActor(actor, this.targetTier, this.overrides);
            
            if (!result) {
                ui.notifications.warn("No changes were necessary.");
            }

            this.filterTier = String(this.targetTier); 
            await game.settings.set(MODULE_ID, SETTING_LAST_FILTER_TIER, this.filterTier);

            const typeKey = (actor.system.type || "standard").toLowerCase();
            this.filterType = typeKey; 

            this.overrides = { features: { names: {}, damage: {} }, suggestedFeatures: null, experiences: {} };

            this.render();

        } catch (e) {
            console.error(e);
            ui.notifications.error("Error applying changes. Check console.");
        }
    }
}