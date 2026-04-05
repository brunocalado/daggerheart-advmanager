import { ADVERSARY_BENCHMARKS } from "./rules.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Application to drag & drop a feature and update its 'importedFrom' flags manually.
 */
export class FeatureUpdater extends HandlebarsApplicationMixin(ApplicationV2) {
    
    constructor(options = {}) {
        super(options);
        this.selectedItemUuid = null;
        this.selectedItem = null;
        
        // Estado inicial do formulário
        this.formState = {
            tier: 1,
            type: "Bruiser",
            customTag: "Homebrew"
        };
    }

    static DEFAULT_OPTIONS = {
        id: "daggerheart-feature-updater",
        tag: "form",
        window: {
            title: "Feature Flag Updater",
            icon: "fas fa-tags",
            resizable: false,
            width: 400,
            height: "auto"
        },
        position: { width: 400, height: "auto" },
        form: {
            handler: FeatureUpdater.prototype._onSubmit,
            closeOnSubmit: false
        }
    };

    static PARTS = {
        form: {
            template: "modules/daggerheart-advmanager/templates/feature-updater.hbs"
        }
    };

    async _prepareContext(_options) {
        // Prepare Tier Options
        const tiers = [1, 2, 3, 4].map(t => ({
            value: t,
            label: `Tier ${t}`,
            selected: t === this.formState.tier
        }));

        // Prepare Type Options from Rules
        const typeKeys = Object.keys(ADVERSARY_BENCHMARKS).sort();
        const types = typeKeys.map(k => {
            const capitalizedKey = k.charAt(0).toUpperCase() + k.slice(1);
            // Case-insensitive comparison to mark the selected type
            const isSelected = capitalizedKey.toLowerCase() === (this.formState.type || "").toLowerCase();
            return {
                value: capitalizedKey, 
                label: capitalizedKey,
                selected: isSelected
            };
        });

        // If the current type isn't in the list (e.g., custom), fallback may be needed — default Bruiser covers init

        return {
            item: this.selectedItem ? { name: this.selectedItem.name, img: this.selectedItem.img } : null,
            tierOptions: tiers,
            typeOptions: types,
            customTagValue: this.formState.customTag
        };
    }

    _onRender(context, options) {
        super._onRender(context, options);
        
        // Setup Drag & Drop listeners on the drop zone
        const dropZone = this.element.querySelector(".drop-zone");
        if (dropZone) {
            dropZone.addEventListener("dragover", this._onDragOver.bind(this));
            dropZone.addEventListener("dragleave", this._onDragLeave.bind(this));
            dropZone.addEventListener("drop", this._onDrop.bind(this));
        }
    }

    _onDragOver(event) {
        event.preventDefault();
        event.currentTarget.classList.add("drag-over");
    }

    _onDragLeave(event) {
        event.preventDefault();
        event.currentTarget.classList.remove("drag-over");
    }

    async _onDrop(event) {
        event.preventDefault();
        event.currentTarget.classList.remove("drag-over");

        try {
            const data = JSON.parse(event.dataTransfer.getData("text/plain"));
            
            if (data.type !== "Item") {
                ui.notifications.warn("Please drop an Item.");
                return;
            }

            const item = await fromUuid(data.uuid);
            if (!item) {
                ui.notifications.error("Could not resolve Item UUID.");
                return;
            }

            // Ler flags existentes
            const flags = item.flags?.importedFrom || {};

            // Atualizar o estado local
            this.selectedItem = item;
            this.selectedItemUuid = data.uuid;
            
            // Reset to defaults, then apply flag values if present
            this.formState.tier = flags.tier ? Number(flags.tier) : 1;
            this.formState.type = flags.type || "Bruiser";
            this.formState.customTag = flags.customTag || "Homebrew";

            this.render();

        } catch (e) {
            console.error(e);
            ui.notifications.error("Invalid drop data.");
        }
    }

    async _onSubmit(event, form, formData) {
        if (!this.selectedItemUuid) {
            ui.notifications.warn("No item selected.");
            return;
        }

        const item = await fromUuid(this.selectedItemUuid);
        if (!item) {
            ui.notifications.error("Item no longer exists.");
            this.selectedItem = null;
            this.selectedItemUuid = null;
            this.render();
            return;
        }

        const tier = Number(formData.object.tier);
        const advType = formData.object.type; 
        const customTag = formData.object.customTag || "";

        const currentFlags = item.flags.importedFrom || {};

        const newFlags = {
            ...currentFlags,
            tier: tier,
            type: advType,
            customTag: customTag
        };

        // Ensure keys exist
        if (!newFlags.compendium) newFlags.compendium = "";
        if (!newFlags.adversary) newFlags.adversary = "";
        if (!newFlags.originalId) newFlags.originalId = "";

        try {
            await item.update({
                "flags.importedFrom": newFlags
            });

            console.log(`Adversary Manager | Updated flags for "${item.name}".`);
            
            // Atualiza o estado do form com o que foi salvo, para consistência visual
            this.formState.tier = tier;
            this.formState.type = advType;
            this.formState.customTag = customTag;

            // Limpa o item selecionado para permitir o próximo drop
            this.selectedItem = null;
            this.selectedItemUuid = null;
            this.render();

        } catch (err) {
            console.error(err);
            ui.notifications.error("Failed to update item flags.");
        }
    }
}