const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
import { ADVERSARY_BENCHMARKS } from "./rules.js";
import { MODULE_ID, SETTING_CHAT_LOG } from "./module.js";
import { updateSingleActor, sendBatchChatLog } from "./damage-engine.js";

/**
 * Batch-update application for Daggerheart Adversaries.
 * Used when multiple adversary tokens are selected on the canvas.
 * Lets the GM choose a target tier and applies the update to all selected actors at once.
 * Triggered by the manage() entry point in module.js when 2+ tokens are controlled.
 */
export class Manager extends HandlebarsApplicationMixin(ApplicationV2) {

    constructor(options = {}) {
        super(options);
        if (options.actors) {
            this.actors = options.actors;
        } else {
            this.actors = options.actor ? [options.actor] : [];
        }
    }

    static DEFAULT_OPTIONS = {
        id: "daggerheart-adv-manager",
        tag: "form",
        window: {
            title: "Adversary Manager",
            icon: "fas fa-skull",
            resizable: false,
            width: 420
        },
        position: {
            width: 420,
            height: "auto"
        },
        form: {
            handler: Manager.submitHandler,
            closeOnSubmit: true
        }
    };

    static PARTS = {
        form: {
            template: "modules/daggerheart-advmanager/templates/manager.hbs"
        }
    };

    /**
     * Builds the template context for the batch update form.
     * Displays actor names, current tiers, link status, and tier selection UI.
     * @param {Object} _options - Render options (unused).
     * @returns {Object} Template context.
     */
    async _prepareContext(_options) {
        const actorList = this.actors.map(a => {
            const tier = Number(a.system.tier) || 1;
            const isLinked = a.isToken ? a.actorLink : a.prototypeToken?.actorLink;

            return {
                name: a.name,
                tier: tier,
                isLinked: isLinked,
                linkIcon: isLinked ? "fa-link" : "fa-unlink",
                linkClass: isLinked ? "status-linked" : "status-unlinked"
            };
        });

        const distinctTiers = new Set(actorList.map(a => a.tier));
        const isMixedTier = distinctTiers.size > 1;
        const currentSharedTier = isMixedTier ? null : (distinctTiers.values().next().value);

        const tiers = [1, 2, 3, 4].map(t => ({
            value: t,
            label: `Tier ${t}`,
            disabled: !isMixedTier && t === currentSharedTier,
            isCurrent: !isMixedTier && t === currentSharedTier
        }));

        return {
            actorList: actorList,
            hasMultiple: this.actors.length > 1,
            tiers: tiers
        };
    }

    /**
     * Form submit handler. Iterates all selected actors and calls updateSingleActor
     * for each, then optionally sends a batch chat log.
     * Triggered by the AppV2 form submission lifecycle.
     * @param {Event} event - The submit event.
     * @param {HTMLFormElement} form - The form element.
     * @param {FormDataExtended} formData - Parsed form data.
     */
    static async submitHandler(event, form, formData) {
        const app = this;
        const newTier = Number(formData.object.selectedTier);
        if (!newTier) return;
        const batchResults = [];
        let updatedCount = 0;
        for (const actor of app.actors) {
            try {
                const result = await updateSingleActor(actor, newTier);
                if (result) { updatedCount++; batchResults.push(result); }
            } catch (err) { console.error(err); }
        }
        if (updatedCount > 0) {
            if (game.settings.get(MODULE_ID, SETTING_CHAT_LOG) && batchResults.length > 0) {
                sendBatchChatLog(batchResults, newTier);
            }
            app.close();
        } else { ui.notifications.info("No Adversaries updated."); }
    }
}
