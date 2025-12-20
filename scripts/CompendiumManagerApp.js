const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
import { MODULE_ID, SETTING_EXTRA_COMPENDIUMS } from "./module.js";

/**
 * Application to select which Actor Compendiums should be available in the Live Preview.
 */
export class CompendiumManagerApp extends HandlebarsApplicationMixin(ApplicationV2) {
    
    static DEFAULT_OPTIONS = {
        id: "daggerheart-compendium-manager",
        tag: "form",
        window: {
            title: "Manage Compendium Sources",
            icon: "fas fa-atlas",
            resizable: false,
            width: 400,
            height: "auto"
        },
        position: { width: 400, height: "auto" },
        form: {
            handler: CompendiumManagerApp.submitHandler,
            closeOnSubmit: true
        }
    };

    static PARTS = {
        form: {
            template: "modules/daggerheart-advmanager/templates/compendium-manager.hbs",
            scrollable: [".compendium-list"]
        }
    };

    async _prepareContext(_options) {
        // 1. Get current saved selection
        const savedCompendiums = game.settings.get(MODULE_ID, SETTING_EXTRA_COMPENDIUMS) || [];

        // 2. Find all Actor Compendiums available (excluding the system default one if desired, or keep it)
        // We exclude "daggerheart.adversaries" because it is hardcoded in the main app as "System Compendium"
        const packs = game.packs.filter(p => p.documentName === "Actor" && p.metadata.id !== "daggerheart.adversaries");

        const compendiumList = packs.map(p => ({
            id: p.metadata.id,
            label: p.metadata.label,
            package: p.metadata.packageName,
            checked: savedCompendiums.includes(p.metadata.id)
        }));

        compendiumList.sort((a, b) => a.label.localeCompare(b.label));

        return {
            compendiumList,
            hasCompendiums: compendiumList.length > 0
        };
    }

    static async submitHandler(event, form, formData) {
        const selected = [];
        
        // formData.object will contain keys like "compendiumId": true/false
        for (const [key, value] of Object.entries(formData.object)) {
            if (value === true) {
                selected.push(key);
            }
        }

        await game.settings.set(MODULE_ID, SETTING_EXTRA_COMPENDIUMS, selected);
        ui.notifications.info("Compendium sources updated.");
        
        // Ideally, we could refresh the Live Preview if open, but user can re-open it.
    }
}