import { AdversaryManagerApp } from "./AdversaryManagerApp.js"; 
import { AdversaryLivePreviewApp } from "./AdversaryLivePreviewApp.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// --- Settings Constants ---
export const MODULE_ID = "daggerheart-advmanager";
export const SETTING_CHAT_LOG = "enableChatLog";
export const SETTING_UPDATE_EXP = "autoUpdateExperiences";
export const SETTING_ADD_FEATURES = "autoAddFeatures";
export const SETTING_IMPORT_FOLDER = "importFolderName"; // Nova Setting
export const SKULL_IMAGE_PATH = "modules/daggerheart-advmanager/assets/images/skull.webp";

// --- Main Logic ---

/**
 * Unified Management Function
 * - 0 Tokens: Live Preview (Manual Selection)
 * - 1 Token: Live Preview (Focused)
 * - >1 Tokens: Batch Manager (Old Interface)
 */
function manage() {
    const tokens = canvas.tokens.controlled;
    
    // 1. Strict Check for Broken Links (Token points to an ID that is not in game.actors)
    // Note: Synthetic actors (unlinked) have actorId null or point to a base actor.
    // If a token is linked (actorLink: true) but the actor is missing from the directory, token.actor might be null or valid cached data depending on Foundry version.
    // We check specifically: Is there an actorId? If yes, is it in game.actors?
    
    const brokenToken = tokens.find(t => {
        const actorId = t.document.actorId;
        // If it has an ID, but that ID is not in the world collection -> Broken
        if (actorId && !game.actors.has(actorId)) return true;
        // If it fails to produce an actor object at all -> Broken
        if (!t.actor) return true;
        return false;
    });

    if (brokenToken) {
        ui.notifications.error(`Erro: O token "${brokenToken.name}" referencia um Ator que não existe mais no diretório (provavelmente foi deletado).`);
        return;
    }

    // 2. Filter valid Adversary actors
    const validActors = tokens
        .map(t => t.actor)
        .filter(a => a && a.type === "adversary");

    if (validActors.length === 0) {
        // Case 0: No valid tokens selected (or non-adversaries selected) -> Open Empty Live Preview
        // Note: We deliberately don't pass an actor here so it defaults to World list
        new AdversaryLivePreviewApp().render(true);
    } else if (validActors.length === 1) {
        // Case 1: Exactly 1 valid token -> Focused Live Preview
        new AdversaryLivePreviewApp({ actor: validActors[0] }).render(true);
    } else {
        // Case 2: Multiple tokens -> Batch Manager
        new AdversaryManagerApp({ actors: validActors }).render(true);
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

    game.settings.register(MODULE_ID, SETTING_IMPORT_FOLDER, {
        name: "Compendium Import Folder",
        hint: "Name of the folder where adversaries imported from the Compendium will be created.",
        scope: "world",
        config: true,
        type: String,
        default: "Imported Adversaries"
    });
});

Hooks.once("ready", () => {
    // Register Global API
    globalThis.AM = {
        Manage: manage, 
        LivePreview: () => new AdversaryLivePreviewApp().render(true)
        // QuickPreview removed entirely
    };
    console.log("Adversary Manager | Ready. Use AM.Manage() to start.");
});

// Hook: Daggerheart System Menu (Left Sidebar Button)
Hooks.on("renderDaggerheartMenu", (app, html) => {
    const element = (html instanceof jQuery) ? html[0] : html;
    
    const myButton = document.createElement("button");
    myButton.type = "button";
    myButton.innerHTML = `<i class="fas fa-skull"></i> Manage Adversaries`;
    myButton.classList.add("dh-adv-btn"); 
    myButton.style.marginTop = "10px";
    myButton.style.width = "100%";

    myButton.onclick = (event) => {
        event.preventDefault();
        manage();
    };

    const fieldset = element.querySelector("fieldset");
    if (fieldset) {
        const newFieldset = document.createElement("fieldset");
        const legend = document.createElement("legend");
        legend.innerText = "Adversary Tools";
        newFieldset.appendChild(legend);
        newFieldset.appendChild(myButton);
        fieldset.after(newFieldset);
    } else {
        element.appendChild(myButton);
    }
});

// Hook: Actor Directory (Right Sidebar Button)
Hooks.on("renderActorDirectory", (app, html) => {
    const $html = $(html);
    const actionButtons = $html.find(".header-actions");
    
    const btn = $(`
        <button type="button" class="create-actor" style="flex: 0 0 100%; max-width: 100%; margin-top: 6px;">
            <i class="fas fa-skull"></i> Manage Adversaries
        </button>
    `);

    btn.click((e) => {
        e.preventDefault();
        manage();
    });

    if (actionButtons.length) {
        actionButtons.append(btn);
    }
});