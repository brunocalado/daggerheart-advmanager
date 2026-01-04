import { MODULE_ID, SETTING_STATS_COMPENDIUMS } from "./module.js";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Simplified manager for Compendium Stats sources.
 * Allows selecting Actor compendiums and defining import settings.
 */
export class CompendiumStatsManager extends HandlebarsApplicationMixin(ApplicationV2) {
    
    static DEFAULT_OPTIONS = {
        id: "daggerheart-stats-manager",
        tag: "form",
        window: {
            title: "Manage Stat Sources",
            icon: "fas fa-chart-pie",
            resizable: false,
            width: 700, // Increased width to fit new inputs
            height: "auto"
        },
        position: { width: 700, height: "auto" },
        form: {
            handler: CompendiumStatsManager.submitHandler,
            closeOnSubmit: true
        }
    };

    static PARTS = {
        form: {
            template: "modules/daggerheart-advmanager/templates/compendium-stats-manager.hbs",
            scrollable: [".compendium-list"]
        }
    };

    async _prepareContext(_options) {
        const savedActors = game.settings.get(MODULE_ID, SETTING_STATS_COMPENDIUMS) || [];
        // Filter for Actor packs, excluding the system default
        const actorPacks = game.packs.filter(p => p.documentName === "Actor" && p.metadata.id !== "daggerheart.adversaries");

        const actorList = actorPacks.map(p => ({
            id: p.metadata.id,
            label: p.metadata.label,
            package: p.metadata.packageName,
            checked: savedActors.includes(p.metadata.id)
        }));

        // Sort alphabetically
        actorList.sort((a, b) => a.label.localeCompare(b.label));

        return {
            actorList,
            hasActors: actorList.length > 0
        };
    }

    static async submitHandler(event, form, formData) {
        // 1. Identify what was previously saved
        const oldSettings = game.settings.get(MODULE_ID, SETTING_STATS_COMPENDIUMS) || [];
        const selectedActors = [];
        
        // formData.object contains checkboxes (boolean) and text inputs (strings)
        // We iterate to find the selected checkboxes (pack IDs)
        for (const [key, value] of Object.entries(formData.object)) {
            // Checkboxes return boolean true when checked
            if (value === true) {
                // Verify if this key corresponds to a pack (ignoring text inputs)
                if (game.packs.has(key)) {
                    selectedActors.push(key);
                }
            }
        }

        // 2. Identify newly added compendiums in this session
        const newlyAdded = selectedActors.filter(id => !oldSettings.includes(id));

        // 3. Save settings
        await game.settings.set(MODULE_ID, SETTING_STATS_COMPENDIUMS, selectedActors);
        
        // 4. Import Features from new compendiums
        if (newlyAdded.length > 0) {
            ui.notifications.info(`Found ${newlyAdded.length} new source(s). Importing features...`);
            
            for (const packId of newlyAdded) {
                const pack = game.packs.get(packId);
                if (pack) {
                    const defaultLabel = pack.metadata.label;
                    
                    // Retrieve custom values from form data
                    // Keys are prefixed based on the Handlebars template
                    const tagKey = `tag_${packId}`;
                    const folderKey = `folder_${packId}`;
                    
                    const customTagInput = formData.object[tagKey];
                    const customFolderInput = formData.object[folderKey];

                    // Determine final values: Use input if present, otherwise default
                    const finalTag = customTagInput && customTagInput.trim() !== "" 
                        ? customTagInput.trim() 
                        : defaultLabel;

                    const finalFolder = customFolderInput && customFolderInput.trim() !== "" 
                        ? customFolderInput.trim() 
                        : `Imported from ${defaultLabel}`;
                    
                    // Execute import using the exposed global function
                    if (globalThis.AM && globalThis.AM.ImportFeatures) {
                        await globalThis.AM.ImportFeatures(packId, finalFolder, finalTag);
                    } else {
                        console.error("Daggerheart Manager | AM.ImportFeatures not available.");
                    }
                }
            }
        }

        ui.notifications.info("Stat sources updated.");
        
        // 5. Reload Stats Window if open
        const statsApp = Object.values(ui.windows).find(w => w.id === "daggerheart-compendium-stats");
        if (statsApp) {
            statsApp.loading = true;
            statsApp.render();
        }
    }
}