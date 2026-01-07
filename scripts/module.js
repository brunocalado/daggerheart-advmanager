import { Manager } from "./manager.js"; 
import { LiveManager } from "./live-manager.js";
import { CompendiumManager } from "./compendium-manager.js";
import { CompendiumStats } from "./compendium-stats.js";
import { DiceProbability } from "./dice-probability.js";
import { EncounterBuilder } from "./encounter-builder.js";
import { FeatureUpdater } from "./feature-updater.js"; // <--- Import Nova Classe

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// --- Settings Constants ---
export const MODULE_ID = "daggerheart-advmanager";
export const SETTING_CHAT_LOG = "enableChatLog";
export const SETTING_UPDATE_EXP = "autoUpdateExperiences";
export const SETTING_ADD_FEATURES = "autoAddFeatures";
export const SETTING_SUGGEST_FEATURES = "enableFeatureSuggestions"; 
export const SETTING_IMPORT_FOLDER = "importFolderName";
export const SETTING_ENCOUNTER_FOLDER = "encounterFolderName";
export const SETTING_EXTRA_COMPENDIUMS = "extraCompendiums";
export const SETTING_FEATURE_COMPENDIUMS = "featureCompendiums";
export const SETTING_STATS_COMPENDIUMS = "statsCompendiums";
export const SKULL_IMAGE_PATH = "modules/daggerheart-advmanager/assets/images/skull.webp";

// Settings for Persistence (Client Side - Per User)
export const SETTING_LAST_SOURCE = "lastSource";
export const SETTING_LAST_FILTER_TIER = "lastFilterTier";

// --- Import Logic Constants ---

// Items that should ALWAYS be imported, even if they exist in the folder
const ALWAYS_DUPLICATE = [
    "Scapegoat",
    "From Above",
    "Mind Dance",
    "Hallucinatory Breath",
    "Doombringer",
    "Death Quake",
    "Trample"
];

// Colors for Daggerheart Adversary Types folders
const TYPE_COLORS = {
    "Bruiser": "#4a0404",      // Deep Blood Red
    "Horde": "#0f3d0f",        // Dark Forest Green
    "Leader": "#5c4905",       // Dark Bronze/Brown
    "Minion": "#2f3f4f",       // Dark Slate
    "Ranged": "#002366",       // Navy Blue
    "Skulk": "#1a0033",        // Deep Indigo/Black
    "Social": "#660033",       // Deep Maroon/Pink
    "Solo": "#000000",         // Black
    "Standard": "#3b1e08",     // Dark Chocolate
    "Support": "#004d40",      // Deep Teal
    "Unknown": "#333333"       // Dark Gray
};

// --- Main Logic ---

function manage() {
    const tokens = canvas.tokens.controlled;
    
    // 1. Strict Check for Broken Links
    const brokenToken = tokens.find(t => {
        const actorId = t.document.actorId;
        if (actorId && !game.actors.has(actorId)) return true;
        if (!t.actor) return true;
        return false;
    });

    if (brokenToken) {
        ui.notifications.error(`Error: The token "${brokenToken.name}" references an Actor that no longer exists in the directory.`);
        return;
    }

    // 2. Filter valid Adversary actors
    const validActors = tokens
        .map(t => t.actor)
        .filter(a => a && a.type === "adversary");

    // CHECK FOR EXISTING WINDOW
    const existingApp = Object.values(ui.windows).find(w => w.id === "daggerheart-live-preview");
    
    if (existingApp) {
        if (validActors.length === 1) {
            existingApp.updateSelectedActor(validActors[0]);
        }
        existingApp.render(true, { focus: true });
        return;
    }

    if (validActors.length === 0) {
        new LiveManager().render(true);
    } else if (validActors.length === 1) {
        new LiveManager({ actor: validActors[0] }).render(true);
    } else {
        new Manager({ actors: validActors }).render(true);
    }
}

/**
 * Imports features from a Compendium into organized folders in the Items directory.
 * @param {string} compendiumId - The ID of the compendium source (e.g., "daggerheart.adversaries").
 * @param {string} rootFolderName - The name of the root folder to create/use in Items directory.
 * @param {string} customTag - The tag to apply to the 'importedFrom.customTag' flag (e.g., "Core", "Void").
 */
async function importFeatures(compendiumId, rootFolderName, customTag) {
    console.log(`Daggerheart Manager | Starting import from ${compendiumId} to folder "${rootFolderName}" with tag "${customTag}"...`);
    ui.notifications.info(`Starting Adversary Features import from ${compendiumId}...`);

    const pack = game.packs.get(compendiumId);
    if (!pack) {
        const msg = `Compendium "${compendiumId}" not found.`;
        ui.notifications.error(msg);
        console.error(msg);
        return;
    }

    // Ensure we are working with an Actor compendium
    if (pack.documentName !== "Actor") {
        ui.notifications.error(`Compendium "${compendiumId}" is not an Actor compendium.`);
        return;
    }

    // Helper: Capitalize string
    const capitalize = (str) => {
        if (!str) return "";
        return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    };

    // 1. Create or Find Main Folder
    let mainFolder = game.folders.find(f => f.name === rootFolderName && f.type === "Item");
    
    if (!mainFolder) {
        console.log(`Creating main folder "${rootFolderName}"...`);
        mainFolder = await Folder.create({
            name: rootFolderName,
            type: "Item",
            color: "#000000",
            sorting: "a"
        });
    }

    const folderCache = {};

    // Helper: Get or Create Subfolder with caching
    async function getOrCreateFolder(folderName, parentFolderId, colorCode = null) {
        const cacheKey = `${parentFolderId}-${folderName}`;
        if (folderCache[cacheKey]) return folderCache[cacheKey];

        let folder = game.folders.find(f => 
            f.name === folderName && 
            f.type === "Item" && 
            f.folder?.id === parentFolderId
        );

        if (!folder) {
            folder = await Folder.create({
                name: folderName,
                type: "Item",
                folder: parentFolderId,
                color: colorCode,
                sorting: "a"
            });
        }

        folderCache[cacheKey] = folder;
        return folder;
    }

    // Helper: Determine category based on feature form
    function getFeatureCategory(item) {
        const form = String(item.system?.featureForm || "").toLowerCase().trim();
        if (form.includes("reaction")) return "Reaction";
        if (form.includes("action")) return "Action";
        return "Passive";
    }

    // Helper: Create individual item
    async function createItemInFolder(itemDoc, folderObj, sourceName, sourceTier, sourceType) {
        try {
            const iName = itemDoc.name;
            const iType = itemDoc.type;

            // Check duplicate exceptions
            const isSpecialCase = ALWAYS_DUPLICATE.includes(iName);

            // Duplicate check within the specific folder
            if (!isSpecialCase) {
                const existing = game.items.find(i => 
                    i.name === iName && 
                    i.type === iType && 
                    i.folder?.id === folderObj.id
                );

                if (existing) return false; 
            }

            // Prepare Data
            const itemData = itemDoc.toObject();
            
            // Construct creation data
            const creationData = {
                name: iName,
                type: iType,
                img: itemData.img || "icons/svg/item-bag.svg",
                system: itemData.system,
                folder: folderObj.id, 
                effects: itemData.effects, // Keep effects
                flags: {
                    importedFrom: {
                        compendium: compendiumId,
                        adversary: sourceName,
                        tier: sourceTier,
                        type: sourceType,
                        customTag: customTag, // The requested custom tag
                        originalId: itemData._id,
                        isSpecialCase: isSpecialCase 
                    }
                }
            };

            await Item.create(creationData);
            return true;

        } catch (err) {
            console.error(`Error creating item "${itemDoc.name}":`, err);
            return false;
        }
    }

    // 2. Load Documents
    const adversaries = await pack.getDocuments();
    console.log(`Found ${adversaries.length} adversaries in ${compendiumId}...`);

    let totalCreated = 0;
    let skippedCount = 0;

    // 3. Process Adversaries
    for (const adversary of adversaries) {
        if (adversary.type !== "adversary") continue;

        const rawType = adversary.system?.type || "Standard";
        const advType = capitalize(rawType); 
        const tier = Number(adversary.system?.tier) || 0; 

        // Get/Create Type Folder
        const typeColor = TYPE_COLORS[advType] || TYPE_COLORS["Unknown"];
        const typeFolder = await getOrCreateFolder(advType, mainFolder.id, typeColor);

        // Process Items
        for (const item of adversary.items) {
            const categoryName = getFeatureCategory(item);
            const categoryFolder = await getOrCreateFolder(categoryName, typeFolder.id);

            const created = await createItemInFolder(item, categoryFolder, adversary.name, tier, advType);
            
            if (created) totalCreated++;
            else skippedCount++;
        }
    }

    // Final Report
    console.log(`--- IMPORT FINISHED ---`);
    console.log(`Total Created: ${totalCreated}`);
    console.log(`Total Skipped: ${skippedCount}`);

    ui.notifications.info(`Import complete! Created: ${totalCreated} items. See console for details.`);

    // Expand main folder in directory
    if (mainFolder) {
        setTimeout(() => {
            const folderElement = document.querySelector(`.directory-item.folder[data-folder-id="${mainFolder.id}"]`);
            if (folderElement) folderElement.classList.remove("collapsed");
        }, 500);
    }
}

// --- Init & Hooks ---

Hooks.once("init", () => {
    game.settings.register(MODULE_ID, SETTING_CHAT_LOG, {
        name: "Log Changes to Chat",
        hint: "If enabled, sends a whisper to the GM whenever an Adversary is updated via the Manager.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, SETTING_UPDATE_EXP, {
        name: "Auto-Update Experiences",
        hint: "If enabled, experiences will increase/decrease by 1 for each Tier change.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, SETTING_ADD_FEATURES, {
        name: "Auto-Add Features on Tier Up",
        hint: "If enabled, randomly suggests adding features when leveling up.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, SETTING_SUGGEST_FEATURES, {
        name: "Enable Suggested Features",
        hint: "If enabled, shows the 'New Suggested Features' section in the Live Manager preview.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, SETTING_IMPORT_FOLDER, {
        name: "Compendium Import Folder",
        hint: "Name of the folder where adversaries imported from Compendiums will be created.",
        scope: "world",
        config: true,
        type: String,
        default: "💀 Imported Adversaries"
    });

    game.settings.register(MODULE_ID, SETTING_ENCOUNTER_FOLDER, {
        name: "Encounter Folder Name",
        hint: "Name of the root folder where encounters created by the builder will be stored.",
        scope: "world",
        config: true,
        type: String,
        default: "💀 My Encounters"
    });

    game.settings.register(MODULE_ID, SETTING_EXTRA_COMPENDIUMS, {
        name: "Extra Compendiums (Actors)",
        scope: "world",
        config: false,
        type: Array,
        default: []
    });

    game.settings.register(MODULE_ID, SETTING_FEATURE_COMPENDIUMS, {
        name: "Feature Compendiums",
        scope: "world",
        config: false,
        type: Array,
        default: []
    });

    // --- REGISTRO DA CONFIGURAÇÃO DE STATS ---
    game.settings.register(MODULE_ID, SETTING_STATS_COMPENDIUMS, {
        name: "Stats Compendiums",
        scope: "world",
        config: false,
        type: Array,
        default: []
    });

    // --- Persistence Settings (Client Scope) ---
    game.settings.register(MODULE_ID, SETTING_LAST_SOURCE, {
        scope: "client",
        config: false,
        type: String,
        default: "world"
    });

    game.settings.register(MODULE_ID, SETTING_LAST_FILTER_TIER, {
        scope: "client",
        config: false,
        type: String,
        default: "all"
    });
});

Hooks.once("ready", () => {
    // Expose API globally
    globalThis.AM = {
        Manage: manage, 
        LiveManager: () => new LiveManager().render(true),
        CompendiumManager: () => new CompendiumManager().render(true),
        CompendiumStats: () => new CompendiumStats().render(true),
        DiceProbability: () => new DiceProbability().render(true),
        EncounterBuilder: () => new EncounterBuilder().render(true),
        ImportFeatures: importFeatures, 
        UpdateFeatures: () => new FeatureUpdater().render(true) // <--- Exposed New Functionality
    };
    console.log("Adversary Manager | Ready. Use AM.Manage() to start.");
});

Hooks.on("controlToken", (token, controlled) => {
    if (!controlled) return;
    const tokens = canvas.tokens.controlled;
    if (tokens.length !== 1) return;
    const actor = tokens[0].actor;
    if (!actor || actor.type !== "adversary") return;

    const app = Object.values(ui.windows).find(w => w.id === "daggerheart-live-preview");
    if (app) {
        app.updateSelectedActor(actor);
    }
});

Hooks.on("renderDaggerheartMenu", (app, html) => {
    const element = (html instanceof HTMLElement) ? html : html[0];
    
    const createBtn = (text, icon, onClick) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.innerHTML = `<i class="fas ${icon}"></i> ${text}`;
        btn.classList.add("dh-adv-btn"); 
        btn.style.marginTop = "5px";
        btn.style.width = "100%";
        btn.onclick = (e) => { e.preventDefault(); onClick(); };
        return btn;
    };

    const btnManage = createBtn("Manage Adversaries", "fa-skull", manage);
    const btnStats = createBtn("Compendium Stats", "fa-chart-pie", () => new CompendiumStats().render(true));
    const btnProb = createBtn("Dice Probability", "fa-dice-d20", () => new DiceProbability().render(true));
    const btnBuilder = createBtn("Encounter Builder", "fa-dungeon", () => new EncounterBuilder().render(true));

    const fieldset = element.querySelector("fieldset");
    if (fieldset) {
        const newFieldset = document.createElement("fieldset");
        const legend = document.createElement("legend");
        legend.innerText = "Adversary Tools";
        newFieldset.appendChild(legend);
        newFieldset.appendChild(btnManage);
        newFieldset.appendChild(btnBuilder);
        newFieldset.appendChild(btnStats);
        newFieldset.appendChild(btnProb); 
        fieldset.after(newFieldset);
    } else {
        element.appendChild(btnManage);
        element.appendChild(btnBuilder);
        element.appendChild(btnStats);
        element.appendChild(btnProb);
    }
});

Hooks.on("renderActorDirectory", (app, html) => {
    const element = (html instanceof HTMLElement) ? html : html[0];
    const actionButtons = element.querySelector(".header-actions");
    
    if (actionButtons) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.classList.add("create-actor");
        btn.style.flex = "0 0 100%";
        btn.style.maxWidth = "100%";
        btn.style.marginTop = "6px";
        btn.innerHTML = `<i class="fas fa-skull"></i> Manage Adversaries`;
        
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            manage();
        });

        actionButtons.appendChild(btn);
    }
});