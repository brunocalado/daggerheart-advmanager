import { Manager } from "./manager.js";
import { ADVERSARY_BENCHMARKS } from "./rules.js";
import { MODULE_ID, SETTING_IMPORT_FOLDER, SETTING_EXTRA_COMPENDIUMS, SETTING_LAST_SOURCE, SETTING_LAST_FILTER_TIER } from "./module.js";
import { CompendiumManager } from "./compendium-manager.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Live Manager Application for Daggerheart Adversaries.
 * Allows selecting an actor (World or Compendium) and previewing changes in real-time.
 */
export class LiveManager extends HandlebarsApplicationMixin(ApplicationV2) {
    
    constructor(options = {}) {
        super(options);
        this.initialActor = options.actor || null;
        
        this.selectedActorId = this.initialActor ? this.initialActor.id : (options.actorId || null);
        this.targetTier = options.targetTier || 1;
        this.previewData = null;
        this.overrides = { features: {} }; // Stores manual inputs

        // Initialize from persistent settings, fallback to defaults
        this.filterTier = game.settings.get(MODULE_ID, SETTING_LAST_FILTER_TIER) || "all"; 
        this.source = game.settings.get(MODULE_ID, SETTING_LAST_SOURCE) || "world"; 
        this.filterType = "all"; // New Type Filter
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
        let linkData = null;
        let damageOptions = []; 
        let isMinion = false;

        if (this.selectedActorId) {
            actor = await this._getActor(this.selectedActorId);
            
            if (actor) {
                const currentTier = Number(actor.system.tier) || 1;
                const isLinked = actor.isToken ? actor.token?.actorLink : actor.prototypeToken?.actorLink;
                const typeKey = (actor.system.type || "standard").toLowerCase();
                isMinion = typeKey === "minion";
                
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
                if (benchmark && benchmark.damage_rolls && Array.isArray(benchmark.damage_rolls)) {
                    damageOptions = benchmark.damage_rolls.map(d => ({ value: d, label: d }));
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
                    tier: this.targetTier,
                    isMinion: isMinion
                };

                if (isMinion) {
                    previewStats.thresholdsDisplay = "None"; 
                    previewStats.hpDisplay = "(Fixed)"; 
                }

                // Prepare Structured Feature Data
                featurePreviewData = simResult.structuredFeatures.map(f => {
                    const overrideVal = this.overrides.features && this.overrides.features[f.itemId];
                    return {
                        itemId: f.itemId,
                        originalName: f.from,
                        newName: overrideVal !== undefined ? overrideVal : f.to,
                        isRenamed: f.type.startsWith("name_") 
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
            tiers,
            linkData,
            sourceOptions,
            filterOptions,
            typeOptions,
            damageOptions,
            actorName: actor?.name || "None"
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

        // Bind Feature Override Inputs
        html.querySelectorAll('.feature-override-input').forEach(input => {
            input.addEventListener('change', (e) => this._onFeatureOverrideChange(e, input));
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
        
        if (!this.overrides.features) {
            this.overrides.features = {};
        }
        
        // Update the overrides object
        this.overrides.features[itemId] = value;
    }

    // --- Stats Helpers (Standard) ---
    _extractStats(actorData, tier) {
        const sys = actorData.system;
        const damageParts = [];
        if (sys.attack?.damage?.parts) {
            sys.attack.damage.parts.forEach(p => {
                if(p.value) {
                    let formula = p.value.custom?.enabled ? p.value.custom.formula : 
                        (p.value.dice ? `${p.value.flatMultiplier || 1}${p.value.dice}${p.value.bonus ? (p.value.bonus > 0 ? '+'+p.value.bonus : p.value.bonus) : ''}` : p.value.flatMultiplier);
                    damageParts.push(formula);
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
            damage: damageParts.join(", ") || "None"
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
        if (actorData.system.attack?.damage?.parts) {
            const tempParts = foundry.utils.deepClone(actorData.system.attack.damage.parts);
            tempParts.forEach(part => {
                if (part.value) {
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
            });
        }
        sim.damage = damageParts.join(", ") || "None";

        const featureLog = [];
        const structuredFeatures = [];
        if (actorData.items) {
            for (const item of actorData.items) {
                const res = Manager.processFeatureUpdate(item, targetTier, currentTier, benchmark, featureLog, this.overrides.features);
                if (res && res.structured) {
                    structuredFeatures.push(...res.structured);
                }
            }
        }
        
        return { stats: sim, features: featureLog, structuredFeatures };
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
        this.overrides = { features: {} }; 
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
        this.overrides = { features: {} }; 
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
            this.overrides = { features: {} }; 
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
                }
            }

            const result = await Manager.updateSingleActor(actor, this.targetTier, this.overrides);
            
            if (!result) {
                ui.notifications.warn("No changes were necessary.");
            }
            this.render();

        } catch (e) {
            console.error(e);
            ui.notifications.error("Error applying changes. Check console.");
        }
    }
}