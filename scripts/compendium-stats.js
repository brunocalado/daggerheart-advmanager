const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
import { CompendiumStatsManager } from "./compendium-stats-manager.js";
import { MODULE_ID, SETTING_STATS_COMPENDIUMS } from "./module.js";

export class CompendiumStats extends HandlebarsApplicationMixin(ApplicationV2) {
    
    constructor(options = {}) {
        super(options);
        this.allActors = [];
        this.featureIndex = []; // Changed to Array to support mixed sources
        this.selectedType = "bruiser"; 
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
            refresh: CompendiumStats.prototype._onRefresh,
            openSettings: CompendiumStats.prototype._onOpenSettings
        }
    };

    static PARTS = {
        form: {
            template: "modules/daggerheart-advmanager/templates/compendium-stats.hbs",
            scrollable: [".stats-table-container"]
        }
    };

    async _prepareContext(_options) {
        if (this.loading) {
            await this._loadCompendiumData();
            this.loading = false;
        }

        const types = new Set(this.allActors.map(a => a.system.type?.toLowerCase() || "standard"));
        const typeOptions = Array.from(types).sort().map(t => ({
            value: t,
            label: t.charAt(0).toUpperCase() + t.slice(1),
            selected: t === this.selectedType
        }));

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

        const typeSelect = html.querySelector('.stats-type-select');
        if (typeSelect) {
            typeSelect.addEventListener('change', (e) => {
                this.selectedType = e.target.value;
                this.render();
            });
        }

        html.querySelectorAll('.feature-link').forEach(link => {
            link.addEventListener('click', async (e) => {
                e.stopPropagation();
                const uuid = link.dataset.uuid;
                
                if (uuid) {
                    const doc = await fromUuid(uuid);
                    if (doc) return doc.sheet.render(true);
                }
                
                // Fallback (apenas se UUID falhar)
                const featureName = link.dataset.featureName;
                ui.notifications.warn(`Could not find sheet for ${featureName}`);
            });

            link.addEventListener('dragstart', (e) => {
                const uuid = link.dataset.uuid;
                if (!uuid) return;
                
                const dragData = { 
                    type: "Item", 
                    uuid: uuid 
                };
                e.dataTransfer.setData("text/plain", JSON.stringify(dragData));
            });
        });
    }

    async _onOpenSettings(event, target) {
        new CompendiumStatsManager().render(true);
    }

    async _onRefresh(event, target) {
        this.loading = true;
        this.render();
    }

    async _loadCompendiumData() {
        this.allActors = [];
        this.featureIndex = []; // Reset as Array

        // 1. Load Adversaries (System + Selected)
        const systemPack = game.packs.get("daggerheart.adversaries");
        if (systemPack) {
            const sysDocs = await systemPack.getDocuments();
            // Filter to only include adversary type actors
            const adversaries = sysDocs.filter(doc => doc.type === "adversary");
            this.allActors.push(...adversaries);
        }

        const extraPacks = game.settings.get(MODULE_ID, SETTING_STATS_COMPENDIUMS) || [];
        for (const packId of extraPacks) {
            const pack = game.packs.get(packId);
            if (pack) {
                try {
                    const docs = await pack.getDocuments();
                    // Filter to only include adversary type actors
                    const adversaries = docs.filter(doc => doc.type === "adversary");
                    this.allActors.push(...adversaries);
                } catch (e) {
                    console.error(`Daggerheart Stats | Failed to load pack ${packId}`, e);
                }
            }
        }

        // 2. Load Features Index (System Default)
        // Isso carrega features do módulo "core" se existir
        const featurePack = game.packs.get("daggerheart-advmanager.all-features");
        if (featurePack) {
            const index = await featurePack.getIndex({ 
                fields: ["flags.importedFrom.adversary", "flags.importedFrom.tier", "flags.importedFrom.type"] 
            });
            this.featureIndex.push(...index);
        }

        // 3. Load Features from WORLD ITEMS (Imported)
        // Isso pega tudo que foi importado via AM.ImportFeatures
        // Filtramos itens que tenham a flag 'importedFrom'
        const worldFeatures = game.items.filter(i => i.flags?.importedFrom);
        
        const mappedWorldItems = worldFeatures.map(i => ({
            name: i.name,
            uuid: i.uuid, // IMPORTANTE: Usa o UUID do item no mundo
            img: i.img,
            flags: i.flags
        }));

        // Adiciona à lista geral de features disponíveis para busca
        this.featureIndex.push(...mappedWorldItems);
    }

    _calculateStats(type) {
        const data = {
            1: this._initTierStats(),
            2: this._initTierStats(),
            3: this._initTierStats(),
            4: this._initTierStats()
        };

        const filteredActors = this.allActors.filter(a => (a.system.type?.toLowerCase() || "standard") === type);

        for (const actor of filteredActors) {
            const actorTier = Number(actor.system.tier) || 1;
            if (data[actorTier]) {
                const sys = actor.system;
                
                // --- Simple Stats Collection ---
                if (sys.difficulty) data[actorTier].difficulty.push(Number(sys.difficulty));
                if (sys.damageThresholds?.major) data[actorTier].major.push(Number(sys.damageThresholds.major));
                if (sys.damageThresholds?.severe) data[actorTier].severe.push(Number(sys.damageThresholds.severe));
                if (sys.resources?.hitPoints?.max) data[actorTier].hp.push(Number(sys.resources.hitPoints.max));
                if (sys.resources?.stress?.max) data[actorTier].stress.push(Number(sys.resources.stress.max));
                if (sys.attack?.roll?.bonus !== undefined) data[actorTier].attackMod.push(Number(sys.attack.roll.bonus));

                // --- Experiences ---
                if (sys.experiences) {
                    const expList = Object.values(sys.experiences);
                    data[actorTier].expCounts.push(expList.length);
                    expList.forEach(e => {
                        const val = Number(e.value);
                        if (!isNaN(val)) data[actorTier].expValues.push(val);
                    });
                } else {
                    data[actorTier].expCounts.push(0);
                }

                // --- Damage ---
                if (sys.attack?.damage?.parts) {
                    sys.attack.damage.parts.forEach(part => {
                        let formula = this._extractFormula(part.value);
                        if (formula) data[actorTier].damageRolls.add(formula);

                        let halved = this._extractFormula(part.valueAlt);
                        if (halved) data[actorTier].halvedDamageRolls.add(halved);
                    });
                }

                // --- Features (Updated Lookup Logic) ---
                if (actor.items) {
                    actor.items.forEach(item => {
                        // Determinar Tier (override via flag ou tier do ator)
                        let itemTier = item.flags?.importedFrom?.tier ? Number(item.flags.importedFrom.tier) : actorTier;

                        if (data[itemTier]) {
                            if (!data[itemTier].features.has(item.name)) {
                                
                                // === LOGICA DE BUSCA DE UUID ===
                                // Agora buscamos no this.featureIndex que contem AMBOS (Compendio e Mundo)
                                
                                // 1. Match Perfeito: Nome + Adversário + Custom Tag (do Pack importado)
                                // Se o ator veio de um pack importado, tentamos achar o item importado correspondente
                                let entry = null;

                                // Tentar achar um item que pertença a este adversário específico
                                entry = this.featureIndex.find(i => 
                                    i.name === item.name && 
                                    i.flags?.importedFrom?.adversary === actor.name
                                );

                                // 2. Match Genérico por Nome (Fallback)
                                if (!entry) {
                                    entry = this.featureIndex.find(i => i.name === item.name);
                                }

                                const uuid = entry ? entry.uuid : "";
                                // ==============================

                                let typeLabel = "";
                                const form = item.system?.featureForm?.toLowerCase();
                                if (form === "action") typeLabel = "(A)";
                                else if (form === "passive") typeLabel = "(P)";
                                else if (form === "reaction") typeLabel = "(R)";
                                
                                data[itemTier].features.set(item.name, { 
                                    img: item.img || "icons/svg/item-bag.svg",
                                    uuid: uuid,
                                    typeLabel: typeLabel
                                });
                            }
                        }
                    });
                }
            }
        }

        return this._formatStatsRows(data, type);
    }

    // Helper para extrair fórmula de dano
    _extractFormula(valObj) {
        if (!valObj) return "";
        if (valObj.custom?.enabled) return valObj.custom.formula;
        if (valObj.dice) {
            const count = valObj.flatMultiplier || 1;
            const bonus = valObj.bonus ? (Number(valObj.bonus) > 0 ? `+${valObj.bonus}` : valObj.bonus) : "";
            return `${count}${valObj.dice}${bonus}`;
        }
        return `${valObj.flatMultiplier || 0}`;
    }

    _formatStatsRows(data, type) {
        const rows = [
            { label: "Difficulty", t1: this._getRange(data[1].difficulty), t2: this._getRange(data[2].difficulty), t3: this._getRange(data[3].difficulty), t4: this._getRange(data[4].difficulty) },
            { label: "Threshold Min", t1: this._getRange(data[1].major), t2: this._getRange(data[2].major), t3: this._getRange(data[3].major), t4: this._getRange(data[4].major) },
            { label: "Threshold Max", t1: this._getRange(data[1].severe), t2: this._getRange(data[2].severe), t3: this._getRange(data[3].severe), t4: this._getRange(data[4].severe) },
            { label: "Hit Points", t1: this._getRange(data[1].hp), t2: this._getRange(data[2].hp), t3: this._getRange(data[3].hp), t4: this._getRange(data[4].hp) },
            { label: "Stress", t1: this._getRange(data[1].stress), t2: this._getRange(data[2].stress), t3: this._getRange(data[3].stress), t4: this._getRange(data[4].stress) },
            { label: "Attack Mod", t1: this._getSignedRange(data[1].attackMod), t2: this._getSignedRange(data[2].attackMod), t3: this._getSignedRange(data[3].attackMod), t4: this._getSignedRange(data[4].attackMod) },
            { label: "Damage Rolls", t1: this._getList(data[1].damageRolls), t2: this._getList(data[2].damageRolls), t3: this._getList(data[3].damageRolls), t4: this._getList(data[4].damageRolls), isList: true }
        ];

        if (type === "horde") {
            rows.push({ 
                label: "Halved Dmg", 
                t1: this._getList(data[1].halvedDamageRolls), 
                t2: this._getList(data[2].halvedDamageRolls), 
                t3: this._getList(data[3].halvedDamageRolls), 
                t4: this._getList(data[4].halvedDamageRolls), 
                isList: true 
            });
        }

        rows.push({
            label: "Experiences",
            t1: this._formatExpData(data[1]),
            t2: this._formatExpData(data[2]),
            t3: this._formatExpData(data[3]),
            t4: this._formatExpData(data[4])
        });

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
            features: new Map(),
            expCounts: [],
            expValues: []
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

    _formatExpData(tierData) {
        if (!tierData.expCounts.length) return "-";
        const minQty = Math.min(...tierData.expCounts);
        const maxQty = Math.max(...tierData.expCounts);
        const countStr = minQty === maxQty ? `(${minQty})` : `(${minQty}-${maxQty})`;

        let valStr = "";
        if (tierData.expValues.length > 0) {
            const minVal = Math.min(...tierData.expValues);
            const maxVal = Math.max(...tierData.expValues);
            const fmt = (n) => n >= 0 ? `+${n}` : `${n}`;
            if (minVal === maxVal) valStr = fmt(minVal);
            else valStr = `${fmt(minVal)}/${fmt(maxVal)}`;
        }
        const tooltip = "Quantity (Min-Max) +Value Range";
        return `<span data-tooltip="${tooltip}" style="cursor: help;">${countStr} ${valStr}</span>`;
    }

    _getList(set) {
        if (!set.size) return "-";
        return Array.from(set).sort().join(", ");
    }

    _getFeatureList(map) {
        if (!map.size) return "-";
        const sorted = Array.from(map.entries()).sort((a,b) => a[0].localeCompare(b[0]));
        
        return sorted.map(([name, data]) => {
            const draggableAttr = data.uuid ? `draggable="true" data-uuid="${data.uuid}"` : "";
            const displayLabel = data.typeLabel ? `<span style="opacity: 0.7; margin-left: 4px;">${data.typeLabel}</span>` : "";
            
            return `<div class="feature-entry feature-link" data-feature-name="${name}" ${draggableAttr} title="Click to view, Drag to Sheet">
                <img src="${data.img}" class="feature-icon" alt="${name}"/>
                <span class="feature-name">${name}${displayLabel}</span>
             </div>`
        }).join("");
    }
}