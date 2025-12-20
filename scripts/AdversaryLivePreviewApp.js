import { AdversaryManagerApp } from "./AdversaryManagerApp.js";
import { ADVERSARY_BENCHMARKS } from "./rules.js";
import { MODULE_ID, SETTING_IMPORT_FOLDER } from "./module.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Live Preview Application for Daggerheart Adversaries.
 * Allows selecting an actor (World or Compendium) and previewing changes in real-time.
 */
export class AdversaryLivePreviewApp extends HandlebarsApplicationMixin(ApplicationV2) {
    
    constructor(options = {}) {
        super(options);
        // Store the initial actor object passed (crucial for synthetic/token actors)
        this.initialActor = options.actor || null;
        
        // Initial state
        this.selectedActorId = this.initialActor ? this.initialActor.id : (options.actorId || null);
        this.targetTier = options.targetTier || 1;
        this.previewData = null;
        this.filterTier = "all"; // Default tier filter
        this.source = "world"; // 'world' or 'compendium'
    }

    static DEFAULT_OPTIONS = {
        id: "daggerheart-live-preview",
        tag: "form",
        window: {
            title: "Adversary Live Preview",
            icon: "fas fa-eye",
            resizable: true,
            width: 950, // Slightly wider for extra control
            height: 750
        },
        position: { width: 950, height: 750 },
        actions: {
            // Manual handling in _onRender for selects
            selectTier: AdversaryLivePreviewApp.prototype._onSelectTier,
            applyChanges: AdversaryLivePreviewApp.prototype._onApplyChanges
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
     * Handles World, Synthetic, and asynchronous Compendium fetches.
     */
    async _getActor(actorId) {
        if (!actorId) return null;
        
        // 1. Synthetic / Initial Actor passed in constructor
        if (this.initialActor && this.initialActor.id === actorId) {
            return this.initialActor;
        }

        // 2. World Actor
        if (this.source === "world") {
            return game.actors.get(actorId);
        }

        // 3. Compendium Actor
        if (this.source === "compendium") {
            const pack = game.packs.get("daggerheart.adversaries");
            if (pack) {
                // Must fetch the full document to display stats
                return await pack.getDocument(actorId);
            }
        }

        return null;
    }

    /**
     * Prepare data for the Handlebars template
     */
    async _prepareContext(_options) {
        let rawAdversaries = [];

        // 1. Fetch List based on Source
        if (this.source === "world") {
            rawAdversaries = game.actors
                .filter(a => a.type === "adversary")
                .map(a => ({ 
                    id: a.id, 
                    name: a.name, 
                    tier: Number(a.system.tier) || 1
                }));
            
            // Add synthetic actor if not in world
            if (this.initialActor && !game.actors.has(this.initialActor.id)) {
                if (!rawAdversaries.find(a => a.id === this.initialActor.id)) {
                    rawAdversaries.push({
                        id: this.initialActor.id,
                        name: `${this.initialActor.name} (Token)`,
                        tier: Number(this.initialActor.system.tier) || 1
                    });
                }
            }
        } else if (this.source === "compendium") {
            const pack = game.packs.get("daggerheart.adversaries");
            if (pack) {
                // Get index first for list display (faster)
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

        // Sort alphabetically
        rawAdversaries.sort((a, b) => a.name.localeCompare(b.name));

        // 2. Mark selected state
        let allAdversaries = rawAdversaries.map(a => ({
            ...a,
            selected: a.id === this.selectedActorId
        }));

        // 3. Apply Tier Filter
        let displayedAdversaries = allAdversaries;
        if (this.filterTier !== "all") {
            displayedAdversaries = allAdversaries.filter(a => a.tier === Number(this.filterTier));
        }

        // 4. Prepare Current & Preview Data
        let currentStats = null;
        let previewStats = null;
        let actor = null;
        let featurePreviewLog = [];
        let linkData = null;

        if (this.selectedActorId) {
            // Note: _getActor is async now because of Compendium
            actor = await this._getActor(this.selectedActorId);
            
            if (actor) {
                const currentTier = Number(actor.system.tier) || 1;
                
                // Determine Link Status (Only relevant for World/Token actors really)
                const isLinked = actor.isToken ? actor.token?.actorLink : actor.prototypeToken?.actorLink;
                
                linkData = {
                    isLinked: isLinked,
                    icon: isLinked ? "fa-link" : "fa-unlink",
                    cssClass: isLinked ? "status-linked" : "status-unlinked",
                    label: isLinked ? "Linked" : "Unlinked"
                };

                // Compendium actors don't have link status really, just static
                if (this.source === "compendium") linkData = null;

                currentStats = this._extractStats(actor.toObject(), currentTier);
                
                const simResult = await this._simulateStats(actor, this.targetTier, currentTier);
                previewStats = simResult.stats;
                featurePreviewLog = simResult.features;
            }
        }

        // 5. Tier Buttons
        const tiers = [1, 2, 3, 4].map(t => ({
            value: t,
            label: `Tier ${t}`,
            isCurrent: t === this.targetTier,
            cssClass: t === this.targetTier ? "active" : ""
        }));

        // 6. Source Options
        const sourceOptions = [
            { value: "world", label: "World", selected: this.source === "world" },
            { value: "compendium", label: "System Compendium", selected: this.source === "compendium" }
        ];

        // 7. Filter Options
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

        // Bind Source Select
        const sourceSelect = html.querySelector('.source-select');
        if (sourceSelect) {
            sourceSelect.addEventListener('change', (e) => this._onSelectSource(e, sourceSelect));
        }

        // Bind Filter Tier Select
        const filterSelect = html.querySelector('.filter-tier-select');
        if (filterSelect) {
            filterSelect.addEventListener('change', (e) => this._onFilterTier(e, filterSelect));
        }

        // Bind Main Actor Select
        const actorSelect = html.querySelector('.main-actor-select');
        if (actorSelect) {
            actorSelect.addEventListener('change', (e) => this._onSelectActor(e, actorSelect));
        }
    }

    // --- Stats Helpers (Identical to previous) ---
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

    async _onSelectSource(event, target) {
        event.preventDefault();
        event.stopPropagation();
        this.source = target.value;
        this.selectedActorId = null; // Reset selection on source change
        this.render();
    }

    async _onFilterTier(event, target) {
        event.preventDefault();
        event.stopPropagation();
        this.filterTier = target.value;
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
            // Logic for Compendium: Import first, then update
            if (this.source === "compendium") {
                // Notifications suppressed per request
                
                // 1. Get or Create Folder
                const folderName = game.settings.get(MODULE_ID, SETTING_IMPORT_FOLDER) || "Imported Adversaries";
                let folder = game.folders.find(f => f.name === folderName && f.type === "Actor");
                if (!folder) {
                    // Create folder with specific purple color
                    folder = await Folder.create({ name: folderName, type: "Actor", color: "#430047" });
                }

                // 2. Import Actor
                const pack = game.packs.get("daggerheart.adversaries");
                actor = await game.actors.importFromCompendium(pack, this.selectedActorId, { folder: folder.id });
                
                if (actor) {
                    // Switch context to the new World actor so future edits on this screen affect the imported copy
                    this.source = "world";
                    this.selectedActorId = actor.id;
                }
            }

            // Normal Update Logic (Works for existing World actors or the newly imported one)
            const result = await AdversaryManagerApp.updateSingleActor(actor, this.targetTier);
            
            if (result) {
                if (game.settings.get(MODULE_ID, "enableChatLog")) {
                    AdversaryManagerApp.sendBatchChatLog([result], this.targetTier);
                }
                // Success notification suppressed per request
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