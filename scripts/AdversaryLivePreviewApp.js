import { AdversaryManagerApp } from "./AdversaryManagerApp.js";
import { ADVERSARY_BENCHMARKS } from "./rules.js";
import { MODULE_ID, SETTING_IMPORT_FOLDER, SETTING_EXTRA_COMPENDIUMS, SETTING_LAST_SOURCE, SETTING_LAST_FILTER_TIER } from "./module.js";
import { CompendiumManagerApp } from "./CompendiumManagerApp.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Live Preview Application for Daggerheart Adversaries.
 * Allows selecting an actor (World or Compendium) and previewing changes in real-time.
 */
export class AdversaryLivePreviewApp extends HandlebarsApplicationMixin(ApplicationV2) {
    
    constructor(options = {}) {
        super(options);
        this.initialActor = options.actor || null;
        
        this.selectedActorId = this.initialActor ? this.initialActor.id : (options.actorId || null);
        this.targetTier = options.targetTier || 1;
        this.previewData = null;

        // Initialize from persistent settings, fallback to defaults
        this.filterTier = game.settings.get(MODULE_ID, SETTING_LAST_FILTER_TIER) || "all"; 
        this.source = game.settings.get(MODULE_ID, SETTING_LAST_SOURCE) || "world"; 
    }

    static DEFAULT_OPTIONS = {
        id: "daggerheart-live-preview",
        tag: "form",
        window: {
            title: "Adversary Live Preview",
            icon: "fas fa-eye",
            resizable: true,
            width: 950,
            height: 750
        },
        position: { width: 950, height: 750 },
        actions: {
            selectTier: AdversaryLivePreviewApp.prototype._onSelectTier,
            applyChanges: AdversaryLivePreviewApp.prototype._onApplyChanges,
            openSettings: AdversaryLivePreviewApp.prototype._onOpenSettings
        },
        form: {
            handler: AdversaryLivePreviewApp.prototype.submitHandler,
            closeOnSubmit: false
        }
    };

    static PARTS = {
        form: {
            template: "modules/daggerheart-advmanager/templates/live-preview.hbs",
            scrollable: [".preview-body"]
        }
    };

    /**
     * Helper to get the actual actor object.
     */
    async _getActor(actorId) {
        if (!actorId) return null;
        
        // 1. Synthetic / Initial Actor
        if (this.initialActor && this.initialActor.id === actorId) {
            return this.initialActor;
        }

        // 2. World Actor
        if (this.source === "world") {
            return game.actors.get(actorId);
        }

        // 3. System Compendium
        if (this.source === "daggerheart.adversaries") {
            const pack = game.packs.get("daggerheart.adversaries");
            if (pack) return await pack.getDocument(actorId);
        }

        // 4. Extra Compendiums (Dynamic Source)
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

        // Add User-Selected Compendiums
        const extraCompendiums = game.settings.get(MODULE_ID, SETTING_EXTRA_COMPENDIUMS) || [];
        
        // Safety check: if current source is invalid (e.g. compendium unselected), reset to world
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
            // Update UI to reflect fallback
            sourceOptions.forEach(o => o.selected = (o.value === "world"));
        }

        // --- Fetch Adversaries based on Source ---
        if (this.source === "world") {
            rawAdversaries = game.actors
                .filter(a => a.type === "adversary")
                .map(a => ({ 
                    id: a.id, 
                    name: a.name, 
                    tier: Number(a.system.tier) || 1
                }));
            
            if (this.initialActor && !game.actors.has(this.initialActor.id)) {
                if (!rawAdversaries.find(a => a.id === this.initialActor.id)) {
                    rawAdversaries.push({
                        id: this.initialActor.id,
                        name: `${this.initialActor.name} (Token)`,
                        tier: Number(this.initialActor.system.tier) || 1
                    });
                }
            }
        } else {
            const pack = game.packs.get(this.source);
            if (pack) {
                const index = await pack.getIndex({ fields: ["system.tier", "type"] });
                rawAdversaries = index
                    .filter(i => i.type === "adversary")
                    .map(i => ({
                        id: i._id,
                        name: i.name,
                        tier: Number(i.system?.tier) || 1
                    }));
            }
        }

        rawAdversaries.sort((a, b) => a.name.localeCompare(b.name));

        let allAdversaries = rawAdversaries.map(a => ({
            ...a,
            selected: a.id === this.selectedActorId
        }));

        let displayedAdversaries = allAdversaries;
        if (this.filterTier !== "all") {
            displayedAdversaries = allAdversaries.filter(a => a.tier === Number(this.filterTier));
        }

        // --- Prepare Stats ---
        let currentStats = null;
        let previewStats = null;
        let actor = null;
        let featurePreviewLog = [];
        let linkData = null;

        if (this.selectedActorId) {
            actor = await this._getActor(this.selectedActorId);
            
            if (actor) {
                const currentTier = Number(actor.system.tier) || 1;
                
                const isLinked = actor.isToken ? actor.token?.actorLink : actor.prototypeToken?.actorLink;
                
                linkData = {
                    isLinked: isLinked,
                    icon: isLinked ? "fa-link" : "fa-unlink",
                    cssClass: isLinked ? "status-linked" : "status-unlinked",
                    label: isLinked ? "Linked" : "Unlinked"
                };

                if (this.source !== "world") linkData = null;

                currentStats = this._extractStats(actor.toObject(), currentTier);
                
                const simResult = await this._simulateStats(actor, this.targetTier, currentTier);
                previewStats = simResult.stats;
                featurePreviewLog = simResult.features;
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

        return {
            adversaries: displayedAdversaries,
            hasActor: !!actor,
            selectedActorId: this.selectedActorId,
            currentStats,
            previewStats,
            featurePreviewLog,
            tiers,
            linkData,
            sourceOptions,
            filterOptions,
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

        const actorSelect = html.querySelector('.main-actor-select');
        if (actorSelect) actorSelect.addEventListener('change', (e) => this._onSelectActor(e, actorSelect));
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
        
        if (!ADVERSARY_BENCHMARKS[typeKey]) return { stats: { error: "Unknown Type" }, features: [] };
        const benchmark = ADVERSARY_BENCHMARKS[typeKey].tiers[`tier_${targetTier}`];
        if (!benchmark) return { stats: { error: "Benchmark missing" }, features: [] };

        const sim = {};
        sim.difficulty = this._formatRange(benchmark.difficulty);
        sim.hp = this._formatRange(benchmark.hp);
        sim.stress = this._formatRange(benchmark.stress);
        sim.thresholds = `${benchmark.threshold_min} - ${benchmark.threshold_max}`;
        sim.attackMod = benchmark.attack_modifier;
        sim.tier = targetTier;

        const damageParts = [];
        if (actorData.system.attack?.damage?.parts) {
            const tempParts = foundry.utils.deepClone(actorData.system.attack.damage.parts);
            tempParts.forEach(part => {
                if (part.value) {
                    const result = AdversaryManagerApp.processDamageValue(part.value, targetTier, currentTier, benchmark.damage_rolls);
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
        if (actorData.items) {
            for (const item of actorData.items) {
                AdversaryManagerApp.processFeatureUpdate(item, targetTier, currentTier, benchmark, featureLog);
            }
        }
        if (game.settings.get("daggerheart-advmanager", "autoAddFeatures") && targetTier > currentTier) {
            if (benchmark.suggested_features && Array.isArray(benchmark.suggested_features) && benchmark.suggested_features.length > 0) {
                 const suggestions = benchmark.suggested_features.map(s => s.replace("(X)", `(${targetTier})`));
                 const potential = suggestions.join(", ");
                 featureLog.push(`<span style="color:#00e676;">Potential New Feature from:</span> ${potential}`);
            }
        }
        return { stats: sim, features: featureLog };
    }

    _formatRange(val) {
        if(!val) return "-";
        const rolled = AdversaryManagerApp.getRollFromRange(val);
        return `${rolled} <span class="range-hint">(${val})</span>`;
    }

    // --- Actions ---

    async _onOpenSettings(event, target) {
        // Open the Compendium Manager
        new CompendiumManagerApp().render(true);
    }

    async _onSelectSource(event, target) {
        event.preventDefault();
        event.stopPropagation();
        this.source = target.value;
        this.selectedActorId = null;
        
        // Save Setting
        await game.settings.set(MODULE_ID, SETTING_LAST_SOURCE, this.source);
        
        this.render();
    }

    async _onFilterTier(event, target) {
        event.preventDefault();
        event.stopPropagation();
        this.filterTier = target.value;
        
        // Save Setting
        await game.settings.set(MODULE_ID, SETTING_LAST_FILTER_TIER, this.filterTier);
        
        this.render();
    }

    async _onSelectActor(event, target) {
        event.preventDefault();
        event.stopPropagation();
        this.selectedActorId = target.value;
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

            const result = await AdversaryManagerApp.updateSingleActor(actor, this.targetTier);
            
            if (result) {
                // LOGGING SUPPRESSED HERE FOR LIVE PREVIEW
                // if (game.settings.get(MODULE_ID, "enableChatLog")) {
                //    AdversaryManagerApp.sendBatchChatLog([result], this.targetTier);
                // }
            } else {
                ui.notifications.warn("No changes were necessary.");
            }
            this.render();

        } catch (e) {
            console.error(e);
            ui.notifications.error("Error applying changes. Check console.");
        }
    }
}