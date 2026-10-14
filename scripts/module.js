import "./damage-engine.js";
import { Manager } from "./manager.js";
import { LiveManager } from "./live-manager.js";
import { findApplicationById } from "./foundry-compat.js";
import { CompendiumManager } from "./compendium-manager.js";
import { CompendiumStats } from "./compendium-stats.js";
import { DiceProbability } from "./dice-probability.js";
import { EncounterBuilder } from "./encounter-builder.js";
import { FeatureUpdater } from "./feature-updater.js";
import { importFeatures } from "./importer.js";

// --- Settings Constants ---
// MODULE_ID lives in the dependency-free constants.js leaf to avoid a circular
// import (module.js imports the Application classes, which need MODULE_ID at
// static-init time). Imported locally so this file can use it at runtime, and
// re-exported so existing importers of `MODULE_ID` from "./module.js" keep working.
import { MODULE_ID } from "./constants.js";
import { tr } from "./i18n.js";
export { MODULE_ID };
export const SETTING_CHAT_LOG = "enableChatLog";
export const SETTING_UPDATE_EXP = "autoUpdateExperiences";
// Setting key kept as-is so worlds don't lose the value they already saved.
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
export const SETTING_OPEN_SHEET_AFTER_APPLY = "openSheetAfterApply";
export const SETTING_OVERWRITE_WORLD_ACTOR = "overwriteWorldActor";

// --- Main Logic ---

/**
 * Guards a function so only GMs can execute it.
 * Shows a warning notification for non-GM users.
 * @param {Function} fn - The function to protect.
 * @returns {Function} Wrapped function with GM check.
 */
function gmOnly(fn) {
    return function (...args) {
        if (!game.user.isGM) {
            ui.notifications.warn(tr("Notify.GMOnly"));
            return;
        }
        return fn.apply(this, args);
    };
}

/**
 * Rebuilds the Compendium Statistics census and downloads it, to be committed as
 * data/compendium-stats-core.json.
 *
 * Run it once per Daggerheart release. Until the bundled file matches the installed system, the
 * statistics window falls back to reading every adversary document — about a minute of loading
 * on each open — and says so.
 * @returns {Promise<Object>} The snapshot that was downloaded.
 */
async function buildStatsSnapshot() {
    ui.notifications.info(tr("Notify.BuildingSnapshot"));

    const snapshot = await CompendiumStats.buildCoreSnapshot();
    foundry.utils.saveDataToFile(JSON.stringify(snapshot), "application/json", "compendium-stats-core.json");

    const msg = tr("Notify.SnapshotBuilt", { system: snapshot.system, version: snapshot.systemVersion, count: snapshot.adversaryCount });
    ui.notifications.info(msg);
    console.log(msg);
    return snapshot;
}

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
        ui.notifications.error(tr("Notify.BrokenToken", { name: brokenToken.name }));
        return;
    }

    // 2. Filter valid Adversary actors
    const validActors = tokens
        .map(t => t.actor)
        .filter(a => a && a.type === "adversary");

    // CHECK FOR EXISTING WINDOW
    const existingApp = findApplicationById("daggerheart-live-preview", LiveManager);
    
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

// --- Init & Hooks ---

Hooks.once("init", () => {
    // Pre-load Handlebars partials for template decomposition
    const loadTemplates = foundry.applications?.handlebars?.loadTemplates || globalThis.loadTemplates;
    loadTemplates([
        "modules/daggerheart-advmanager/templates/partials/lm-controls.hbs",
        "modules/daggerheart-advmanager/templates/partials/lm-current-stats.hbs",
        "modules/daggerheart-advmanager/templates/partials/lm-preview-stats.hbs",
        "modules/daggerheart-advmanager/templates/partials/lm-feature-changes.hbs",
        "modules/daggerheart-advmanager/templates/partials/lm-new-features.hbs",
        "modules/daggerheart-advmanager/templates/partials/dp-roll-type.hbs"
    ]);

    game.settings.register(MODULE_ID, SETTING_CHAT_LOG, {
        name: "DHAM.Settings.ChatLog.Name",
        hint: "DHAM.Settings.ChatLog.Hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, SETTING_UPDATE_EXP, {
        name: "DHAM.Settings.UpdateExp.Name",
        hint: "DHAM.Settings.UpdateExp.Hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, SETTING_SUGGEST_FEATURES, {
        name: "DHAM.Settings.SuggestFeatures.Name",
        hint: "DHAM.Settings.SuggestFeatures.Hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, SETTING_IMPORT_FOLDER, {
        name: "DHAM.Settings.ImportFolder.Name",
        hint: "DHAM.Settings.ImportFolder.Hint",
        scope: "world",
        config: true,
        type: String,
        default: "💀 Imported Adversaries"
    });

    game.settings.register(MODULE_ID, SETTING_ENCOUNTER_FOLDER, {
        name: "DHAM.Settings.EncounterFolder.Name",
        hint: "DHAM.Settings.EncounterFolder.Hint",
        scope: "world",
        config: true,
        type: String,
        default: "💀 My Encounters"
    });

    game.settings.register(MODULE_ID, SETTING_EXTRA_COMPENDIUMS, {
        name: "DHAM.Settings.ExtraCompendiums",
        scope: "world",
        config: false,
        type: Array,
        default: []
    });

    game.settings.register(MODULE_ID, SETTING_FEATURE_COMPENDIUMS, {
        name: "DHAM.Settings.FeatureCompendiums",
        scope: "world",
        config: false,
        type: Array,
        default: []
    });

    // --- REGISTRO DA CONFIGURAÇÃO DE STATS ---
    game.settings.register(MODULE_ID, SETTING_STATS_COMPENDIUMS, {
        name: "DHAM.Settings.StatsCompendiums",
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

    game.settings.register(MODULE_ID, SETTING_OPEN_SHEET_AFTER_APPLY, {
        scope: "client",
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID, SETTING_OVERWRITE_WORLD_ACTOR, {
        scope: "client",
        config: false,
        type: Boolean,
        default: false
    });
});

Hooks.once("ready", () => {
    // Expose API globally
    globalThis.AM = {
        Manage: gmOnly(manage),
        LiveManager: () => new LiveManager().render(true),
        CompendiumManager: () => new CompendiumManager().render(true),
        CompendiumStats: gmOnly(() => new CompendiumStats().render(true)),
        DiceProbability: () => new DiceProbability().render(true),
        EncounterBuilder: gmOnly(() => new EncounterBuilder().render(true)),
        ImportFeatures: importFeatures,
        UpdateFeatures: gmOnly(() => new FeatureUpdater().render(true)),
        BuildStatsSnapshot: gmOnly(buildStatsSnapshot)
    };
    console.log("Adversary Manager | Ready. Use AM.Manage() to start.");
});

Hooks.on("controlToken", (token, controlled) => {
    if (!controlled) return;
    const tokens = canvas.tokens.controlled;
    if (tokens.length !== 1) return;
    const actor = tokens[0].actor;
    if (!actor || actor.type !== "adversary") return;

    const app = findApplicationById("daggerheart-live-preview", LiveManager);
    if (app) {
        app.updateSelectedActor(actor);
    }
});

Hooks.on("renderDaggerheartMenu", (app, html) => {
    if (!game.user.isGM) return;

    const element = (html instanceof HTMLElement) ? html : html[0];
    if (element.querySelector(".dh-adv-tools")) return;

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

    const btnManage = createBtn(tr("Menu.ManageAdversaries"), "fa-skull", manage);
    const btnStats = createBtn(tr("Menu.CompendiumStats"), "fa-chart-pie", () => new CompendiumStats().render(true));
    const btnProb = createBtn(tr("Menu.DiceProbability"), "fa-dice-d20", () => new DiceProbability().render(true));
    const btnBuilder = createBtn(tr("Menu.EncounterBuilder"), "fa-dungeon", () => new EncounterBuilder().render(true));

    const fieldset = element.querySelector("fieldset");
    if (fieldset) {
        const newFieldset = document.createElement("fieldset");
        newFieldset.classList.add("dh-adv-tools");
        const legend = document.createElement("legend");
        legend.innerText = tr("Menu.AdversaryTools");
        newFieldset.appendChild(legend);
        newFieldset.appendChild(btnManage);
        newFieldset.appendChild(btnBuilder);
        newFieldset.appendChild(btnStats);
        newFieldset.appendChild(btnProb);
        fieldset.after(newFieldset);
    } else {
        const wrapper = document.createElement("div");
        wrapper.classList.add("dh-adv-tools");
        wrapper.appendChild(btnManage);
        wrapper.appendChild(btnBuilder);
        wrapper.appendChild(btnStats);
        wrapper.appendChild(btnProb);
        element.appendChild(wrapper);
    }
});

Hooks.on("renderActorDirectory", (app, html) => {
    if (!game.user.isGM) return;

    const element = (html instanceof HTMLElement) ? html : html[0];
    const actionButtons = element.querySelector(".header-actions");
    
    if (actionButtons) {
        if (actionButtons.querySelector(".dh-adv-directory-btn")) return;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.classList.add("create-actor", "dh-adv-directory-btn");
        btn.style.flex = "0 0 100%";
        btn.style.maxWidth = "100%";
        btn.style.marginTop = "6px";
        btn.innerHTML = `<i class="fas fa-skull"></i> ${tr("Menu.ManageAdversaries")}`;
        
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            manage();
        });

        actionButtons.appendChild(btn);
    }
});