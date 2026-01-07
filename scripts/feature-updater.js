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
            // Comparação insensível a maiúsculas/minúsculas para marcar selecionado
            const isSelected = capitalizedKey.toLowerCase() === (this.formState.type || "").toLowerCase();
            return {
                value: capitalizedKey, 
                label: capitalizedKey,
                selected: isSelected
            };
        });

        // Garantir que se o tipo atual não estiver na lista (ex: custom), seleciona o primeiro ou mantém visualmente errado
        // (Opcional: adicionar lógica de fallback se necessário, mas o padrão Bruiser cobre init)

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
            
            // Atualizar valores do form se existirem no item, senão manter defaults ou valores anteriores
            // Prioriza valor da flag, se não existir, usa "Bruiser"/"Homebrew" como fallback seguro apenas na primeira vez,
            // ou mantém o que o usuário já tinha digitado se quisesse editar em lote.
            // A lógica pedida foi: "atualizar os campos com esses valores SE ELES EXISTIREM"
            
            if (flags.tier) this.formState.tier = Number(flags.tier);
            if (flags.type) this.formState.type = flags.type;
            if (flags.customTag) this.formState.customTag = flags.customTag;
            
            // Se não tiver customTag definida no item, reseta para Homebrew ou mantém o último digitado?
            // "Se houver um valor nesses 3 vc substituie." - Implica que se não houver, não substitui (mantém o que está na tela)
            // Mas para uma experiência de usuário limpa ao trocar de item, talvez seja melhor mostrar os dados do item novo 100%.
            // Vou assumir: Se tem flag, usa a flag. Se não tem flag, volta para o default para evitar confusão de editar Item B com dados do Item A.
            
            if (!flags.tier) this.formState.tier = 1;
            if (!flags.type) this.formState.type = "Bruiser";
            if (!flags.customTag) this.formState.customTag = "Homebrew";

            // Se as flags existirem, elas sobrescrevem os defaults acima
            if (flags.tier) this.formState.tier = Number(flags.tier);
            if (flags.type) this.formState.type = flags.type;
            if (flags.customTag) this.formState.customTag = flags.customTag;

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

            ui.notifications.info(`Updated flags for "${item.name}".`);
            
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