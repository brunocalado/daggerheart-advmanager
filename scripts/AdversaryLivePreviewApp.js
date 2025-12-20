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
        // Initial state
        this.selectedActorId = options.actorId || null;
        this.targetTier = options.targetTier || 1;
        this.previewData = null;
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
            // "selectActor" removed from here to be handled manually in _onRender for "change" event
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
     * Prepare data for the Handlebars template
     */
    async _prepareContext(_options) {
        // 1. Get List of Adversaries
        const adversaries = game.actors
            .filter(a => a.type === "adversary")
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(a => ({ id: a.id, name: a.name, selected: a.id === this.selectedActorId }));

        // 2. Prepare Current & Preview Data if Actor Selected
        let currentStats = null;
        let previewStats = null;
        let actor = null;
        let featurePreviewLog = [];

        if (this.selectedActorId) {
            actor = game.actors.get(this.selectedActorId);
            if (actor) {
                const currentTier = Number(actor.system.tier) || 1;
                
                // Extrai estatísticas atuais
                currentStats = this._extractStats(actor.toObject(), currentTier);
                
                // Simula estatísticas futuras
                const simResult = await this._simulateStats(actor, this.targetTier, currentTier);
                previewStats = simResult.stats;
                featurePreviewLog = simResult.features;
            }
        }

        // 3. Prepare Tier Buttons
        const tiers = [1, 2, 3, 4].map(t => ({
            value: t,
            label: `Tier ${t}`,
            isCurrent: t === this.targetTier,
            cssClass: t === this.targetTier ? "active" : ""
        }));

        return {
            adversaries,
            hasActor: !!actor,
            selectedActorId: this.selectedActorId,
            currentStats,
            previewStats,
            featurePreviewLog,
            tiers,
            actorName: actor?.name || "None"
        };
    }

    /**
     * Post-Render hook to bind specific events like 'change' for the select box.
     */
    _onRender(context, options) {
        super._onRender(context, options);
        
        // Manual binding for the Select Actor dropdown to ensure it triggers on CHANGE, not CLICK
        const selectElement = this.element.querySelector('.main-actor-select');
        if (selectElement) {
            selectElement.addEventListener('change', (event) => {
                this._onSelectActor(event, selectElement);
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
        const actor = game.actors.get(this.selectedActorId);
        
        if (actor) {
            // Reset to current tier only if switching actors
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
        
        const actor = game.actors.get(this.selectedActorId);
        if (!actor) return;

        try {
            ui.notifications.info(`Applying Tier ${this.targetTier} to ${actor.name}...`);
            const result = await AdversaryManagerApp.updateSingleActor(actor, this.targetTier);
            
            if (result) {
                if (game.settings.get("daggerheart-advmanager", "enableChatLog")) {
                    AdversaryManagerApp.sendBatchChatLog([result], this.targetTier);
                }
                // Notification REMOVED as requested
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
