const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
import { SKULL_IMAGE_PATH } from "./module.js";

export class DiceProbability extends HandlebarsApplicationMixin(ApplicationV2) {
    
    constructor(options = {}) {
        super(options);
        
        // Default Data
        this.formData = {
            die1: 12,
            die2: 12,
            rollType: 0, // 0: Normal, 1: Advantage, -1: Disadvantage
            difficulty: 10,
            modifier: 0,
            advDie: 6 // Padrão d6
        };

        // Requirement: Check for selected Adversary Token for Difficulty
        const tokens = canvas.tokens.controlled;
        if (tokens.length === 1) {
            const actor = tokens[0].actor;
            if (actor && actor.type === "adversary") {
                const diff = Number(actor.system.difficulty);
                if (!isNaN(diff)) {
                    this.formData.difficulty = diff;
                }
            }
        }
    }

    static DEFAULT_OPTIONS = {
        id: "daggerheart-dice-prob",
        tag: "form",
        window: {
            title: "Dice Probability Calculator",
            icon: "fas fa-dice-d20",
            resizable: false,
            width: 460, 
            height: "auto"
        },
        position: { width: 460, height: "auto" },
        actions: {
            setRollType: DiceProbability.prototype._onSetRollType,
            setDie1: DiceProbability.prototype._onSetDie1,
            setDie2: DiceProbability.prototype._onSetDie2,
            setAdvDie: DiceProbability.prototype._onSetAdvDie,
            sendToChat: DiceProbability.prototype._onSendToChat
        },
        form: {
            handler: DiceProbability.prototype._onSubmit,
            submitOnChange: false,
            closeOnSubmit: false
        }
    };

    static PARTS = {
        form: {
            template: "modules/daggerheart-advmanager/templates/dice-probability.hbs"
        }
    };

    async _prepareContext(_options) {
        // Difficulty options 5-30
        const diffOptions = [];
        for (let i = 5; i <= 30; i++) {
            diffOptions.push({ value: i, label: String(i) });
        }
        const prepareOptions = (opts, current) => opts.map(o => ({ ...o, selected: o.value == current }));

        // Button Generators
        const makeDieButtons = (sizes, current) => sizes.map(s => ({
            value: s,
            label: `d${s}`,
            cssClass: s === current ? "active" : ""
        }));

        const dieSizes = [4, 6, 8, 10, 12, 20];
        const advSizes = [4, 6, 8, 10];

        // --- Live Calculation Logic ---
        const stats = this.calculateProbabilities(
            this.formData.die1, 
            this.formData.die2, 
            this.formData.rollType, 
            this.formData.difficulty,
            this.formData.modifier,
            this.formData.advDie
        );

        // Format dice notation
        let diceNotation = `1d${this.formData.die1} + 1d${this.formData.die2}`;
        if (this.formData.rollType === 1) diceNotation += ` + 1d${this.formData.advDie}`;
        else if (this.formData.rollType === -1) diceNotation += ` - 1d${this.formData.advDie}`;
        
        if (this.formData.modifier !== 0) {
            const sign = this.formData.modifier > 0 ? "+" : "-";
            diceNotation += ` ${sign} ${Math.abs(this.formData.modifier)}`;
        }

        const results = {
            ...stats,
            diceNotation,
            difficulty: this.formData.difficulty,
            rollTypeLabel: this.formData.rollType === 1 ? "Advantage" : (this.formData.rollType === -1 ? "Disadvantage" : "Normal")
        };

        // Determine dynamic label for the modifier die row
        let advLabel = "Adv. Die";
        if (this.formData.rollType === -1) {
            advLabel = "Dis. Die";
        }

        return {
            die1Buttons: makeDieButtons(dieSizes, this.formData.die1),
            die2Buttons: makeDieButtons(dieSizes, this.formData.die2),
            advButtons: makeDieButtons(advSizes, this.formData.advDie),
            
            diffOptions: prepareOptions(diffOptions, this.formData.difficulty),
            
            // Current State for UI
            currentModifier: this.formData.modifier,
            rollType: this.formData.rollType,
            
            // Helper booleans for roll type buttons
            isAdvantage: this.formData.rollType === 1,
            isNormal: this.formData.rollType === 0,
            isDisadvantage: this.formData.rollType === -1,
            
            // Show Adv Buttons only if not Normal
            showAdvDie: this.formData.rollType !== 0,
            advLabel: advLabel, // Dynamic Label

            results: results,
            hasResults: true
        };
    }

    _onRender(context, options) {
        super._onRender(context, options);
        
        // Bind change events to inputs (text/select)
        this.element.querySelectorAll('select, input').forEach(input => {
            input.addEventListener('change', (e) => {
                const field = e.target.name;
                const value = Number(e.target.value);
                
                if (!isNaN(value)) {
                    this.formData[field] = value;
                    this.render(); 
                }
            });
        });
    }

    _onSubmit(event, form, formData) {}

    // --- Button Actions ---

    async _onSetDie1(event, target) {
        this.formData.die1 = Number(target.dataset.value);
        this.render();
    }

    async _onSetDie2(event, target) {
        this.formData.die2 = Number(target.dataset.value);
        this.render();
    }

    async _onSetAdvDie(event, target) {
        this.formData.advDie = Number(target.dataset.value);
        this.render();
    }

    async _onSetRollType(event, target) {
        this.formData.rollType = Number(target.dataset.value);
        this.render();
    }

    async _onSendToChat(event, target) {
        const stats = this.calculateProbabilities(
            this.formData.die1, 
            this.formData.die2, 
            this.formData.rollType, 
            this.formData.difficulty,
            this.formData.modifier,
            this.formData.advDie
        );
        
        let diceNotation = `1d${this.formData.die1} + 1d${this.formData.die2}`;
        if (this.formData.rollType === 1) diceNotation += ` + 1d${this.formData.advDie}`;
        else if (this.formData.rollType === -1) diceNotation += ` - 1d${this.formData.advDie}`;
        if (this.formData.modifier !== 0) {
            const sign = this.formData.modifier > 0 ? "+" : "-";
            diceNotation += ` ${sign} ${Math.abs(this.formData.modifier)}`;
        }

        const { success, fail, crit } = stats;
        const labelInput = "Probability Analysis";
        const MESSAGE_TITLE = "Probability Analysis";
        const BACKGROUND_IMAGE = SKULL_IMAGE_PATH;
        const MIN_HEIGHT = "150px";

        const commandContent = `
            <div style="text-align: left; padding: 5px;">
                <p><strong>Dice:</strong> ${diceNotation}</p>
                <p><strong>Difficulty:</strong> ${this.formData.difficulty}</p>
                <hr style="border-color: #C9A060; opacity: 0.5;">
                <p style="color: #98fb98;"><strong>Success:</strong> ${success}%</p>
                <p style="color: #ff6b6b;"><strong>Failure:</strong> ${fail}%</p>
                <p style="color: #ea80fc;"><strong>Critical:</strong> ${crit}%</p>
            </div>
        `;

        const content = `
        <div class="chat-card" style="border: 2px solid #C9A060; border-radius: 8px; overflow: hidden;">
            <header class="card-header flexrow" style="background: #191919 !important; padding: 8px; border-bottom: 2px solid #C9A060;">
                <h3 class="noborder" style="margin: 0; font-weight: bold; color: #C9A060 !important; font-family: 'Aleo', serif; text-align: center; text-transform: uppercase; letter-spacing: 1px; width: 100%;">
                    ${labelInput || MESSAGE_TITLE}
                </h3>
            </header>
            <div class="card-content" style="background-image: url('${BACKGROUND_IMAGE}'); background-repeat: no-repeat; background-position: center; background-size: cover; padding: 20px; min-height: ${MIN_HEIGHT}; display: flex; align-items: center; justify-content: center; text-align: center; position: relative;">
                <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.75); z-index: 0;"></div>
                <span style="color: #ffffff !important; font-size: 1.1em; font-weight: bold; text-shadow: 0px 0px 8px #000000; position: relative; z-index: 1; font-family: 'Lato', sans-serif; line-height: 1.4; width: 100%;">
                    ${commandContent}
                </span>
            </div>
        </div>
        `;

        ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker(),
            content: content
        });

        // REMOVED: ui.notifications.info("Probability results sent to chat.");
    }

    calculateProbabilities(die1, die2, modifierType, difficulty, flatModifier, advDieSize = 6) {
        let totalOutcomes = 0;
        let successCount = 0;
        let failCount = 0;
        let critCount = 0;
        
        // Calculate modifier die outcomes (Adv/Dis) based on selected size
        let modOutcomes = {};
        if (modifierType === 0) {
            modOutcomes[0] = 1;
        } else if (modifierType > 0) {
            // Advantage: +1dX
            for (let m = 1; m <= advDieSize; m++) {
                modOutcomes[m] = 1;
            }
        } else {
            // Disadvantage: -1dX
            for (let m = -advDieSize; m <= -1; m++) {
                modOutcomes[m] = 1;
            }
        }
        
        // Iterate through all possible outcomes
        for (let d1 = 1; d1 <= die1; d1++) {
            for (let d2 = 1; d2 <= die2; d2++) {
                for (let mod in modOutcomes) {
                    totalOutcomes++;
                    // Formula: d1 + d2 + (Adv/Dis) + Flat Modifier
                    let total = d1 + d2 + parseInt(mod) + flatModifier;
                    let isCrit = (d1 === d2);
                    
                    if (total >= difficulty || isCrit) {
                        successCount++;
                    }
                    if (total < difficulty && !isCrit) {
                        failCount++;
                    }
                    if (isCrit) {
                        critCount++;
                    }
                }
            }
        }
        
        return {
            success: ((successCount / totalOutcomes) * 100).toFixed(2),
            fail: ((failCount / totalOutcomes) * 100).toFixed(2),
            crit: ((critCount / totalOutcomes) * 100).toFixed(2),
            totalOutcomes: totalOutcomes
        };
    }
}