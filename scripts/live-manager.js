import { Manager } from "./manager.js";
import { ADVERSARY_BENCHMARKS } from "./rules.js";
import { MODULE_ID, SETTING_IMPORT_FOLDER, SETTING_EXTRA_COMPENDIUMS, SETTING_LAST_SOURCE, SETTING_LAST_FILTER_TIER, SKULL_IMAGE_PATH } from "./module.js";
import { CompendiumManager } from "./compendium-manager.js";

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
            }
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
    }

    static DEFAULT_OPTIONS = {
        id: "daggerheart-live-preview",
        tag: "form",
        window: {
            title: "Adversary Live Manager",
            icon: "fas fa-eye",
            resizable: true,
            width: 1000,
            height: 750
        },
        position: { width: 1000, height: 750 },
        actions: {
            selectTier: LiveManager.prototype._onSelectTier,
            applyChanges: LiveManager.prototype._onApplyChanges,
            openSettings: LiveManager.prototype._onOpenSettings
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
        this.overrides = { features: { names: {}, damage: {} } }; 
        
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
            if (this.initialActor && !game.actors.has(this.initialActor.id)) {
                if (!rawAdversaries.find(a => a.id === this.initialActor.id)) {
                    rawAdversaries.push({
                        id: this.initialActor.id,
                        name: `${this.initialActor.name} (Token)`,
                        tier: Number(this.initialActor.system.tier) || 1,
                        advType: (this.initialActor.system.type || "standard").toLowerCase()
                    });
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
        let newFeaturesPreview = [];
        let linkData = null;
        let damageOptions = []; 
        let isMinion = false;
        let portraitImg = null;

        if (this.selectedActorId) {
            actor = await this._getActor(this.selectedActorId);
            
            if (actor) {
                const currentTier = Number(actor.system.tier) || 1;
                const isLinked = actor.isToken ? actor.token?.actorLink : actor.prototypeToken?.actorLink;
                const typeKey = (actor.system.type || "standard").toLowerCase();
                isMinion = typeKey === "minion";
                
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
                    
                    damage: simResult.stats.damage, 
                    halvedDamage: simResult.stats.halvedDamage, // NEW: Pass halved damage to preview
                    tier: this.targetTier,
                    isMinion: isMinion
                };

                if (isMinion) {
                    previewStats.thresholdsDisplay = "None"; 
                    previewStats.hpDisplay = "(Fixed)"; 
                }
                
                // Get New Features List
                if (simResult.newFeaturesList && simResult.newFeaturesList.length > 0) {
                    newFeaturesPreview = simResult.newFeaturesList.map(item => ({
                        name: item.name,
                        img: item.img
                    }));
                }

                // Prepare Structured Feature Data
                featurePreviewData = simResult.structuredFeatures.map(f => {
                    // Check override based on type
                    let overrideVal = undefined;
                    
                    if (f.type === 'damage' || f.type === 'name_horde') {
                         overrideVal = this.overrides.features.damage[f.itemId];
                    } else {
                         overrideVal = this.overrides.features.names[f.itemId];
                    }
                    
                    let displayFrom = f.from;
                    
                    // Display Feature Name + Old Damage (Same Style)
                    if (f.type === 'damage') {
                        // Use consistent bold style for name, lighter for old value
                        displayFrom = `<strong>${f.itemName}</strong> <span class="old-value-sub">(${f.from})</span>`;
                    } else if (f.type === 'name_horde') {
                        // Horde usually has name=damage, handle display gracefully
                        displayFrom = `<strong>${f.from}</strong>`;
                    } else {
                        displayFrom = `<strong>${f.from}</strong>`;
                    }

                    // Determine if we should show a dropdown (for Damage or Horde types)
                    let featureOptions = null;
                    if (f.type === 'damage' || f.type === 'name_horde') {
                         const currentVal = overrideVal !== undefined ? overrideVal : f.to;
                         
                         // Create options from benchmark damage_rolls OR basic_attack_y options
                         featureOptions = damageOptions.map(d => ({
                             value: d.value,
                             label: d.label,
                             selected: d.value === currentVal
                         }));

                         // Ensure current value is present if it's custom or outside standard range
                         if (!featureOptions.find(o => o.value === currentVal)) {
                             featureOptions.unshift({ value: currentVal, label: currentVal, selected: true });
                         }
                    }

                    // MINION LOGIC
                    const isMinionFeature = f.type === 'name_minion';
                    let minionValue = "";
                    if (isMinionFeature) {
                        const targetStr = overrideVal !== undefined ? overrideVal : f.to;
                        const match = targetStr.toString().match(/\((\d+)\)/);
                        if (match) minionValue = match[1];
                    }

                    return {
                        itemId: f.itemId,
                        originalName: displayFrom,
                        newName: overrideVal !== undefined ? overrideVal : f.to,
                        // UPDATED: Minion names are now treated as static text for rename check
                        isRenamed: f.type.startsWith("name_") && f.type !== 'name_horde' && f.type !== 'name_minion', 
                        options: featureOptions,
                        isMinionFeature: isMinionFeature,
                        minionValue: minionValue
                    };
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
            newFeaturesPreview,
            tiers,
            linkData,
            sourceOptions,
            filterOptions,
            typeOptions,
            damageOptions,
            actorName: actor?.name || "None",
            portraitImg: portraitImg // Passed to template
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

        // Bind Override Inputs
        html.querySelectorAll('.override-input').forEach(input => {
            input.addEventListener('change', (e) => this._onOverrideChange(e, input));
        });

        // Bind Feature Override Inputs AND Selects
        html.querySelectorAll('.feature-override-input, .feature-override-select').forEach(input => {
            input.addEventListener('change', (e) => this._onFeatureOverrideChange(e, input));
        });

        // Bind Minion Value Input
        html.querySelectorAll('.minion-val-input').forEach(input => {
            input.addEventListener('change', (e) => this._onMinionOverrideChange(e, input));
            input.addEventListener('click', (e) => e.stopPropagation());
        });

        // Bind Damage Preset Select
        const damagePreset = html.querySelector('.damage-preset-select');
        if (damagePreset) {
            damagePreset.addEventListener('change', (e) => this._onOverrideChange(e, damagePreset));
        }
    }

    _onOverrideChange(event, target) {
        const field = target.dataset.field;
        const value = target.value;
        this.overrides[field] = value;
    }

    _onFeatureOverrideChange(event, target) {
        const itemId = target.dataset.itemid;
        const value = target.value;
        const isDamage = target.classList.contains('feature-override-select');
        
        // Ensure structure exists
        if (!this.overrides.features) this.overrides.features = { names: {}, damage: {} };
        if (!this.overrides.features.names) this.overrides.features.names = {};
        if (!this.overrides.features.damage) this.overrides.features.damage = {};

        if (isDamage) {
            this.overrides.features.damage[itemId] = value;
            // Clear any potential name override if we switched to damage mode
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
            // Reconstruct the full name which Manager.js expects
            this.overrides.features.names[itemId] = `Minion (${val})`;
        } else {
            delete this.overrides.features.names[itemId];
        }
        // Force refresh to update descriptions if needed
        this.render();
    }

    // --- Stats Helpers (Standard) ---
    _extractStats(actorData, tier) {
        const sys = actorData.system;
        const damageParts = [];
        const halvedParts = []; // NEW: Extract halved damage for Horde
        
        if (sys.attack?.damage?.parts) {
            sys.attack.damage.parts.forEach(p => {
                if(p.value) {
                    let formula = p.value.custom?.enabled ? p.value.custom.formula : 
                        (p.value.dice ? `${p.value.flatMultiplier || 1}${p.value.dice}${p.value.bonus ? (p.value.bonus > 0 ? '+'+p.value.bonus : p.value.bonus) : ''}` : p.value.flatMultiplier);
                    damageParts.push(formula);
                }
                // NEW: Handle Secondary/Alt Damage (used by Horde)
                if (p.valueAlt) {
                    let formula = p.valueAlt.custom?.enabled ? p.valueAlt.custom.formula : 
                        (p.valueAlt.dice ? `${p.valueAlt.flatMultiplier || 1}${p.valueAlt.dice}${p.valueAlt.bonus ? (p.valueAlt.bonus > 0 ? '+'+p.valueAlt.bonus : p.valueAlt.bonus) : ''}` : p.valueAlt.flatMultiplier);
                    halvedParts.push(formula);
                }
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
            halvedDamage: halvedParts.join(", ") || null // NEW: Return extracted halved damage
        };
    }

    async _simulateStats(actor, targetTier, currentTier) {
        const actorData = actor.toObject();
        const typeKey = (actorData.system.type || "standard").toLowerCase();
        
        if (!ADVERSARY_BENCHMARKS[typeKey]) return { stats: { error: "Unknown Type" }, features: [], structuredFeatures: [] };
        const benchmark = ADVERSARY_BENCHMARKS[typeKey].tiers[`tier_${targetTier}`];
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

        // Display strings
        sim.difficulty = `<span class="range-hint">(${benchmark.difficulty})</span>`;
        sim.hp = `<span class="range-hint">(${benchmark.hp})</span>`;
        sim.stress = `<span class="range-hint">(${benchmark.stress})</span>`;
        sim.thresholds = `<span class="range-hint">(${benchmark.threshold_min} - ${benchmark.threshold_max})</span>`;
        sim.attackMod = `<span class="range-hint">(${benchmark.attack_modifier})</span>`;
        sim.tier = targetTier;

        const damageParts = [];
        const halvedParts = []; // NEW: Array for simulated halved damage

        if (actorData.system.attack?.damage?.parts) {
            const tempParts = foundry.utils.deepClone(actorData.system.attack.damage.parts);
            tempParts.forEach(part => {
                // Check if minion style damage override
                if (benchmark.basic_attack_y && part.value) {
                     // We simulate the change here just for display
                     const newVal = Manager.getRollFromRange(benchmark.basic_attack_y);
                     damageParts.push(`<span class="stat-changed">${newVal}</span>`);
                } else if (part.value) {
                    const result = Manager.processDamageValue(part.value, targetTier, currentTier, benchmark.damage_rolls);
                    if (result) {
                        damageParts.push(`<span class="stat-changed">${result.to}</span>`);
                    } else {
                        let existing = "";
                         if (part.value.custom?.enabled) existing = part.value.custom.formula;
                         else if (part.value.dice) existing = `${part.value.flatMultiplier||1}${part.value.dice}${part.value.bonus ? (part.value.bonus>0?'+'+part.value.bonus:part.value.bonus):''}`;
                         else existing = part.value.flatMultiplier;
                         damageParts.push(existing);
                    }
                }

                // NEW: Handle Halved Damage Logic for Horde
                if (part.valueAlt && benchmark.halved_damage_x) {
                    const result = Manager.processDamageValue(part.valueAlt, targetTier, currentTier, benchmark.halved_damage_x);
                    if (result) {
                        halvedParts.push(`<span class="stat-changed">${result.to}</span>`);
                    } else {
                         // Fallback display existing
                         let existing = "";
                         if (part.valueAlt.custom?.enabled) existing = part.valueAlt.custom.formula;
                         else if (part.valueAlt.dice) existing = `${part.valueAlt.flatMultiplier||1}${part.valueAlt.dice}${part.valueAlt.bonus ? (part.valueAlt.bonus>0?'+'+part.valueAlt.bonus:part.valueAlt.bonus):''}`;
                         else existing = part.valueAlt.flatMultiplier;
                         halvedParts.push(existing);
                    }
                }
            });
        }
        sim.damage = damageParts.join(", ") || "None";
        sim.halvedDamage = halvedParts.join(", ") || null; // NEW: Set halved damage string

        const featureLog = [];
        const structuredFeatures = []; // This will be populated by processFeatureUpdate
        
        // Run Feature Update Logic (Simulation)
        if (actorData.items) {
            for (const item of actorData.items) {
                // Pass the specific override maps
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

        // --- FIX: Ensure Overridden Items Persist in UI ---
        // If an override makes the new value equal to the original value, Manager.processFeatureUpdate
        // returns null (no changes). We must manually inject these back into structuredFeatures so the UI row stays visible.
        const allItems = actorData.items instanceof Array ? actorData.items : actorData.items.contents || [];

        // Check Name Overrides (includes Minion feature)
        for (const [itemId, overrideVal] of Object.entries(this.overrides.features.names)) {
            // Only add if not already present in the change list
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
        
        // Run New Feature Logic (Simulation)
        const newFeatures = await Manager.handleNewFeatures(actor, typeKey, targetTier, currentTier, featureLog);

        return { 
            stats: sim, 
            features: featureLog, 
            structuredFeatures: structuredFeatures,
            newFeaturesList: newFeatures.toCreate 
        };
    }

    // --- Actions ---

    async _onOpenSettings(event, target) {
        new CompendiumManager().render(true);
    }

    async _onSelectSource(event, target) {
        event.preventDefault();
        event.stopPropagation();
        this.source = target.value;
        this.selectedActorId = null;
        this.overrides = { features: { names: {}, damage: {} } }; 
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
        this.overrides = { features: { names: {}, damage: {} } }; 
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
            this.overrides = { features: { names: {}, damage: {} } }; 
            this.render();
        }
    }

    async _onApplyChanges(event, target) {
        if (!this.selectedActorId) return;
        
        let actor = await this._getActor(this.selectedActorId);
        if (!actor) return;

        try {
            // 1. Handle Import from Compendium
            if (this.source !== "world") {
                const folderName = game.settings.get(MODULE_ID, SETTING_IMPORT_FOLDER) || "Imported Adversaries";
                let folder = game.folders.find(f => f.name === folderName && f.type === "Actor");
                if (!folder) {
                    folder = await Folder.create({ name: folderName, type: "Actor", color: "#430047" });
                }

                const pack = game.packs.get(this.source);
                actor = await game.actors.importFromCompendium(pack, this.selectedActorId, { folder: folder.id });
                
                // FORCE SOURCE UPDATE AND SAVE
                if (actor) {
                    this.source = "world";
                    this.selectedActorId = actor.id;
                    await game.settings.set(MODULE_ID, SETTING_LAST_SOURCE, "world");
                }
            }

            // 2. Perform Update
            const result = await Manager.updateSingleActor(actor, this.targetTier, this.overrides);
            
            if (!result) {
                ui.notifications.warn("No changes were necessary.");
            } else {
                // Success Notification Removed as per request
                // ui.notifications.info(`Updated ${actor.name} to Tier ${this.targetTier}`);
            }

            // 3. SYNC FILTERS TO NEW ACTOR STATE
            // Ensure the actor is visible and selected in the dropdowns

            // Update Tier Filter to match the NEW tier of the actor
            this.filterTier = String(this.targetTier); 
            await game.settings.set(MODULE_ID, SETTING_LAST_FILTER_TIER, this.filterTier);

            // Update Type Filter to match the actor's type
            const typeKey = (actor.system.type || "standard").toLowerCase();
            this.filterType = typeKey; 

            // Clear overrides after successful apply
            this.overrides = { features: { names: {}, damage: {} } };

            // Re-render to update the UI dropdowns
            this.render();

        } catch (e) {
            console.error(e);
            ui.notifications.error("Error applying changes. Check console.");
        }
    }
}