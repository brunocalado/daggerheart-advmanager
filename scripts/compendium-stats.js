const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
import { CompendiumStatsManager } from "./compendium-stats-manager.js";
import { MODULE_ID } from "./constants.js";
import { SETTING_STATS_COMPENDIUMS } from "./module.js";
import { getActionDamageParts, formatDamageValue } from "./damage-engine.js";

const SYSTEM_ADVERSARY_PACK = "daggerheart.adversaries";
const SNAPSHOT_PATH = `modules/${MODULE_ID}/data/compendium-stats-core.json`;
const FEATURE_LABELS = { action: "(A)", passive: "(P)", reaction: "(R)" };

/**
 * The parsed core census, shared by every window in this session. `undefined` means it has not
 * been fetched yet, `null` that it is unavailable — either way, reading it costs nothing twice.
 * @type {Object|null|undefined}
 */
let coreSnapshotCache;

/** @type {boolean} Whether the "snapshot is stale" notification has already been shown. */
let staleSnapshotWarned = false;

/**
 * The census recomputed from documents when the bundled one is stale. A patch release of the
 * system invalidates the shipped file even when no adversary changed, so the minute that costs
 * is paid once per session rather than on every open, until the file is regenerated.
 * @type {Object|null}
 */
let recomputedCensus = null;

export class CompendiumStats extends HandlebarsApplicationMixin(ApplicationV2) {

    constructor(options = {}) {
        super(options);
        this.allActors = [];
        this.featureIndex = []; // Changed to Array to support mixed sources
        this.selectedType = "bruiser";
        this.coreSnapshot = null;
        this.availableTypes = new Set();
        this.loading = true;
        this._loadPromise = null;
    }

    static DEFAULT_OPTIONS = {
        id: "daggerheart-compendium-stats",
        classes: [MODULE_ID],
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
            // Paint the window now and let the load re-render it. The core census is a single
            // file read, but a homebrew compendium still means loading documents, and awaiting
            // that here would leave the window blank until it finished.
            this._beginLoad();
            return { loading: true, typeOptions: [], stats: [], headers: [] };
        }

        const typeOptions = Array.from(this.availableTypes).sort().map(t => ({
            value: t,
            label: t.charAt(0).toUpperCase() + t.slice(1),
            selected: t === this.selectedType
        }));

        if (typeOptions.length && !this.availableTypes.has(this.selectedType)) {
            this.selectedType = typeOptions[0].value;
            typeOptions[0].selected = true;
        }

        const statsData = this._calculateStats(this.selectedType);

        return {
            loading: false,
            typeOptions: typeOptions,
            stats: statsData,
            headers: ["Tier 1", "Tier 2", "Tier 3", "Tier 4"]
        };
    }

    /**
     * Starts the data load once, then re-renders with the result.
     * @returns {Promise<void>} Resolves when the load settles.
     */
    _beginLoad() {
        if (this._loadPromise) return this._loadPromise;

        this._loadPromise = this._loadCompendiumData()
            .catch(err => console.error("Adversary Manager | Failed to load compendium statistics.", err))
            .finally(() => {
                this.loading = false;
                this._loadPromise = null;
                // Deferred so this never re-enters a render that is still in flight.
                setTimeout(() => { if (this.rendered) this.render(); }, 0);
            });

        return this._loadPromise;
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

    /**
     * Fetches the bundled core census once per session.
     * @returns {Promise<Object|null>} The snapshot, or null when it can't be read.
     */
    static async _fetchCoreSnapshot() {
        const getRoute = foundry.utils?.getRoute ?? (p => p);
        try {
            const response = await fetch(getRoute(SNAPSHOT_PATH));
            if (!response.ok) {
                console.warn(`Adversary Manager | No bundled statistics at ${SNAPSHOT_PATH} (${response.status}).`);
                return null;
            }
            return await response.json();
        } catch (err) {
            console.warn(`Adversary Manager | Could not read ${SNAPSHOT_PATH}.`, err);
            return null;
        }
    }

    /**
     * Reports why a snapshot cannot stand in for the installed compendium.
     * The count check reads the pack index, which is already in memory — it costs nothing and
     * catches a compendium that changed without the system version changing.
     * @param {Object} snapshot - The bundled census.
     * @param {CompendiumCollection} pack - The system adversary pack.
     * @returns {string|null} The mismatch, or null when the snapshot is usable.
     */
    static _snapshotMismatch(snapshot, pack) {
        if (!snapshot?.types) return "the file is empty or malformed";
        if (snapshot.system !== game.system.id) return `it was built for the "${snapshot.system}" system`;
        if (snapshot.systemVersion !== game.system.version) {
            return `it was built for Daggerheart ${snapshot.systemVersion}, but ${game.system.version} is installed`;
        }

        const entries = pack.index.contents ?? Array.from(pack.index);
        const typed = entries.filter(e => e.type !== undefined);
        const count = typed.length ? typed.filter(e => e.type === "adversary").length : entries.length;
        if (count !== snapshot.adversaryCount) {
            return `the compendium holds ${count} adversaries and the snapshot describes ${snapshot.adversaryCount}`;
        }

        return null;
    }

    /**
     * Returns the core census when it still describes the installed compendium.
     * @param {CompendiumCollection} pack - The system adversary pack.
     * @returns {Promise<Object|null>} The snapshot, or null to fall back to reading documents.
     */
    async _getCoreSnapshot(pack) {
        if (coreSnapshotCache === undefined) coreSnapshotCache = await CompendiumStats._fetchCoreSnapshot();
        if (!coreSnapshotCache) return null;

        const mismatch = CompendiumStats._snapshotMismatch(coreSnapshotCache, pack);
        if (!mismatch) return coreSnapshotCache;

        // Silence here would be the worst outcome: the numbers would quietly describe an older
        // release, which is exactly how the benchmarks drifted a whole system version behind.
        console.warn(`Adversary Manager | Ignoring the bundled statistics because ${mismatch}. Reading the compendium instead.`);
        if (!staleSnapshotWarned) {
            staleSnapshotWarned = true;
            ui.notifications.warn(`Adversary Manager | The bundled adversary statistics are out of date (${mismatch}), so they were recalculated from the compendium — which is why this took a while. A GM can refresh them by running AM.BuildStatsSnapshot() in the console.`);
        }
        return null;
    }

    async _loadCompendiumData() {
        this.allActors = [];
        this.featureIndex = []; // Reset as Array
        this.coreSnapshot = null;
        this.availableTypes = new Set();

        // 1. Load Adversaries (System + Selected)
        // The system compendium is the same 264 adversaries for almost every table, so it ships
        // pre-computed: reading it as documents means building 264 Actors with their embedded
        // items on every open. Homebrew packs, which the snapshot cannot know about, are still
        // read live and merged on top.
        const systemPack = game.packs.get(SYSTEM_ADVERSARY_PACK);
        if (systemPack) {
            const snapshot = await this._getCoreSnapshot(systemPack)
                ?? (recomputedCensus?.systemVersion === game.system.version ? recomputedCensus : null);

            if (snapshot) {
                this.coreSnapshot = snapshot;
                for (const type of Object.keys(snapshot.types)) this.availableTypes.add(type);
            } else {
                const sysDocs = await systemPack.getDocuments();
                // Filter to only include adversary type actors
                const adversaries = sysDocs.filter(doc => doc.type === "adversary");
                this.allActors.push(...adversaries);
                // Keep what that cost bought, so the next open in this session is instant.
                recomputedCensus = CompendiumStats.reduceToSnapshot(adversaries);
            }
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

        for (const actor of this.allActors) {
            this.availableTypes.add(actor.system.type?.toLowerCase() || "standard");
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
            1: CompendiumStats._initTierStats(),
            2: CompendiumStats._initTierStats(),
            3: CompendiumStats._initTierStats(),
            4: CompendiumStats._initTierStats()
        };

        this._seedFromSnapshot(data, type);

        // Sorted by name, like the snapshot builder: a feature shared by several adversaries is
        // credited to the first one seen, and that decides which document its link opens. Left in
        // compendium order, the same table would link somewhere else depending on the source.
        const filteredActors = this.allActors
            .filter(a => (a.system.type?.toLowerCase() || "standard") === type)
            .sort((a, b) => a.name.localeCompare(b.name));

        for (const actor of filteredActors) {
            CompendiumStats.accumulateActor(data, actor);
        }

        return this._formatStatsRows(data, type);
    }

    // Helper to render a damage value as its formula string
    _extractFormula(valObj) {
        return formatDamageValue(valObj);
    }

    /**
     * Folds one adversary into a tier-keyed accumulator.
     *
     * This is the single definition of what the statistics are made of, shared by the live pass
     * and by buildCoreSnapshot — so a snapshot can never describe the compendium differently
     * from a direct read of it. It deliberately reads `actor.system`, the prepared data: fifteen
     * adversaries carry an always-on effect from their own features (Flying, Mounted, Chevalier)
     * that raises Difficulty above the printed number, and that is the value they play at.
     * @param {Object} data - Tier-keyed accumulator from _initTierStats.
     * @param {Actor} actor - Adversary to fold in.
     */
    static accumulateActor(data, actor) {
        const actorTier = Number(actor.system.tier) || 1;
        const tierData = data[actorTier];
        if (!tierData) return;

        const sys = actor.system;

        // --- Simple Stats Collection ---
        if (sys.difficulty) tierData.difficulty.push(Number(sys.difficulty));
        if (sys.damageThresholds?.major) tierData.major.push(Number(sys.damageThresholds.major));
        if (sys.damageThresholds?.severe) tierData.severe.push(Number(sys.damageThresholds.severe));
        if (sys.resources?.hitPoints?.max) tierData.hp.push(Number(sys.resources.hitPoints.max));
        if (sys.resources?.stress?.max) tierData.stress.push(Number(sys.resources.stress.max));
        if (sys.attack?.roll?.bonus !== undefined) tierData.attackMod.push(Number(sys.attack.roll.bonus));

        // --- Experiences ---
        if (sys.experiences) {
            const expList = Object.values(sys.experiences);
            tierData.expCounts.push(expList.length);
            expList.forEach(e => {
                const val = Number(e.value);
                if (!isNaN(val)) tierData.expValues.push(val);
            });
        } else {
            tierData.expCounts.push(0);
        }

        // --- Damage ---
        getActionDamageParts(sys.attack?.damage).forEach(part => {
            const formula = formatDamageValue(part.value);
            if (formula) tierData.damageRolls.add(formula);

            const halved = formatDamageValue(part.valueAlt);
            if (halved) tierData.halvedDamageRolls.add(halved);
        });

        // --- Features ---
        for (const item of actor.items ?? []) {
            // Tier override via flag, otherwise the adversary's own tier
            const itemTier = item.flags?.importedFrom?.tier ? Number(item.flags.importedFrom.tier) : actorTier;
            if (!data[itemTier] || data[itemTier].features.has(item.name)) continue;

            data[itemTier].features.set(item.name, {
                img: item.img || "icons/svg/item-bag.svg",
                typeLabel: FEATURE_LABELS[item.system?.featureForm?.toLowerCase()] ?? "",
                // Kept rather than resolved to a uuid here: which document the name should link
                // to depends on the feature compendiums this world has, so it is settled at
                // render time and a stored snapshot stays portable between worlds.
                adversary: actor.name
            });
        }
    }

    /**
     * Builds the census that ships as data/compendium-stats-core.json.
     *
     * It runs inside the client on purpose. The values this window reports are the prepared ones,
     * and reproducing the system's own derivation outside Foundry would be a copy that silently
     * drifts the next time the system changes — so the snapshot is produced by the same code
     * that would otherwise compute it live, and is simply saved.
     * @returns {Promise<Object>} Snapshot payload, ready to be written to data/.
     */
    static async buildCoreSnapshot() {
        const pack = game.packs.get(SYSTEM_ADVERSARY_PACK);
        if (!pack) throw new Error(`Compendium "${SYSTEM_ADVERSARY_PACK}" not found.`);

        const docs = await pack.getDocuments();
        return CompendiumStats.reduceToSnapshot(docs.filter(doc => doc.type === "adversary"));
    }

    /**
     * Reduces already-loaded adversaries into the snapshot payload.
     * Split out from buildCoreSnapshot so the fallback path, which has just paid to load every
     * document, can keep its result for the rest of the session instead of paying again.
     * @param {Actor[]} actors - Adversary documents.
     * @returns {Object} Snapshot payload.
     */
    static reduceToSnapshot(actors) {
        // Sorted so a rebuild that changes nothing produces an identical file.
        const adversaries = [...actors].sort((a, b) => a.name.localeCompare(b.name));

        const byType = {};
        for (const actor of adversaries) {
            const type = actor.system.type?.toLowerCase() || "standard";
            byType[type] ??= { 1: CompendiumStats._initTierStats(), 2: CompendiumStats._initTierStats(), 3: CompendiumStats._initTierStats(), 4: CompendiumStats._initTierStats() };
            CompendiumStats.accumulateActor(byType[type], actor);
        }

        const range = arr => arr.length ? [Math.min(...arr), Math.max(...arr)] : null;
        const types = {};
        for (const [type, tiers] of Object.entries(byType)) {
            types[type] = {};
            for (const [tier, cell] of Object.entries(tiers)) {
                const isEmpty = !cell.difficulty.length && !cell.expCounts.length && !cell.features.size && !cell.damageRolls.size;
                if (isEmpty) continue;
                types[type][tier] = {
                    difficulty: range(cell.difficulty),
                    major: range(cell.major),
                    severe: range(cell.severe),
                    hp: range(cell.hp),
                    stress: range(cell.stress),
                    attackMod: range(cell.attackMod),
                    expCounts: range(cell.expCounts),
                    expValues: range(cell.expValues),
                    damageRolls: [...cell.damageRolls].sort(),
                    halvedDamageRolls: [...cell.halvedDamageRolls].sort(),
                    features: [...cell.features.entries()]
                        .sort((a, b) => a[0].localeCompare(b[0]))
                        .map(([name, f]) => ({ name, img: f.img, typeLabel: f.typeLabel, adversary: f.adversary }))
                };
            }
        }

        return {
            system: game.system.id,
            systemVersion: game.system.version,
            adversaryCount: adversaries.length,
            generated: new Date().toISOString().slice(0, 10),
            types
        };
    }

    /**
     * Resolves the document a feature name should link to, searching the feature index that holds
     * both the compendium entries and the imported world items.
     * @param {string} name - Feature name.
     * @param {string} adversaryName - Adversary the feature was read from.
     * @returns {string} A uuid, or "" when the feature has no document to open.
     */
    _findFeatureUuid(name, adversaryName) {
        // An item imported from this specific adversary is the better link; any item of the same
        // name is the fallback.
        const owned = this.featureIndex.find(i => i.name === name && i.flags?.importedFrom?.adversary === adversaryName);
        const entry = owned ?? this.featureIndex.find(i => i.name === name);
        return entry?.uuid ?? "";
    }

    /**
     * Seeds a tier table with the pre-computed core census before the live compendiums are added.
     *
     * Only the endpoints of each range are pushed back in. Every figure this window shows is a
     * min/max, a set union or a first-wins map, and all three answer the same whether they see
     * the whole population or just its extremes — so a homebrew pack merged on top of this gives
     * exactly the table that reading every document would have produced.
     * @param {Object} data - Tier-keyed accumulator from _initTierStats.
     * @param {string} type - Adversary type being displayed.
     */
    _seedFromSnapshot(data, type) {
        const tiers = this.coreSnapshot?.types?.[type];
        if (!tiers) return;

        const seed = (target, range) => { if (range) target.push(range[0], range[1]); };

        for (const [tier, cell] of Object.entries(tiers)) {
            const target = data[Number(tier)];
            if (!target) continue;

            seed(target.difficulty, cell.difficulty);
            seed(target.major, cell.major);
            seed(target.severe, cell.severe);
            seed(target.hp, cell.hp);
            seed(target.stress, cell.stress);
            seed(target.attackMod, cell.attackMod);
            seed(target.expCounts, cell.expCounts);
            seed(target.expValues, cell.expValues);

            for (const formula of cell.damageRolls ?? []) target.damageRolls.add(formula);
            for (const formula of cell.halvedDamageRolls ?? []) target.halvedDamageRolls.add(formula);

            for (const feature of cell.features ?? []) {
                if (target.features.has(feature.name)) continue;
                target.features.set(feature.name, {
                    img: feature.img,
                    typeLabel: feature.typeLabel ?? "",
                    adversary: feature.adversary
                });
            }
        }
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

    static _initTierStats() {
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
            // Resolved at render time rather than stored: which document a feature name links to
            // depends on the compendiums this world has and on what the GM imported.
            const uuid = this._findFeatureUuid(name, data.adversary);
            const draggableAttr = uuid ? `draggable="true" data-uuid="${uuid}"` : "";
            const displayLabel = data.typeLabel ? `<span style="opacity: 0.7; margin-left: 4px;">${data.typeLabel}</span>` : "";
            
            return `<div class="feature-entry feature-link" data-feature-name="${name}" ${draggableAttr} title="Click to view, Drag to Sheet">
                <img src="${data.img}" class="feature-icon" alt="${name}"/>
                <span class="feature-name">${name}${displayLabel}</span>
             </div>`
        }).join("");
    }
}