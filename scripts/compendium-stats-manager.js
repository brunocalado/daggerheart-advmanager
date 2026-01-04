import { MODULE_ID, SETTING_STATS_COMPENDIUMS } from "./module.js";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Gerenciador simplificado para fontes do Compendium Stats.
 * Permite selecionar apenas compêndios de Atores.
 */
export class CompendiumStatsManager extends HandlebarsApplicationMixin(ApplicationV2) {
    
    static DEFAULT_OPTIONS = {
        id: "daggerheart-stats-manager",
        tag: "form",
        window: {
            title: "Manage Stat Sources",
            icon: "fas fa-chart-pie",
            resizable: false,
            width: 400,
            height: "auto"
        },
        position: { width: 400, height: "auto" },
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
        const actorPacks = game.packs.filter(p => p.documentName === "Actor" && p.metadata.id !== "daggerheart.adversaries");

        const actorList = actorPacks.map(p => ({
            id: p.metadata.id,
            label: p.metadata.label,
            package: p.metadata.packageName,
            checked: savedActors.includes(p.metadata.id)
        }));

        actorList.sort((a, b) => a.label.localeCompare(b.label));

        return {
            actorList,
            hasActors: actorList.length > 0
        };
    }

    static async submitHandler(event, form, formData) {
        // 1. Identificar o que estava salvo antes
        const oldSettings = game.settings.get(MODULE_ID, SETTING_STATS_COMPENDIUMS) || [];
        const selectedActors = [];
        
        for (const [key, value] of Object.entries(formData.object)) {
            if (value === true) {
                selectedActors.push(key);
            }
        }

        // 2. Identificar novos compêndios adicionados nesta sessão
        const newlyAdded = selectedActors.filter(id => !oldSettings.includes(id));

        // 3. Salvar configurações
        await game.settings.set(MODULE_ID, SETTING_STATS_COMPENDIUMS, selectedActors);
        
        // 4. Importar Features dos novos compêndios
        if (newlyAdded.length > 0) {
            ui.notifications.info(`Found ${newlyAdded.length} new source(s). Importing features...`);
            
            for (const packId of newlyAdded) {
                const pack = game.packs.get(packId);
                if (pack) {
                    const label = pack.metadata.label;
                    const folderName = `Imported from ${label}`;
                    
                    // Executa a importação usando a função global exposta no module.js
                    if (globalThis.AM && globalThis.AM.ImportFeatures) {
                        await globalThis.AM.ImportFeatures(packId, folderName, label);
                    } else {
                        console.error("Daggerheart Manager | AM.ImportFeatures not available.");
                    }
                }
            }
        }

        ui.notifications.info("Stat sources updated.");
        
        // 5. Recarregar a janela de Stats
        const statsApp = Object.values(ui.windows).find(w => w.id === "daggerheart-compendium-stats");
        if (statsApp) {
            statsApp.loading = true;
            statsApp.render();
        }
    }
}