import { MODULE_ID, SETTING_EXTRA_COMPENDIUMS, SETTING_ENCOUNTER_FOLDER, SETTING_LAST_SOURCE } from "./module.js";
import { POWERFUL_FEATURES } from "./rules.js";
import { LiveManager } from "./live-manager.js"; 

// Import DialogV2 to fix deprecation warning
const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

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
        
        // Persistent Source Filter
        this.filterSource = game.settings.get(MODULE_ID, SETTING_LAST_SOURCE) || "all";
        
        // Encounter Settings
        this.pcCount = 4;
        this.pcTier = 1;
        this.fearBudget = "1-3"; // Default Moderate
        
        // Manual Modifier States
        this.manualModifiers = {
            easier: false, 
            harder: false  
        };

        // List of added units
        this.encounterList = []; 
        
        // State for "Place on Scene" functionality
        this.lastCreatedActors = []; 
        
        // Cache
        this._cachedAdversaries = null;

        // Focus State Tracking
        this._searchFocus = false;

        // Folder Naming Mode (True = Auto Date/Time, False = Manual Prompt)
        this.useAutoFolder = true;
    }

    static DEFAULT_OPTIONS = {
        id: "daggerheart-encounter-builder",
        tag: "form",
        window: {
            title: "Encounter Builder",
            icon: "fas fa-dungeon",
            resizable: true,
            width: 1100,
            height: 750
        },
        position: { width: 1100, height: 750 },
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
            placeEncounter: EncounterBuilder.prototype._onPlaceEncounter,
            editAdversary: EncounterBuilder.prototype._onEditAdversary,
            clearEncounter: EncounterBuilder.prototype._onClearEncounter,
            toggleAutoFolder: EncounterBuilder.prototype._onToggleAutoFolder
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

    /**
     * Calculates the base cost for a given adversary type.
     */
    _getAdversaryCost(type) {
        if (!type) return 2; // Default Standard
        const t = type.toLowerCase();
        
        if (t === "minion") return "Minion"; // Special handling
        if (["social", "support"].includes(t)) return 1;
        if (["horde", "ranged", "skulk", "standard"].includes(t)) return 2;
        if (t === "leader") return 3;
        if (t === "bruiser") return 4;
        if (t === "solo") return 5;
        
        return 2; // Default fallback
    }

    /**
     * Helper to resolve display image, replacing default system icon with module specific one.
     */
    _resolveImage(img) {
        const DEFAULT_ICON = "systems/daggerheart/assets/icons/documents/actors/dragon-head.svg";
        const REPLACEMENT_ICON = "modules/daggerheart-advmanager/assets/images/skull-mini.webp";
        
        if (img === DEFAULT_ICON) {
            return REPLACEMENT_ICON;
        }
        return img;
    }

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

        // --- Inject Cost into Filtered List ---
        filtered = filtered.map(a => {
            let costVal = this._getAdversaryCost(a.type);
            
            // Minion Cost Logic: 1 point per group equal to party size (1 / pcCount)
            if (costVal === "Minion") {
                const decimalCost = 1 / Math.max(1, this.pcCount);
                // Format: "0,3" (1 decimal place, comma separator)
                costVal = decimalCost.toFixed(1).replace('.', ',');
            }

            return {
                ...a,
                cost: costVal,
                isMinionCost: a.type.toLowerCase() === "minion"
            };
        });

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

        // --- Fear Options ---
        const fearOptions = [
            { value: "0-1", label: "Low (0–1 Fear)", selected: this.fearBudget === "0-1" },
            { value: "1-3", label: "Moderate (1–3 Fear)", selected: this.fearBudget === "1-3" },
            { value: "2-4", label: "High (2–4 Fear)", selected: this.fearBudget === "2-4" },
            { value: "4-8", label: "Extreme (4–8 Fear)", selected: this.fearBudget === "4-8" },
            { value: "6-12", label: "Insane (6–12 Fear)", selected: this.fearBudget === "6-12" }
        ];

        // --- PC Count Options ---
        const pcCountOptions = [];
        for (let i = 1; i <= 10; i++) {
            pcCountOptions.push({ value: i, label: i, selected: i === this.pcCount });
        }

        // --- Calculate Tooltips for Encounter List ---
        const enrichedEncounterList = this.encounterList.map(unit => {
            const tier = unit.tier || 1;
            let die = "1d4";
            if (tier === 2) die = "1d6";
            else if (tier === 3) die = "1d8";
            else if (tier >= 4) die = "1d10";
            
            return {
                ...unit,
                damageBoostTooltip: `Add +${die} Damage (Lowers Budget Limit)`
            };
        });

        // --- Synergy Checks ---
        const synergy = {
            summoner: false,
            spotlighter: false,
            momentum: false,
            relentless: false
        };

        this.encounterList.forEach(unit => {
            const features = unit.specialFeatures || [];
            if (features.includes("Summoner")) synergy.summoner = true;
            if (features.includes("Spotlighter")) synergy.spotlighter = true;
            if (features.includes("Momentum") || features.includes("Terrifying")) {
                synergy.momentum = true;
            }
            // UPDATED: Check for simple "Relentless" string now
            if (features.includes("Relentless")) synergy.relentless = true;
        });

        // --- Budget Calculation ---
        const bpData = this._calculateBP();

        // --- Determine Skull Image ---
        let skullImg = "";
        switch (bpData.difficultyLabel) {
            case "Very Easy": skullImg = "modules/daggerheart-advmanager/assets/images/skull-very-easy.webp"; break;
            case "Easy": skullImg = "modules/daggerheart-advmanager/assets/images/skull-easy.webp"; break;
            case "Balanced": skullImg = "modules/daggerheart-advmanager/assets/images/skull-balanced.webp"; break;
            case "Challenging": skullImg = "modules/daggerheart-advmanager/assets/images/skull-challenging.webp"; break;
            case "Hard": skullImg = "modules/daggerheart-advmanager/assets/images/skull-hard.webp"; break;
            case "Deadly": skullImg = "modules/daggerheart-advmanager/assets/images/skull-deadly.webp"; break;
            case "Out of Tier": skullImg = "modules/daggerheart-advmanager/assets/images/skull-deadly.webp"; break;
            default: skullImg = "modules/daggerheart-advmanager/assets/images/skull-balanced.webp";
        }

        bpData.skullImage = skullImg;

        return {
            adversaries: filtered,
            encounterList: enrichedEncounterList, 
            tiers,
            typeOptions,
            sourceOptions,
            fearOptions,
            pcCountOptions,
            searchQuery: this.searchQuery,
            resultCount: filtered.length,
            
            // New Encounter Counter
            encounterCount: this.encounterList.length,
            
            // BP Data
            pcCount: this.pcCount,
            pcTier: this.pcTier,
            pcTierOptions: [1, 2, 3, 4].map(t => ({ value: t, label: `Tier ${t}`, selected: t === this.pcTier })),
            bpData: bpData,
            manualModifiers: this.manualModifiers,
            
            // UI State
            hasCreatedActors: this.lastCreatedActors.length > 0,
            
            // Synergy Flags
            synergy: synergy,

            // Folder Mode State (NEW)
            useAutoFolder: this.useAutoFolder,
            autoFolderTooltip: this.useAutoFolder ? "Mode: Auto-Generate Folder Name" : "Mode: Manual Folder Name"
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
        let outOfTier = false;

        // Synergy Detection vars
        let hasSummoner = false;
        let hasSpotlighter = false;
        let hasMomentum = false;
        let hasRelentless = false;
        let hasTerrifying = false;

        this.encounterList.forEach(unit => {
            const type = unit.type;

            // Check Tier Mismatch
            if (unit.tier > this.pcTier) {
                outOfTier = true;
            }

            // Synergy Check
            const feats = unit.specialFeatures || [];
            if (feats.includes("Summoner")) hasSummoner = true;
            if (feats.includes("Spotlighter")) hasSpotlighter = true;
            if (feats.includes("Momentum")) hasMomentum = true;
            if (feats.includes("Terrifying")) hasTerrifying = true;
            // UPDATED: Check for simple "Relentless" string
            if (feats.includes("Relentless")) hasRelentless = true;

            // Cost Calculation
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

        if (this.manualModifiers.easier) {
            limit -= 1;
            modifiers.push({ label: "Easier/Shorter", val: "-1", active: true, manual: true, key: 'easier' });
        } else {
            modifiers.push({ label: "Easier/Shorter", val: "-1", active: false, manual: true, key: 'easier' });
        }

        if (soloCount >= 2) {
            limit -= 2;
            modifiers.push({ label: "2+ Solos", val: "-2", active: true, manual: false });
        } else {
            modifiers.push({ label: "2+ Solos", val: "-2", active: false, manual: false, disabled: true });
        }

        if (hasDamageBoost) {
            limit -= 2;
            modifiers.push({ label: "Damage Boost", val: "-2", active: true, manual: false });
        } else {
            modifiers.push({ label: "Damage Boost", val: "-2", active: false, manual: false, disabled: true });
        }

        if (hasLowerTier) {
            limit += 1;
            modifiers.push({ label: "Lower Tier Used", val: "+1", active: true, manual: false });
        } else {
            modifiers.push({ label: "Lower Tier Used", val: "+1", active: false, manual: false, disabled: true });
        }

        if (this.encounterList.length > 0 && !hasSpecialType) {
            limit += 1;
            modifiers.push({ label: "No Major Adversaries", val: "+1", active: true, manual: false });
        } else {
            modifiers.push({ label: "No Major Adversaries", val: "+1", active: false, manual: false, disabled: true });
        }

        if (this.manualModifiers.harder) {
            limit += 2;
            modifiers.push({ label: "Harder/Longer", val: "+2", active: true, manual: true, key: 'harder' });
        } else {
            modifiers.push({ label: "Harder/Longer", val: "+2", active: false, manual: true, key: 'harder' });
        }

        const diff = currentCost - limit;
        
        let level = 2; // Default Balanced

        // --- Difficulty Thresholds ---
        if (diff <= -5) level = 0;      // Very Easy
        else if (diff <= -2) level = 1; // Easy
        else if (diff >= -1 && diff <= 1) level = 2; // Balanced
        else if (diff >= 2 && diff < 4) level = 3;   // Challenging
        else if (diff >= 4 && diff < 6) level = 4;   // Hard
        else if (diff >= 6) level = 5;               // Deadly

        // --- Apply Fear Shift ---
        let shift = 0;
        
        if (this.fearBudget === "0-1") shift = -1;
        else if (this.fearBudget === "2-4") shift = 1;
        else if (this.fearBudget === "4-8" || this.fearBudget === "6-12") shift = 2;

        // --- Apply Synergy Shift ---
        if (hasSummoner && hasSpotlighter) {
            shift += 1;
        }

        if (hasRelentless && (hasMomentum || hasTerrifying)) {
            shift += 1;
        }

        level = Math.max(0, Math.min(5, level + shift));

        let difficultyLabel = "Balanced";
        let difficultyClass = "diff-balanced";

        switch (level) {
            case 0: difficultyLabel = "Very Easy"; difficultyClass = "diff-very-easy"; break;
            case 1: difficultyLabel = "Easy"; difficultyClass = "diff-easy"; break;
            case 2: difficultyLabel = "Balanced"; difficultyClass = "diff-balanced"; break;
            case 3: difficultyLabel = "Challenging"; difficultyClass = "diff-challenging"; break;
            case 4: difficultyLabel = "Hard"; difficultyClass = "diff-deadly"; break;
            case 5: difficultyLabel = "Deadly"; difficultyClass = "diff-deadly"; break;
        }

        if (outOfTier) {
            difficultyLabel = "Out of Tier";
            difficultyClass = "diff-deadly";
        }

        const statusColor = (currentCost > limit) ? "red" : (currentCost === limit ? "green" : "gold");

        return {
            base: baseBP,
            total: limit,
            cost: currentCost,
            remaining: limit - currentCost,
            modifiers: modifiers,
            statusColor: statusColor,
            difficultyLabel: difficultyLabel,
            difficultyClass: difficultyClass
        };
    }

    // ... (rest of the file remains unchanged)
    
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
        const specialFeatures = [];
        if (actor.items) {
            const allFeatureNames = actor.items.map(i => i.name);

            if (allFeatureNames.includes("Momentum")) specialFeatures.push("Momentum");
            if (allFeatureNames.includes("Terrifying")) specialFeatures.push("Terrifying");
            const relentless = actor.items.find(i => i.name.startsWith("Relentless"));
            // UPDATED: Push only the string "Relentless" instead of the full name
            if (relentless) specialFeatures.push("Relentless");

            if (allFeatureNames.some(name => POWERFUL_FEATURES.summoner.includes(name))) {
                specialFeatures.push("Summoner");
            }

            if (allFeatureNames.some(name => POWERFUL_FEATURES.spotlighter.includes(name))) {
                specialFeatures.push("Spotlighter");
            }
        }

        return {
            uuid: actor.uuid,
            id: actor.id,
            name: actor.name,
            tier: Number(actor.system.tier) || 1,
            type: (actor.system.type || "standard").toLowerCase(),
            img: this._resolveImage(actor.img),
            isCompendium: false,
            packId: null,
            specialFeatures: specialFeatures 
        };
    }

    _formatIndexData(indexEntry, packId) {
        return {
            uuid: indexEntry.uuid,
            id: indexEntry._id,
            name: indexEntry.name,
            tier: Number(indexEntry.system?.tier) || 1,
            type: (indexEntry.system?.type || "standard").toLowerCase(),
            img: this._resolveImage(indexEntry.img),
            isCompendium: true,
            packId: packId,
            specialFeatures: [] 
        };
    }

    /**
     * Executes the creation logic.
     * @param {string|null} customName - Optional custom folder name override.
     */
    async _executeCreateEncounter(customName = null) {
        if (this.encounterList.length === 0) {
            ui.notifications.warn("No adversaries in the encounter to create.");
            return [];
        }

        const featurePackId = "daggerheart-advmanager.custom-features";
        const featurePack = game.packs.get(featurePackId);
        let featureIndex = null;
        if (featurePack) {
            featureIndex = await featurePack.getIndex();
        }

        const rootName = game.settings.get(MODULE_ID, SETTING_ENCOUNTER_FOLDER) || "💀 My Encounters";
        
        // Ensure Root Folder Exists
        let rootFolder = game.folders.find(f => f.name === rootName && f.type === "Actor");
        if (!rootFolder) {
            rootFolder = await Folder.create({ name: rootName, type: "Actor", color: "#430047" });
        }

        let baseName;

        if (customName) {
            // Manual Mode: Use the custom name as base
            baseName = customName;
        } else {
            // Auto Mode: Tier/BP - Date Time
            const now = new Date();
            const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
            const dateString = now.toLocaleDateString().replace(/\//g, '-');
            
            let totalTier = 0;
            const bpData = this._calculateBP(); 
            const currentBP = bpData.cost;
            
            this.encounterList.forEach(u => totalTier += (u.tier || 1));
            const avgTier = this.encounterList.length > 0 ? Math.round(totalTier / this.encounterList.length) : 1;

            // UPDATED: New Format T{Tier}/BP{Cost} - {Date} {Time}
            baseName = `T${avgTier}/BP${currentBP} - ${dateString} ${timeString}`; 
        }
        
        // --- UNIQUE NAME GENERATION LOGIC ---
        // Ensure unique folder name to prevent merging
        let finalName = baseName;
        let counter = 1;

        const folderExists = (name) => {
            return game.folders.some(f => 
                f.type === "Actor" && 
                f.folder?.id === rootFolder.id && 
                f.name === name
            );
        };

        while (folderExists(finalName)) {
            finalName = `${baseName} (${counter})`;
            counter++;
        }

        // Create the new folder
        const subFolder = await Folder.create({ 
            name: finalName, 
            type: "Actor", 
            folder: rootFolder.id, 
            color: "#9c27b0" 
        });

        const createdActors = [];

        // Iterate and Create Actors
        for (const unit of this.encounterList) {
            try {
                const originalActor = await fromUuid(unit.uuid);
                if (!originalActor) {
                    console.warn(`Daggerheart AdvManager | Could not find actor with UUID: ${unit.uuid}`);
                    continue;
                }

                let createdActor;
                if (originalActor.compendium) {
                    // Method 1: Robust Copy via toObject (Works reliably in V13)
                    const data = originalActor.toObject();
                    delete data._id; // Ensure new ID
                    data.folder = subFolder.id;
                    createdActor = await Actor.create(data);
                } else {
                    // Method 2: Clone for World Actors
                    createdActor = await originalActor.clone({ 
                        folder: subFolder.id 
                    }, { save: true });
                }

                if (createdActor) {
                    // Apply Damage Boost Feature if needed
                    if (unit.hasDamageBoost && featurePack && featureIndex) {
                        const tier = unit.tier || 1;
                        let featureName = "More Damage (1d4)";

                        if (tier === 2) featureName = "More Damage (1d6)";
                        else if (tier === 3) featureName = "More Damage (1d8)";
                        else if (tier >= 4) featureName = "More Damage (1d10)";

                        const entry = featureIndex.find(i => i.name === featureName);
                        
                        if (entry) {
                            const itemDoc = await featurePack.getDocument(entry._id);
                            if (itemDoc) {
                                await createdActor.createEmbeddedDocuments("Item", [itemDoc.toObject()]);
                            }
                        }
                    }

                    createdActors.push(createdActor);
                }
            } catch (err) {
                console.error("Daggerheart AdvManager | Error creating actor:", err);
            }
        }
        
        return { actors: createdActors, folderName: `${rootName}/${finalName}` };
    }

    /**
     * Helper: Determines folder name based on mode (auto vs manual prompt).
     * Returns the name string, null (for auto), or false (cancelled).
     */
    async _getFolderNameOrCancel() {
        if (this.useAutoFolder) return null; // Use auto name logic

        // Manual Mode: Prompt via DialogV2 with safe ID-based input retrieval
        const inputId = `dh-folder-name-${foundry.utils.randomID()}`;
        
        try {
            const result = await DialogV2.prompt({
                window: { title: "Encounter Name" },
                content: `
                    <div style="margin-bottom: 10px;">
                        <label style="display: block; font-weight: bold; margin-bottom: 5px;" for="${inputId}">Folder Name:</label>
                        <input type="text" id="${inputId}" placeholder="e.g., Boss Fight Room 3" autofocus required 
                               style="width: 100%; box-sizing: border-box; padding: 5px; background: #222; color: #fff; border: 1px solid #777;"/>
                    </div>
                `,
                ok: {
                    label: "Create",
                    icon: "fas fa-check",
                    callback: (event, button, dialog) => {
                        const input = document.getElementById(inputId);
                        return input ? input.value : "Untitled Encounter";
                    }
                },
                rejectClose: false
            });

            return result || false; 
        } catch (e) {
            // User closed/cancelled
            return false;
        }
    }

    async _onCreateEncounter(event, target) {
        event.preventDefault();

        // Get Name or Auto status
        const folderName = await this._getFolderNameOrCancel();
        
        // If false, it means manual mode was active and user cancelled
        if (folderName === false && !this.useAutoFolder) return;

        try {
            const result = await this._executeCreateEncounter(folderName);
            if (result && result.actors && result.actors.length > 0) {
                this.lastCreatedActors = result.actors;
                ui.notifications.info(`Encounter created in: "${result.folderName}". Check the Actor directory.`);
            }
        } catch (err) {
            console.error(err);
            ui.notifications.error("Failed to create encounter. Check console.");
        }
    }

    async _onPlaceEncounter(event, target) {
        event.preventDefault();

        // Get Name or Auto status (Same logic as Create)
        const folderName = await this._getFolderNameOrCancel();
        
        // If false, it means manual mode was active and user cancelled
        if (folderName === false && !this.useAutoFolder) return;

        try {
            const result = await this._executeCreateEncounter(folderName);
            if (!result || !result.actors || result.actors.length === 0) return; 
            
            const created = result.actors;
            this.lastCreatedActors = created; 
            
            const scene = canvas.scene;
            if (!scene) {
                ui.notifications.warn("No active scene to place tokens.");
                return;
            }

            const tokensData = [];
            const centerX = canvas.stage.pivot.x;
            const centerY = canvas.stage.pivot.y;
            const gridSize = canvas.grid.size;
            
            const cols = Math.ceil(Math.sqrt(created.length));
            
            for (let i = 0; i < created.length; i++) {
                const actor = created[i];
                const col = i % cols;
                const row = Math.floor(i / cols);
                
                const x = centerX + (col * gridSize);
                const y = centerY + (row * gridSize);

                const protoToken = await actor.getTokenDocument();
                const tokenData = protoToken.toObject();
                
                tokenData.x = x;
                tokenData.y = y;
                tokenData.hidden = true; 

                tokensData.push(tokenData);
            }

            await scene.createEmbeddedDocuments("Token", tokensData);
            ui.notifications.info(`Encounter created and ${created.length} tokens placed on scene (Hidden).`);
            
        } catch (err) {
            console.error(err);
            ui.notifications.error("Failed to place encounter. Check console.");
        }
    }

    async _onEditAdversary(event, target) {
        event.stopPropagation();
        const uuid = target.closest('[data-uuid]').dataset.uuid;
        if (!uuid) return;
        const actor = await fromUuid(uuid);
        if (actor) {
            new LiveManager({ actor: actor }).render(true);
        }
    }

    // NEW METHOD: Clear Encounter
    _onClearEncounter(event, target) {
        event.preventDefault();
        this.encounterList = [];
        this.render();
    }

    // NEW ACTION HANDLER: Toggle Auto Folder
    _onToggleAutoFolder(event, target) {
        event.preventDefault();
        this.useAutoFolder = !this.useAutoFolder;
        this.render();
    }

    /* --- Event Listeners --- */

    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;

        const searchInput = html.querySelector('.eb-search-input');
        if (searchInput) {
            if (this._searchFocus) {
                searchInput.focus();
                const len = searchInput.value.length;
                searchInput.setSelectionRange(len, len);
                this._searchFocus = false;
            }
            searchInput.addEventListener('input', (e) => this._onSearch(e));
        }

        const typeSelect = html.querySelector('.eb-type-select');
        if (typeSelect) typeSelect.addEventListener('change', (e) => this._onFilterType(e));

        const sourceSelect = html.querySelector('.eb-source-select');
        if (sourceSelect) sourceSelect.addEventListener('change', (e) => this._onFilterSource(e));
        
        const pcCountInput = html.querySelector('.pc-count-select');
        if (pcCountInput) pcCountInput.addEventListener('change', (e) => this._onUpdatePCSettings(e));
        
        const pcTierSelect = html.querySelector('.pc-tier-select');
        if (pcTierSelect) pcTierSelect.addEventListener('change', (e) => this._onUpdatePCSettings(e));

        const fearSelect = html.querySelector('.pc-fear-select');
        if (fearSelect) fearSelect.addEventListener('change', (e) => this._onUpdatePCSettings(e));

        const encounterItems = html.querySelectorAll('.eb-encounter-item');
        encounterItems.forEach(item => {
            item.setAttribute('draggable', 'true');
            item.addEventListener('dragstart', this._onDragStart.bind(this));
        });

        // Drop zone for actors and folders
        const encounterList = html.querySelector('.eb-encounter-list');
        if (encounterList) {
            encounterList.addEventListener('dragover', (e) => {
                e.preventDefault();
                encounterList.classList.add('drop-highlight');
            });
            encounterList.addEventListener('dragleave', (e) => {
                encounterList.classList.remove('drop-highlight');
            });
            encounterList.addEventListener('drop', (e) => {
                e.preventDefault();
                encounterList.classList.remove('drop-highlight');
                this._onDropActor(e);
            });
        }
    }

    _onDragStart(event) {
        const item = event.target.closest('.eb-encounter-item');
        const uuid = item.dataset.uuid;
        if (!uuid) return;
        const dragData = {
            type: "Actor",
            uuid: uuid
        };
        event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
    }

    _onSearch(event) {
        event.preventDefault();
        this.searchQuery = event.target.value;
        this._searchFocus = true; 
        this.render();
    }

    _onFilterType(event) {
        event.preventDefault();
        this.filterType = event.target.value;
        this.render();
    }

    async _onFilterSource(event) {
        event.preventDefault();
        this.filterSource = event.target.value;
        await game.settings.set(MODULE_ID, SETTING_LAST_SOURCE, this.filterSource);
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
        
        const count = parseInt(html.querySelector('.pc-count-select').value) || 4;
        const tier = parseInt(html.querySelector('.pc-tier-select').value) || 1;
        const fear = html.querySelector('.pc-fear-select').value || "0-1";

        this.pcCount = Math.max(1, Math.min(10, count));
        this.pcTier = tier;
        this.fearBudget = fear;
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
            // Retrieve Features (Momentum, Relentless, Summoner, Spotlighter)
            const actor = await fromUuid(uuid);
            const specialFeatures = [];
            const allFeatureNames = []; // Used to check synergy keywords

            if (actor && actor.items) {
                actor.items.forEach(i => allFeatureNames.push(i.name));

                if (allFeatureNames.includes("Momentum")) {
                    specialFeatures.push("Momentum");
                }
                if (allFeatureNames.includes("Terrifying")) { 
                    specialFeatures.push("Terrifying");
                }
                const relentless = actor.items.find(i => i.name.startsWith("Relentless"));
                // UPDATED: Push only "Relentless" string
                if (relentless) {
                    specialFeatures.push("Relentless");
                }
                
                // Check Summoner
                if (allFeatureNames.some(name => POWERFUL_FEATURES.summoner.includes(name))) {
                    specialFeatures.push("Summoner");
                }

                // Check Spotlighter
                if (allFeatureNames.some(name => POWERFUL_FEATURES.spotlighter.includes(name))) {
                    specialFeatures.push("Spotlighter");
                }
            }

            this.encounterList.push({
                entryId: foundry.utils.randomID(),
                ...actorData,
                hasDamageBoost: false,
                specialFeatures: specialFeatures 
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

    /**
     * Handle drop events for actors and folders from the Foundry directory.
     */
    async _onDropActor(event) {
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }

        // Handle Actor drop
        if (data.type === "Actor") {
            const actor = await fromUuid(data.uuid);
            if (actor) {
                await this._addActorToEncounter(actor);
            }
        }

        // Handle Folder drop
        if (data.type === "Folder") {
            const folder = await fromUuid(data.uuid);
            if (folder && folder.type === "Actor") {
                // Get all actors in this folder (including subfolders)
                const actors = this._getActorsFromFolder(folder);
                for (const actor of actors) {
                    await this._addActorToEncounter(actor);
                }
            }
        }

        this.render();
    }

    /**
     * Recursively get all actors from a folder and its subfolders.
     */
    _getActorsFromFolder(folder) {
        let actors = [];

        // Get actors directly in this folder
        const folderActors = game.actors.filter(a => a.folder?.id === folder.id);
        actors.push(...folderActors);

        // Get actors from subfolders
        const subfolders = game.folders.filter(f => f.type === "Actor" && f.folder?.id === folder.id);
        for (const subfolder of subfolders) {
            actors.push(...this._getActorsFromFolder(subfolder));
        }

        return actors;
    }

    /**
     * Add a single actor to the encounter list (if it's a valid adversary).
     */
    async _addActorToEncounter(actor) {
        // Only add adversary type actors
        if (actor.type !== "adversary") {
            return;
        }

        // Collect special features
        const specialFeatures = [];
        const allFeatureNames = [];

        if (actor.items) {
            actor.items.forEach(i => allFeatureNames.push(i.name));

            if (allFeatureNames.includes("Momentum")) {
                specialFeatures.push("Momentum");
            }
            if (allFeatureNames.includes("Terrifying")) {
                specialFeatures.push("Terrifying");
            }
            const relentless = actor.items.find(i => i.name.startsWith("Relentless"));
            if (relentless) {
                specialFeatures.push("Relentless");
            }

            // Check Summoner
            if (allFeatureNames.some(name => POWERFUL_FEATURES.summoner.includes(name))) {
                specialFeatures.push("Summoner");
            }

            // Check Spotlighter
            if (allFeatureNames.some(name => POWERFUL_FEATURES.spotlighter.includes(name))) {
                specialFeatures.push("Spotlighter");
            }
        }

        this.encounterList.push({
            entryId: foundry.utils.randomID(),
            uuid: actor.uuid,
            id: actor.id,
            name: actor.name,
            tier: Number(actor.system.tier) || 1,
            type: (actor.system.type || "standard").toLowerCase(),
            img: this._resolveImage(actor.img),
            isCompendium: false,
            packId: null,
            hasDamageBoost: false,
            specialFeatures: specialFeatures
        });
    }
}