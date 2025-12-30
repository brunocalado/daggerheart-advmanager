const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Simplified Adversary Card.
 * Shows quick stats and features.
 */
export class AdversaryCard extends HandlebarsApplicationMixin(ApplicationV2) {
    
    constructor(options = {}) {
        super(options);
        this.actor = options.actor;
    }

    static DEFAULT_OPTIONS = {
        id: "daggerheart-adversary-card-{id}", // Will be replaced by unique ID in core, but good practice
        tag: "div",
        window: {
            title: "Adversary Card",
            icon: "fas fa-id-card",
            resizable: true,
            width: 350,
            height: "auto"
        },
        position: { width: 350, height: "auto" }
    };

    get title() {
        return this.actor ? this.actor.name : "Adversary Card";
    }

    static PARTS = {
        card: {
            template: "modules/daggerheart-advmanager/templates/adversary-card.hbs",
            scrollable: [".card-features-list"]
        }
    };

    async _prepareContext(_options) {
        if (!this.actor) return {};

        const sys = this.actor.system;
        
        // Extract Features (Items)
        const features = this.actor.items.map(i => ({
            name: i.name,
            img: i.img,
            description: i.system.description ? this._cleanText(i.system.description) : ""
        })).sort((a, b) => a.name.localeCompare(b.name));

        // Format Difficulty
        const difficulty = sys.difficulty || "-";

        // Format Damage
        let damage = "None";
        if (sys.attack?.damage?.parts && sys.attack.damage.parts.length > 0) {
            // Simplified: just grab the first formula or description
            const p = sys.attack.damage.parts[0];
            if (p.value?.custom?.enabled) damage = p.value.custom.formula;
            else if (p.value?.dice) damage = `${p.value.flatMultiplier || 1}${p.value.dice}${p.value.bonus ? '+' + p.value.bonus : ''}`;
            else if (p.value?.flatMultiplier) damage = p.value.flatMultiplier;
        }

        return {
            name: this.actor.name,
            img: this.actor.img,
            tier: sys.tier || 1,
            type: (sys.type || "standard").toUpperCase(),
            difficulty: difficulty,
            hp: sys.resources?.hitPoints?.max || "-",
            stress: sys.resources?.stress?.max || "-",
            damage: damage,
            features: features
        };
    }

    _cleanText(html) {
        // Basic HTML strip for cleaner preview, or keep HTML if rendering allow
        // Using built-in Foundry utility if available, otherwise simple regex
        return html.replace(/<[^>]*>?/gm, '');
    }
}