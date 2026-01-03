const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
import { MODULE_ID, SETTING_EXTRA_COMPENDIUMS, SETTING_FEATURE_COMPENDIUMS } from "./module.js";

/**
 * Application to select which Actor and Item Compendiums should be available.
 */
export class CompendiumManager extends HandlebarsApplicationMixin(ApplicationV2) {
    
    static DEFAULT_OPTIONS = {
        id: "daggerheart-compendium-manager",
        tag: "form",
        window: {
            title: "Manage Compendium Sources",
            icon: "fas fa-atlas",
            resizable: false,
            width: 450,
            height: "auto"
        },
        position: { width: 450, height: "auto" },
        form: {
            handler: CompendiumManager.submitHandler,
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
        // 1. Get current saved selections
        const savedActors = game.settings.get(MODULE_ID, SETTING_EXTRA_COMPENDIUMS) || [];
        const savedFeatures = game.settings.get(MODULE_ID, SETTING_FEATURE_COMPENDIUMS) || [];

        // 2. Fetch Compendiums
        // Actors (excluding the system default one if desired, or keep it)
        const actorPacks = game.packs.filter(p => p.documentName === "Actor" && p.metadata.id !== "daggerheart.adversaries");
        
        // Items (Features)
        const itemPacks = game.packs.filter(p => p.documentName === "Item");

        // Helper map function
        const mapPack = (p, savedList) => ({
            id: p.metadata.id,
            label: p.metadata.label,
            package: p.metadata.packageName,
            checked: savedList.includes(p.metadata.id)
        });

        const actorList = actorPacks.map(p => mapPack(p, savedActors));
        const featureList = itemPacks.map(p => mapPack(p, savedFeatures));

        // Sort alphabetically
        actorList.sort((a, b) => a.label.localeCompare(b.label));
        featureList.sort((a, b) => a.label.localeCompare(b.label));

        return {
            actorList,
            featureList,
            hasActors: actorList.length > 0,
            hasFeatures: featureList.length > 0
        };
    }

    _onRender(context, options) {
        super._onRender(context, options);
        
        // Simple Tab Logic using plain JS listeners
        const html = this.element;
        const tabLinks = html.querySelectorAll('.dh-tab-link');
        const tabs = html.querySelectorAll('.dh-tab-content');

        tabLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const target = link.dataset.tab;

                // Update Active Link
                tabLinks.forEach(l => l.classList.remove('active'));
                link.classList.add('active');

                // Update Active Content
                tabs.forEach(t => {
                    if (t.dataset.tab === target) t.classList.add('active');
                    else t.classList.remove('active');
                });
            });
        });
    }

    static async submitHandler(event, form, formData) {
        const selectedActors = [];
        const selectedFeatures = [];
        
        // formData.object keys are the compendium IDs
        for (const [key, value] of Object.entries(formData.object)) {
            if (value === true) {
                // Determine if this key belongs to an Actor pack or Item pack
                const pack = game.packs.get(key);
                if (pack) {
                    if (pack.documentName === "Actor") {
                        selectedActors.push(key);
                    } else if (pack.documentName === "Item") {
                        selectedFeatures.push(key);
                    }
                }
            }
        }

        await game.settings.set(MODULE_ID, SETTING_EXTRA_COMPENDIUMS, selectedActors);
        await game.settings.set(MODULE_ID, SETTING_FEATURE_COMPENDIUMS, selectedFeatures);
        
        ui.notifications.info("Compendium sources updated successfully.");
    }
}