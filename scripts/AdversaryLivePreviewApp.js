import { AdversaryManagerApp } from "./AdversaryManagerApp.js";
import { ADVERSARY_BENCHMARKS } from "./rules.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Live Preview Application for Daggerheart Adversaries.
 * Allows selecting an actor and previewing changes in real-time.
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
        this.filterTier = "all"; // Default filter state
    }

    static DEFAULT_OPTIONS = {
        id: "daggerheart-live-preview",
        tag: "form",
        window: {
            title: "Adversary Live Preview",
            icon: "fas fa-eye",
            resizable: true,
            width: 900,
            height: 750
        },
        position: { width: 900, height: 750 },
        actions: {
            // "selectActor" and "filterTier" removed to be handled manually in _onRender
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
     * Helper to get the actual actor object, handling both World Actors and Synthetic (Token) Actors.
     */
    _getActor(actorId) {
        if (!actorId) return null;
        
        // 1. Check if it matches the initial synthetic actor passed
        if (this.initialActor && this.initialActor.id === actorId) {
            return this.initialActor;
        }

        // 2. Try to find in the world
        return game.actors.get(actorId);
    }

    /**
     * Prepare data for the Handlebars template
     */
    async _prepareContext(_options) {
        // 1. Get List of World Adversaries (Raw first to allow filtering)
        let allAdversaries = game.actors
            .filter(a => a.type === "adversary")
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(a => ({ 
                id: a.id, 
                name: a.name, 
                tier: Number(a.system.tier) || 1, // Store tier for filtering
                selected: a.id === this.selectedActorId 
            }));

        // 2. If we have a synthetic initial actor, ensure it's in the list
        if (this.initialActor && !game.actors.has(this.initialActor.id)) {
            // Check if already added (to avoid duplicates if re-rendering)
            if (!allAdversaries.find(a => a.id === this.initialActor.id)) {
                allAdversaries.unshift({
                    id: this.initialActor.id,
                    name: `${this.initialActor.name} (Token)`,
                    tier: Number(this.initialActor.system.tier) || 1,
                    selected: this.initialActor.id === this.selectedActorId
                });
            }
        }

        // 3. Apply Tier Filter
        let displayedAdversaries = allAdversaries;
        if (this.filterTier !== "all") {
            displayedAdversaries = allAdversaries.filter(a => a.tier === Number(this.filterTier));
        }
        
        // Ensure selected actor is visible even if it doesn't match filter (optional UX choice, but good practice)
        // If the selected actor is hidden by filter, it might look confusing. 
        // For now, let's respect the filter strictly, but if the selected actor is filtered out, 
        // the select box will naturally just show the first available option or empty depending on browser.
        
        // 4. Prepare Current & Preview Data if Actor Selected
        let currentStats = null;
        let previewStats = null;
        let actor = null;
        let featurePreviewLog = [];
        let linkData = null;

        if (this.selectedActorId) {
            actor = this._getActor(this.selectedActorId);
            
            if (actor) {
                const currentTier = Number(actor.system.tier) || 1;
                
                // Determine Link Status
                const isLinked = actor.isToken ? actor.token?.actorLink : actor.prototypeToken?.actorLink;
                
                linkData = {
                    isLinked: isLinked,
                    icon: isLinked ? "fa-link" : "fa-unlink",
                    cssClass: isLinked ? "status-linked" : "status-unlinked",
                    label: isLinked ? "Linked" : "Unlinked"
                };

                // Extrai estatísticas atuais
                currentStats = this._extractStats(actor.toObject(), currentTier);
                
                // Simula estatísticas futuras
                const simResult = await this._simulateStats(actor, this.targetTier, currentTier);
                previewStats = simResult.stats;
                featurePreviewLog = simResult.features;
            }
        }

        // 5. Prepare Tier Buttons
        const tiers = [1, 2, 3, 4].map(t => ({
            value: t,
            label: `Tier ${t}`,
            isCurrent: t === this.targetTier,
            cssClass: t === this.targetTier ? "active" : ""
        }));

        // 6. Filter Options
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
            filterOptions,
            actorName: actor?.name || "None"
        };
    }

    /**
     * Post-Render hook to bind specific events like 'change' for the select box.
     */
    _onRender(context, options) {
        super._onRender(context, options);
        
        // 1. Bind Main Actor Select
        const selectElement = this.element.querySelector('.main-actor-select');
        if (selectElement) {
            selectElement.addEventListener('change', (event) => {
                this._onSelectActor(event, selectElement);
            });
        }

        // 2. Bind Filter Tier Select
        const filterElement = this.element.querySelector('.filter-tier-select');
        if (filterElement) {
            filterElement.addEventListener('change', (event) => {
                this._onFilterTier(event, filterElement);
            });
        }
    }

    /**
     * Extracts displayable stats from an actor object
     */
    _extractStats(actorData, tier) {
        const sys = actorData.system;
        
        // Format Damage strings from items (Sheet Attack)
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
            tier: tier,
            difficulty: sys.difficulty,
            hp: sys.resources?.hitPoints?.max,
            stress: sys.resources?.stress?.max,
            thresholds: `${sys.damageThresholds?.major} / ${sys.damageThresholds?.severe}`,
            attackMod: sys.attack?.roll?.bonus,
            damage: damageParts.join(", ") || "None"
        };
    }

    /**
     * Simulates the stats for the target tier based on module rules
     */
    async _simulateStats(actor, targetTier, currentTier) {
        const actorData = actor.toObject();
        const typeKey = (actorData.system.type || "standard").toLowerCase();
        
        if (!ADVERSARY_BENCHMARKS[typeKey]) return { stats: { error: "Unknown Type" }, features: [] };
        const benchmark = ADVERSARY_BENCHMARKS[typeKey].tiers[`tier_${targetTier}`];
        if (!benchmark) return { stats: { error: "Benchmark missing" }, features: [] };

        const sim = {};

        // --- 1. Basic Stats Simulation ---
        sim.difficulty = this._formatRange(benchmark.difficulty);
        sim.hp = this._formatRange(benchmark.hp);
        sim.stress = this._formatRange(benchmark.stress);
        sim.thresholds = `${benchmark.threshold_min} - ${benchmark.threshold_max}`;
        sim.attackMod = benchmark.attack_modifier;
        sim.tier = targetTier;

        // --- 2. Sheet Damage Simulation ---
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

        // --- 3. Features Simulation ---
        const featureLog = [];
        
        // A) Existing Items Update Simulation
        if (actorData.items) {
            for (const item of actorData.items) {
                AdversaryManagerApp.processFeatureUpdate(item, targetTier, currentTier, benchmark, featureLog);
            }
        }

        // B) Suggested Features Simulation
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

    /* -------------------------------------------- */
    /* Event Listeners & Actions                   */
    /* -------------------------------------------- */

    async _onSelectActor(event, target) {
        event.preventDefault();
        event.stopPropagation();
        
        this.selectedActorId = target.value;
        const actor = this._getActor(this.selectedActorId);
        
        if (actor) {
            this.targetTier = Number(actor.system.tier) || 1;
        }
        this.render();
    }

    async _onFilterTier(event, target) {
        event.preventDefault();
        event.stopPropagation();
        
        this.filterTier = target.value;
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
        
        const actor = this._getActor(this.selectedActorId);
        if (!actor) return;

        try {
            ui.notifications.info(`Applying Tier ${this.targetTier} to ${actor.name}...`);
            const result = await AdversaryManagerApp.updateSingleActor(actor, this.targetTier);
            
            if (result) {
                if (game.settings.get("daggerheart-advmanager", "enableChatLog")) {
                    AdversaryManagerApp.sendBatchChatLog([result], this.targetTier);
                }
            } else {
                ui.notifications.warn("No changes were necessary.");
            }
            this.render();
        } catch (e) {
            console.error(e);
            ui.notifications.error("Error applying changes.");
        }
    }
}