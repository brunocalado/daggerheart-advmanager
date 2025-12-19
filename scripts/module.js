import { AdversaryManagerApp } from "./AdversaryManagerApp.js";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// --- Settings Constants ---
export const MODULE_ID = "daggerheart-advmanager";
export const SETTING_CHAT_LOG = "enableChatLog";
export const SETTING_UPDATE_EXP = "autoUpdateExperiences";
export const SETTING_ADD_FEATURES = "autoAddFeatures"; // Novo Setting
export const SKULL_IMAGE_PATH = "modules/daggerheart-advmanager/assets/images/skull.webp";

// --- Main Logic ---

function manageControlledToken() {
    const tokens = canvas.tokens.controlled;
    if (tokens.length === 0) {
        ui.notifications.warn("Please select a token first.");
        return;
    }

    const validActors = tokens
        .map(t => t.actor)
        .filter(a => a && a.type === "adversary");

    if (validActors.length === 0) {
        ui.notifications.warn("No valid Adversary tokens selected.");
        return;
    }

    new AdversaryManagerApp({ actors: validActors }).render(true);
}

/**
 * Seletor de Ator usando ApplicationV2
 */
class ActorSelectorApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "adv-manager-selector",
        tag: "form",
        window: {
            title: "Select Adversary",
            icon: "fas fa-users",
            resizable: false,
            width: 350, 
            height: "auto"
        },
        position: { width: 350, height: "auto" },
        form: {
            handler: ActorSelectorApp.submitHandler,
            closeOnSubmit: true
        }
    };

    static PARTS = {
        form: {
            template: "modules/daggerheart-advmanager/templates/selector.hbs"
        }
    };

    async _prepareContext(_options) {
        const adversaries = game.actors
            .filter(a => a.type === "adversary")
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(a => ({ id: a.id, name: a.name }));

        return { adversaries };
    }

    _onRender(context, options) {
        super._onRender(context, options);
        
        const html = this.element;
        const searchInput = html.querySelector(".filter-actors");
        const select = html.querySelector(".actor-select");

        if (searchInput && select) {
            searchInput.addEventListener("input", (e) => {
                const query = e.target.value.toLowerCase();
                let hasVisible = false;

                for (const option of select.options) {
                    const match = option.text.toLowerCase().includes(query);
                    if (match) {
                        option.style.display = "";
                        option.disabled = false; 
                        hasVisible = true;
                    } else {
                        option.style.display = "none";
                        option.disabled = true; 
                    }
                }
            });
        }
    }

    static async submitHandler(event, form, formData) {
        const actorId = formData.object.actorId;
        if (!actorId) {
            ui.notifications.warn("Please select an adversary from the list.");
            return;
        }
        
        const actor = game.actors.get(actorId);
        if (actor) {
            new AdversaryManagerApp({ actor: actor }).render(true);
        }
    }
}

async function manageActorFromDirectory() {
    const hasAdversaries = game.actors.some(a => a.type === "adversary");
    if (!hasAdversaries) {
        ui.notifications.warn("No Actors of type 'adversary' found in the world.");
        return;
    }
    new ActorSelectorApp().render(true);
}

/**
 * Função Unificada
 */
function manage() {
    if (canvas.tokens.controlled.length > 0) {
        manageControlledToken();
    } else {
        manageActorFromDirectory();
    }
}

/**
 * Quick Preview
 */
async function quickPreview() {
    const tokens = canvas.tokens.controlled;
    if (tokens.length === 0) {
        ui.notifications.warn("Please select a token to preview.");
        return;
    }

    const token = tokens[0];
    const actor = token.actor;

    if (!actor) return;

    // --- 1. Gather Stats ---
    const statsLog = [];
    const sys = actor.system;

    if (sys.difficulty) statsLog.push(`<strong>Difficulty:</strong> ${sys.difficulty}`);
    
    if (sys.resources?.hitPoints) {
        statsLog.push(`<strong>HP:</strong> ${sys.resources.hitPoints.value}/${sys.resources.hitPoints.max}`);
    }

    if (sys.resources?.stress) {
        statsLog.push(`<strong>Stress:</strong> ${sys.resources.stress.value}/${sys.resources.stress.max}`);
    }

    if (sys.damageThresholds) {
        statsLog.push(`<strong>Thresholds:</strong> ${sys.damageThresholds.major}/${sys.damageThresholds.severe}`);
    }

    if (sys.attack?.roll) {
        const bonus = sys.attack.roll.bonus;
        const sign = (bonus && Number(bonus) >= 0) ? "+" : "";
        statsLog.push(`<strong>Attack Mod:</strong> ${sign}${bonus}`);
    }

    if (sys.attack?.damage?.parts) {
        sys.attack.damage.parts.forEach(part => {
            if (part.value) {
                let dmgDisplay = "";
                if (part.value.custom?.enabled) {
                    dmgDisplay = `${part.value.custom.formula} (Custom)`;
                } else {
                    const flat = part.value.flatMultiplier;
                    const dice = part.value.dice;
                    const bonus = part.value.bonus;
                    if (dice) {
                        const count = flat || 1;
                        const sign = (bonus && Number(bonus) >= 0) ? "+" : "";
                        const bStr = bonus ? `${sign}${bonus}` : "";
                        dmgDisplay = `${count}${dice}${bStr}`;
                    } else if (flat) {
                        dmgDisplay = `${flat}`;
                    }
                }
                if (dmgDisplay) statsLog.push(`<strong>Sheet Dmg:</strong> ${dmgDisplay}`);
            }
        });
    }

    // --- 2. Gather Features ---
    const featureLog = [];
    const items = actor.items.contents || actor.items; 

    const processActions = (actions, itemName) => {
        let actionsList = [];
        if (actions instanceof Map) {
            actionsList = Array.from(actions.values());
        } else if (typeof actions === 'object') {
            actionsList = Object.values(actions);
        }

        for (const action of actionsList) {
            if (action.damage && action.damage.parts && action.damage.parts.length > 0) {
                for (const part of action.damage.parts) {
                    const val = part.value;
                    if (!val) continue;

                    let damageString = "";
                    let isCustom = false;

                    if (val.custom && val.custom.enabled === true) {
                        damageString = val.custom.formula;
                        isCustom = true;
                    } else {
                        const flat = val.flatMultiplier; 
                        const dice = val.dice;
                        const bonus = val.bonus;

                        if (dice) {
                            const count = (flat !== null && flat !== undefined) ? flat : 1;
                            const sign = (bonus && Number(bonus) >= 0) ? "+" : "";
                            const bonusStr = bonus ? `${sign}${bonus}` : "";
                            damageString = `${count}${dice}${bonusStr}`;
                        } else if (flat !== null && flat !== undefined) {
                            damageString = `${flat}`;
                            if (bonus) {
                                const sign = (Number(bonus) >= 0) ? "+" : "";
                                damageString += `${sign}${bonus}`;
                            }
                        }
                    }

                    if (damageString) {
                        const customTag = isCustom ? " (custom)" : "";
                        featureLog.push(`<strong>${itemName}:</strong> ${damageString}${customTag}`);
                    }
                }
            }
        }
    };

    for (const item of items) {
        const iSys = item.system;
        if (iSys.actions) {
            processActions(iSys.actions, item.name);
        } else if (item._source?.system?.actions) {
            processActions(item._source.system.actions, item.name);
        }
    }

    // --- 3. Build HTML ---
    let contentBody = "";
                    
    if (statsLog.length > 0) {
        contentBody += `<div style="margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.3); padding-bottom: 4px; color: #C9A060;">STATS</div>`;
        statsLog.forEach(log => contentBody += `<div style="margin-bottom: 2px;">${log}</div>`);
    }

    if (featureLog.length > 0) {
        contentBody += `<div style="margin-top: 10px; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.3); padding-bottom: 4px; color: #C9A060;">FEATURES</div>`;
        featureLog.forEach(log => contentBody += `<div style="margin-bottom: 2px;">${log}</div>`);
    }

    if (!contentBody) contentBody = "<em>No relevant data found.</em>";

    const minHeight = "100px";

    const finalHtml = `
    <div class="chat-card" style="border: 2px solid #C9A060; border-radius: 8px; overflow: hidden;">
        <header class="card-header flexrow" style="background: #191919 !important; padding: 8px; border-bottom: 2px solid #C9A060;">
            <h3 class="noborder" style="margin: 0; font-weight: bold; color: #C9A060 !important; font-family: 'Aleo', serif; text-align: center; text-transform: uppercase; letter-spacing: 1px; width: 100%;">
                ${actor.name}
            </h3>
        </header>
        <div class="card-content" style="background-image: url('${SKULL_IMAGE_PATH}'); background-repeat: no-repeat; background-position: center; background-size: cover; padding: 20px; min-height: ${minHeight}; display: flex; align-items: center; justify-content: center; text-align: center; position: relative;">
            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.7); z-index: 0;"></div>
            <span style="color: #ffffff !important; font-size: 1.1em; text-shadow: 0px 0px 8px #000000; position: relative; z-index: 1; font-family: 'Lato', sans-serif; line-height: 1.4; width: 100%; text-align: left;">
                ${contentBody}
            </span>
        </div>
    </div>
    `;

    ChatMessage.create({
        content: finalHtml,
        speaker: ChatMessage.getSpeaker({ token: token })
    });
}

// --- Init & Hooks ---

Hooks.once("init", () => {
    game.settings.register(MODULE_ID, SETTING_CHAT_LOG, {
        name: "Log Changes to Chat",
        hint: "If enabled, sends a whisper to the GM whenever an Adversary is updated via the Manager, showing a summary of changes.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, SETTING_UPDATE_EXP, {
        name: "Auto-Update Experiences",
        hint: "If enabled, experiences (if any) will increase by 1 for each Tier up, and decrease by 1 for each Tier down (minimum 2).",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, SETTING_ADD_FEATURES, {
        name: "Auto-Add Features on Tier Up",
        hint: "If enabled, when an adversary levels up a Tier, it may randomly gain a new feature from the 'suggested_features' list in the rules.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });
});

Hooks.once("ready", () => {
    globalThis.AM = {
        Manage: manage,
        ManageToken: manageControlledToken,
        ManageActor: manageActorFromDirectory,
        QuickPreview: quickPreview
    };
    console.log("Adversary Manager | Ready. Use AM.Manage(), AM.ManageActor() or AM.QuickPreview()");
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