import { MODULE_ID, SETTING_EXTRA_COMPENDIUMS, SETTING_ENCOUNTER_FOLDER } from "./module.js";
import { LiveManager } from "./live-manager.js"; // Import needed for edit functionality

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Encounter Builder Application.
 */
export class EncounterBuilder extends HandlebarsApplicationMixin(ApplicationV2) {
    
    constructor(options = {}) {
        super(options);
        
        // Initial State
        this.searchQuery = "";
        this.filterType = "all";
        this.filterTier = "all"; 
        this.filterSource = "all"; 
        
        // Encounter Settings
        this.pcCount = 4;
        this.pcTier = 1;
        
        // Manual Modifier States
        this.manualModifiers = {
            easier: false, // Subtract 1 (Less Difficult/Shorter)
            harder: false  // Add 2 (More Dangerous/Longer)
        };

        // List of added units
        this.encounterList = []; 
        
        // Cache
        this._cachedAdversaries = null;
    }

    static DEFAULT_OPTIONS = {
        id: "daggerheart-encounter-builder",
        tag: "form",
        window: {
            title: "Encounter Builder",
            icon: "fas fa-dungeon",
            resizable: true,
            width: 1000,
            height: 750
        },
        position: { width: 1000, height: 750 },
        actions: {
            selectTier: EncounterBuilder.prototype._onSelectTier,
            openSheet: EncounterBuilder.prototype._onOpenSheet,
            clearSearch: EncounterBuilder.prototype._onClearSearch,
            addUnit: EncounterBuilder.prototype._onAddUnit,
            removeUnit: EncounterBuilder.prototype._onRemoveUnit,
            toggleModifier: EncounterBuilder.prototype._onToggleModifier,
            toggleUnitBoost: EncounterBuilder.prototype._onToggleUnitBoost,
            updatePCSettings: EncounterBuilder.prototype._onUpdatePCSettings,
            createEncounter: EncounterBuilder.prototype._onCreateEncounter,
            editAdversary: EncounterBuilder.prototype._onEditAdversary // <--- NOVA AÇÃO
        },
        form: {
            handler: EncounterBuilder.prototype.submitHandler,
            closeOnSubmit: false
        }
    };

    static PARTS = {
        form: {
            template: "modules/daggerheart-advmanager/templates/encounter-builder.hbs",
            scrollable: [".eb-results-list", ".eb-encounter-list"]
        }
    };

    async _prepareContext(_options) {
        const adversaries = await this._getAllAdversaries();

        // --- Source Options ---
        const extraPacks = game.settings.get(MODULE_ID, SETTING_EXTRA_COMPENDIUMS) || [];
        const sourceOptions = [
            { value: "all", label: "All Sources", selected: this.filterSource === "all" },
            { value: "world", label: "World (Actors)", selected: this.filterSource === "world" },
            { value: "daggerheart.adversaries", label: "System Compendium", selected: this.filterSource === "daggerheart.adversaries" }
        ];

        extraPacks.forEach(packId => {
            const pack = game.packs.get(packId);
            if (pack) {
                sourceOptions.push({
                    value: packId,
                    label: pack.metadata.label,
                    selected: this.filterSource === packId
                });
            }
        });

        // --- Filter Logic ---
        let filtered = adversaries.filter(a => {
            if (this.filterSource !== "all") {
                if (this.filterSource === "world") {
                    if (a.isCompendium) return false;
                } else {
                    if (a.packId !== this.filterSource) return false;
                }
            }
            if (this.filterTier !== "all" && a.tier !== Number(this.filterTier)) return false;
            if (this.filterType !== "all" && a.type !== this.filterType) return false;
            if (this.searchQuery) {
                if (!a.name.toLowerCase().includes(this.searchQuery.toLowerCase())) return false;
            }
            return true;
        });
        filtered.sort((a, b) => a.name.localeCompare(b.name));

        // --- UI Options ---
        const tiers = [1, 2, 3, 4].map(t => ({
            value: t,
            label: `T${t}`,
            isCurrent: String(t) === String(this.filterTier),
            cssClass: String(t) === String(this.filterTier) ? "active" : ""
        }));

        const typeSet = new Set(adversaries.map(a => a.type).filter(t => t));
        const typeOptions = Array.from(typeSet).sort().map(t => ({
            value: t,
            label: t.charAt(0).toUpperCase() + t.slice(1),
            selected: this.filterType === t
        }));
        typeOptions.unshift({ value: "all", label: "All Types", selected: this.filterType === "all" });

        // --- Budget Calculation ---
        const bpData = this._calculateBP();

        return {
            adversaries: filtered,
            encounterList: this.encounterList,
            tiers,
            typeOptions,
            sourceOptions,
            searchQuery: this.searchQuery,
            resultCount: filtered.length,
            
            // BP Data
            pcCount: this.pcCount,
            pcTier: this.pcTier,
            pcTierOptions: [1, 2, 3, 4].map(t => ({ value: t, label: `Tier ${t}`, selected: t === this.pcTier })),
            bpData: bpData,
            manualModifiers: this.manualModifiers
        };
    }

    _calculateBP() {
        const baseBP = (3 * this.pcCount) + 2;
        let limit = baseBP;
        
        let currentCost = 0;
        let minionCount = 0;
        let soloCount = 0;
        let hasDamageBoost = false;
        let hasLowerTier = false;
        let hasSpecialType = false;

        this.encounterList.forEach(unit => {
            const type = unit.type;

            if (type === "minion") {
                minionCount++;
            } else if (["social", "support"].includes(type)) {
                currentCost += 1;
            } else if (["horde", "ranged", "skulk", "standard"].includes(type)) {
                currentCost += 2;
            } else if (type === "leader") {
                currentCost += 3;
            } else if (type === "bruiser") {
                currentCost += 4;
            } else if (type === "solo") {
                currentCost += 5;
            } else {
                currentCost += 2;
            }

            if (type === "solo") soloCount++;
            if (unit.hasDamageBoost) hasDamageBoost = true;
            if (unit.tier < this.pcTier) hasLowerTier = true;
            if (["bruiser", "horde", "leader", "solo"].includes(type)) hasSpecialType = true;
        });

        if (minionCount > 0) {
            const groupSize = Math.max(1, this.pcCount);
            currentCost += Math.ceil(minionCount / groupSize);
        }

        const modifiers = [];

        // 1. Easier/Shorter (Manual)
        if (this.manualModifiers.easier) {
            limit -= 1;
            modifiers.push({ label: "Easier/Shorter", val: "-1", active: true, manual: true, key: 'easier' });
        } else {
            modifiers.push({ label: "Easier/Shorter", val: "-1", active: false, manual: true, key: 'easier' });
        }

        // 2. 2+ Solos (Auto)
        if (soloCount >= 2) {
            limit -= 2;
            modifiers.push({ label: "2+ Solos", val: "-2", active: true, manual: false });
        } else {
            modifiers.push({ label: "2+ Solos", val: "-2", active: false, manual: false, disabled: true });
        }

        // 3. Damage Boost (Auto)
        if (hasDamageBoost) {
            limit -= 2;
            modifiers.push({ label: "Damage Boost (+1d4)", val: "-2", active: true, manual: false });
        } else {
            modifiers.push({ label: "Damage Boost (+1d4)", val: "-2", active: false, manual: false, disabled: true });
        }

        // 4. Lower Tier (Auto)
        if (hasLowerTier) {
            limit += 1;
            modifiers.push({ label: "Lower Tier Used", val: "+1", active: true, manual: false });
        } else {
            modifiers.push({ label: "Lower Tier Used", val: "+1", active: false, manual: false, disabled: true });
        }

        // 5. No Major Adversaries (Auto)
        if (this.encounterList.length > 0 && !hasSpecialType) {
            limit += 1;
            modifiers.push({ label: "No Major Adversaries", val: "+1", active: true, manual: false });
        } else {
            modifiers.push({ label: "No Major Adversaries", val: "+1", active: false, manual: false, disabled: true });
        }

        // 6. Harder/Longer (Manual)
        if (this.manualModifiers.harder) {
            limit += 2;
            modifiers.push({ label: "Harder/Longer", val: "+2", active: true, manual: true, key: 'harder' });
        } else {
            modifiers.push({ label: "Harder/Longer", val: "+2", active: false, manual: true, key: 'harder' });
        }

        return {
            base: baseBP,
            total: limit,
            cost: currentCost,
            remaining: limit - currentCost,
            modifiers: modifiers,
            statusColor: (currentCost > limit) ? "red" : (currentCost === limit ? "green" : "gold")
        };
    }

    async _getAllAdversaries() {
        if (this._cachedAdversaries) return this._cachedAdversaries;
        let all = [];
        const worldActors = game.actors.filter(a => a.type === "adversary").map(a => this._formatActorData(a));
        all.push(...worldActors);

        const systemPack = game.packs.get("daggerheart.adversaries");
        if (systemPack) {
            const index = await systemPack.getIndex({ fields: ["system.tier", "system.type", "img"] });
            all.push(...index.filter(i => i.type === "adversary").map(i => this._formatIndexData(i, "daggerheart.adversaries")));
        }

        const extraPacks = game.settings.get(MODULE_ID, SETTING_EXTRA_COMPENDIUMS) || [];
        for (const packId of extraPacks) {
            const pack = game.packs.get(packId);
            if (pack) {
                const index = await pack.getIndex({ fields: ["system.tier", "system.type", "img"] });
                all.push(...index.filter(i => i.type === "adversary").map(i => this._formatIndexData(i, packId)));
            }
        }
        this._cachedAdversaries = all;
        return all;
    }

    _formatActorData(actor) {
        return {
            uuid: actor.uuid,
            id: actor.id,
            name: actor.name,
            tier: Number(actor.system.tier) || 1,
            type: (actor.system.type || "standard").toLowerCase(),
            img: actor.img,
            isCompendium: false,
            packId: null
        };
    }

    _formatIndexData(indexEntry, packId) {
        return {
            uuid: indexEntry.uuid,
            id: indexEntry._id,
            name: indexEntry.name,
            tier: Number(indexEntry.system?.tier) || 1,
            type: (indexEntry.system?.type || "standard").toLowerCase(),
            img: indexEntry.img,
            isCompendium: true,
            packId: packId
        };
    }

    /* --- Actions --- */

    async _onCreateEncounter(event, target) {
        event.preventDefault();
        
        if (this.encounterList.length === 0) {
            ui.notifications.warn("No adversaries in the encounter to create.");
            return;
        }

        try {
            // Get Folder Name from Settings
            const rootName = game.settings.get(MODULE_ID, SETTING_ENCOUNTER_FOLDER) || "💀 My Encounters";
            
            // 1. Find/Create Root Folder
            let rootFolder = game.folders.find(f => f.name === rootName && f.type === "Actor");
            if (!rootFolder) {
                rootFolder = await Folder.create({ name: rootName, type: "Actor", color: "#430047" });
            }

            // 2. Create Subfolder
            const now = new Date();
            const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
            const dateString = now.toLocaleDateString().replace(/\//g, '-');
            const subFolderName = `Encounter ${dateString} ${timeString}`;
            
            // CORRECT: use 'folder' property to set parent folder ID
            const subFolder = await Folder.create({ 
                name: subFolderName, 
                type: "Actor", 
                folder: rootFolder.id, 
                color: "#9c27b0" 
            });

            // 3. Copy Adversaries
            let count = 0;
            for (const unit of this.encounterList) {
                const originalActor = await fromUuid(unit.uuid);
                if (!originalActor) continue;

                if (originalActor.compendium) {
                    await game.actors.importFromCompendium(originalActor.compendium, originalActor.id, { 
                        folder: subFolder.id
                    });
                } else {
                    await originalActor.clone({ 
                        folder: subFolder.id 
                    }, { save: true });
                }
                count++;
            }

            ui.notifications.info(`Encounter created: "${rootName}/${subFolderName}" with ${count} adversaries.`);
            
        } catch (err) {
            console.error(err);
            ui.notifications.error("Failed to create encounter. Check console.");
        }
    }

    // Opens LiveManager for the selected actor
    async _onEditAdversary(event, target) {
        // Stop bubbling so we don't trigger the sheet opening
        event.stopPropagation();
        
        const uuid = target.closest('[data-uuid]').dataset.uuid;
        if (!uuid) return;

        const actor = await fromUuid(uuid);
        if (actor) {
            // Check if LiveManager is already imported/available in global scope or imported
            // Since we imported it at the top, we can use it.
            new LiveManager({ actor: actor }).render(true);
        }
    }

    /* --- Event Listeners --- */

    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;

        const searchInput = html.querySelector('.eb-search-input');
        if (searchInput) searchInput.addEventListener('input', (e) => this._onSearch(e));

        const typeSelect = html.querySelector('.eb-type-select');
        if (typeSelect) typeSelect.addEventListener('change', (e) => this._onFilterType(e));

        const sourceSelect = html.querySelector('.eb-source-select');
        if (sourceSelect) sourceSelect.addEventListener('change', (e) => this._onFilterSource(e));
        
        const pcCountInput = html.querySelector('.pc-count-input');
        if (pcCountInput) pcCountInput.addEventListener('change', (e) => this._onUpdatePCSettings(e));
        
        const pcTierSelect = html.querySelector('.pc-tier-select');
        if (pcTierSelect) pcTierSelect.addEventListener('change', (e) => this._onUpdatePCSettings(e));
    }

    _onSearch(event) {
        event.preventDefault();
        this.searchQuery = event.target.value;
        this.render();
    }

    _onFilterType(event) {
        event.preventDefault();
        this.filterType = event.target.value;
        this.render();
    }

    _onFilterSource(event) {
        event.preventDefault();
        this.filterSource = event.target.value;
        this.render();
    }

    _onSelectTier(event, target) {
        const tier = target.dataset.tier;
        this.filterTier = (this.filterTier === tier) ? "all" : tier;
        this.render();
    }

    _onClearSearch(event, target) {
        this.searchQuery = "";
        this.render();
    }

    _onUpdatePCSettings(event) {
        event.preventDefault();
        const html = this.element;
        const count = parseInt(html.querySelector('.pc-count-input').value) || 4;
        const tier = parseInt(html.querySelector('.pc-tier-select').value) || 1;
        this.pcCount = Math.max(0, Math.min(10, count)); 
        this.pcTier = tier;
        this.render();
    }

    _onToggleModifier(event, target) {
        const key = target.dataset.key;
        if (key && this.manualModifiers.hasOwnProperty(key)) {
            this.manualModifiers[key] = !this.manualModifiers[key];
            this.render();
        }
    }

    _onToggleUnitBoost(event, target) {
        event.stopPropagation();
        const entryId = target.closest('.eb-encounter-item').dataset.entryid; 
        const unit = this.encounterList.find(u => u.entryId === entryId);
        if (unit) {
            unit.hasDamageBoost = !unit.hasDamageBoost;
            this.render();
        }
    }

    async _onOpenSheet(event, target) {
        // If clicking a button inside the row, ignore
        if (event.target.closest('button')) return;
        
        const uuid = target.closest('[data-uuid]').dataset.uuid;
        if (!uuid) return;
        const actor = await fromUuid(uuid);
        if (actor && actor.sheet) {
            actor.sheet.render(true);
        }
    }

    async _onAddUnit(event, target) {
        event.stopPropagation();
        const row = target.closest('.eb-adversary-row');
        const uuid = row.dataset.uuid;
        const actorData = this._cachedAdversaries.find(a => a.uuid === uuid);
        
        if (actorData) {
            this.encounterList.push({
                entryId: foundry.utils.randomID(),
                ...actorData,
                hasDamageBoost: false
            });
            this.render();
        }
    }

    _onRemoveUnit(event, target) {
        event.stopPropagation();
        const entryId = target.dataset.entryid;
        this.encounterList = this.encounterList.filter(item => item.entryId !== entryId);
        this.render();
    }
}