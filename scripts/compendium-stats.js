const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class CompendiumStats extends HandlebarsApplicationMixin(ApplicationV2) {
    
    constructor(options = {}) {
        super(options);
        this.allActors = [];
        this.featureIndex = null; // Store features index
        this.selectedType = "bruiser"; // Default selection
        this.statsCache = null;
        this.loading = true;
    }

    static DEFAULT_OPTIONS = {
        id: "daggerheart-compendium-stats",
        tag: "div",
        window: {
            title: "Compendium Statistics",
            icon: "fas fa-chart-bar",
            resizable: true,
            width: 900,
            height: "auto"
        },
        position: { width: 900, height: "auto" },
        actions: {
            refresh: CompendiumStats.prototype._onRefresh
        }
    };

    static PARTS = {
        form: {
            template: "modules/daggerheart-advmanager/templates/compendium-stats.hbs",
            scrollable: [".stats-table-container"]
        }
    };

    async _prepareContext(_options) {
        // Load actors if not loaded yet
        if (this.loading) {
            await this._loadCompendiumData();
            this.loading = false;
        }

        // Get unique types for the dropdown
        const types = new Set(this.allActors.map(a => a.system.type?.toLowerCase() || "standard"));
        const typeOptions = Array.from(types).sort().map(t => ({
            value: t,
            label: t.charAt(0).toUpperCase() + t.slice(1),
            selected: t === this.selectedType
        }));

        // Calculate stats for the selected type
        const statsData = this._calculateStats(this.selectedType);

        return {
            loading: this.loading,
            typeOptions: typeOptions,
            stats: statsData,
            headers: ["Tier 1", "Tier 2", "Tier 3", "Tier 4"]
        };
    }

    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;

        // Bind Type Select
        const typeSelect = html.querySelector('.stats-type-select');
        if (typeSelect) {
            typeSelect.addEventListener('change', (e) => {
                this.selectedType = e.target.value;
                this.render();
            });
        }

        // Bind Feature Links (Click & Drag)
        html.querySelectorAll('.feature-link').forEach(link => {
            // Click to Open
            link.addEventListener('click', async (e) => {
                e.stopPropagation();
                const featureName = link.dataset.featureName;
                await this._openFeatureSheet(featureName);
            });

            // Drag Start
            link.addEventListener('dragstart', (e) => {
                const uuid = link.dataset.uuid;
                if (!uuid) return;
                
                // Foundry Drag Data Format
                const dragData = { 
                    type: "Item", 
                    uuid: uuid 
                };
                e.dataTransfer.setData("text/plain", JSON.stringify(dragData));
            });
        });
    }

    async _openFeatureSheet(featureName) {
        // This is a fallback if UUID isn't on the element, though now we prioritize UUID
        const packName = "daggerheart-advmanager.all-features";
        const pack = game.packs.get(packName);
        
        if (!pack) {
            ui.notifications.warn(`Compendium '${packName}' not found. Ensure the module is active.`);
            return;
        }

        const index = await pack.getIndex();
        const entry = index.find(i => i.name === featureName);

        if (entry) {
            const doc = await pack.getDocument(entry._id);
            doc.sheet.render(true);
        } else {
            ui.notifications.warn(`Feature "${featureName}" not found in compendium.`);
        }
    }

    async _loadCompendiumData() {
        const pack = game.packs.get("daggerheart.adversaries");
        if (!pack) {
            ui.notifications.error("Compendium 'daggerheart.adversaries' not found.");
            return;
        }
        // Load all documents to access deep data structure
        this.allActors = await pack.getDocuments();

        // Load Features Index for UUID lookup
        const featurePack = game.packs.get("daggerheart-advmanager.all-features");
        if (featurePack) {
            this.featureIndex = await featurePack.getIndex();
        } else {
            console.warn("Daggerheart Manager | Features compendium not found. Drag/Drop may not work for all items.");
            this.featureIndex = new foundry.utils.Collection();
        }
    }

    _calculateStats(type) {
        // Initialize structure for Tiers 1-4
        const data = {
            1: this._initTierStats(),
            2: this._initTierStats(),
            3: this._initTierStats(),
            4: this._initTierStats()
        };

        // Filter actors by type
        const filteredActors = this.allActors.filter(a => (a.system.type?.toLowerCase() || "standard") === type);

        // Collect Values
        for (const actor of filteredActors) {
            const tier = Number(actor.system.tier) || 1;
            if (data[tier]) {
                const sys = actor.system;
                
                // Difficulty
                if (sys.difficulty) data[tier].difficulty.push(Number(sys.difficulty));

                // Thresholds
                if (sys.damageThresholds?.major) data[tier].major.push(Number(sys.damageThresholds.major));
                if (sys.damageThresholds?.severe) data[tier].severe.push(Number(sys.damageThresholds.severe));

                // HP & Stress
                if (sys.resources?.hitPoints?.max) data[tier].hp.push(Number(sys.resources.hitPoints.max));
                if (sys.resources?.stress?.max) data[tier].stress.push(Number(sys.resources.stress.max));

                // Attack Modifier
                if (sys.attack?.roll?.bonus !== undefined) data[tier].attackMod.push(Number(sys.attack.roll.bonus));

                // Damage Rolls & Halved Damage (Horde)
                if (sys.attack?.damage?.parts) {
                    sys.attack.damage.parts.forEach(part => {
                        // --- Regular Damage ---
                        let formula = "";
                        if (part.value?.custom?.enabled) {
                            formula = part.value.custom.formula;
                        } else if (part.value) {
                            const count = part.value.flatMultiplier || 1;
                            const dice = part.value.dice || "";
                            const bonus = part.value.bonus ? (Number(part.value.bonus) > 0 ? `+${part.value.bonus}` : part.value.bonus) : "";
                            
                            if (!dice) formula = `${part.value.flatMultiplier}`; // Flat damage
                            else formula = `${count}${dice}${bonus}`;
                        }
                        if (formula) data[tier].damageRolls.add(formula);

                        // --- Halved Damage (valueAlt) ---
                        let halvedFormula = "";
                        if (part.valueAlt?.custom?.enabled) {
                            halvedFormula = part.valueAlt.custom.formula;
                        } else if (part.valueAlt) {
                            const count = part.valueAlt.flatMultiplier || 1;
                            const dice = part.valueAlt.dice || "";
                            const bonus = part.valueAlt.bonus ? (Number(part.valueAlt.bonus) > 0 ? `+${part.valueAlt.bonus}` : part.valueAlt.bonus) : "";

                            if (!dice) halvedFormula = `${part.valueAlt.flatMultiplier}`; // Flat damage
                            else halvedFormula = `${count}${dice}${bonus}`;
                        }
                        if (halvedFormula) data[tier].halvedDamageRolls.add(halvedFormula);
                    });
                }

                // --- Features (Items) ---
                if (actor.items) {
                    actor.items.forEach(item => {
                        // We store items by name to avoid duplicates
                        if (!data[tier].features.has(item.name)) {
                            // Find UUID from the loaded index
                            let uuid = "";
                            const entry = this.featureIndex.find(i => i.name === item.name);
                            if (entry) {
                                uuid = entry.uuid; 
                            }

                            // Determine Feature Type Label
                            let typeLabel = "";
                            const form = item.system?.featureForm?.toLowerCase();
                            if (form === "action") typeLabel = "(A)";
                            else if (form === "passive") typeLabel = "(P)";
                            else if (form === "reaction") typeLabel = "(R)";
                            
                            data[tier].features.set(item.name, { 
                                img: item.img || "icons/svg/item-bag.svg",
                                uuid: uuid,
                                typeLabel: typeLabel
                            });
                        }
                    });
                }
            }
        }

        // Process Ranges
        const rows = [
            { label: "Difficulty", t1: this._getRange(data[1].difficulty), t2: this._getRange(data[2].difficulty), t3: this._getRange(data[3].difficulty), t4: this._getRange(data[4].difficulty) },
            { label: "Threshold Minimums", t1: this._getRange(data[1].major), t2: this._getRange(data[2].major), t3: this._getRange(data[3].major), t4: this._getRange(data[4].major) },
            { label: "Threshold Maximums", t1: this._getRange(data[1].severe), t2: this._getRange(data[2].severe), t3: this._getRange(data[3].severe), t4: this._getRange(data[4].severe) },
            { label: "Hit Points", t1: this._getRange(data[1].hp), t2: this._getRange(data[2].hp), t3: this._getRange(data[3].hp), t4: this._getRange(data[4].hp) },
            { label: "Stress", t1: this._getRange(data[1].stress), t2: this._getRange(data[2].stress), t3: this._getRange(data[3].stress), t4: this._getRange(data[4].stress) },
            { label: "Attack Modifier", t1: this._getSignedRange(data[1].attackMod), t2: this._getSignedRange(data[2].attackMod), t3: this._getSignedRange(data[3].attackMod), t4: this._getSignedRange(data[4].attackMod) },
            { label: "Damage Rolls", t1: this._getList(data[1].damageRolls), t2: this._getList(data[2].damageRolls), t3: this._getList(data[3].damageRolls), t4: this._getList(data[4].damageRolls), isList: true }
        ];

        // Conditional Row: Only show Halved Damage if Type is Horde
        if (type === "horde") {
            rows.push({ 
                label: "Halved Damage (Horde)", 
                t1: this._getList(data[1].halvedDamageRolls), 
                t2: this._getList(data[2].halvedDamageRolls), 
                t3: this._getList(data[3].halvedDamageRolls), 
                t4: this._getList(data[4].halvedDamageRolls), 
                isList: true 
            });
        }

        // Features Row
        rows.push({
            label: "Features",
            t1: this._getFeatureList(data[1].features),
            t2: this._getFeatureList(data[2].features),
            t3: this._getFeatureList(data[3].features),
            t4: this._getFeatureList(data[4].features),
            isList: true,
            isFeatures: true
        });

        return rows;
    }

    _initTierStats() {
        return {
            difficulty: [],
            major: [],
            severe: [],
            hp: [],
            stress: [],
            attackMod: [],
            damageRolls: new Set(),
            halvedDamageRolls: new Set(),
            features: new Map() // Key: Name, Value: {img, uuid, typeLabel}
        };
    }

    _getRange(arr) {
        if (!arr.length) return "-";
        const min = Math.min(...arr);
        const max = Math.max(...arr);
        if (min === max) return `${min}`;
        return `${min}-${max}`;
    }

    _getSignedRange(arr) {
        if (!arr.length) return "-";
        const min = Math.min(...arr);
        const max = Math.max(...arr);
        const fmt = (n) => n >= 0 ? `+${n}` : `${n}`;
        if (min === max) return fmt(min);
        return `${fmt(min)}/${fmt(max)}`;
    }

    _getList(set) {
        if (!set.size) return "-";
        return Array.from(set).sort().join(", ");
    }

    _getFeatureList(map) {
        if (!map.size) return "-";
        const sorted = Array.from(map.entries()).sort((a,b) => a[0].localeCompare(b[0]));
        
        return sorted.map(([name, data]) => {
            // Only make it draggable if we found a UUID
            const draggableAttr = data.uuid ? `draggable="true" data-uuid="${data.uuid}"` : "";
            // Append Type Label if exists
            const displayLabel = data.typeLabel ? `<span style="opacity: 0.7; margin-left: 4px;">${data.typeLabel}</span>` : "";
            
            return `<div class="feature-entry feature-link" data-feature-name="${name}" ${draggableAttr} title="Click to view, Drag to Sheet">
                <img src="${data.img}" class="feature-icon" alt="${name}"/>
                <span class="feature-name">${name}${displayLabel}</span>
             </div>`
        }).join("");
    }
}