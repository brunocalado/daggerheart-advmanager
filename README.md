# 💀 Adversary Manager 💀
**for Daggerheart**

<p align="center"><img width="500" src="assets/images/logo.webp"></p>

The ultimate GM companion for **Daggerheart** in Foundry VTT. Scale adversaries instantly, build balanced encounters.

<video src="https://github.com/user-attachments/assets/a875027b-eb4a-4637-a4f5-7c61064da22d" 
       controls 
       width="720"
       autoplay 
       loop 
       muted></video>

## 🌟 Overview & Features

### 🛠️ Adversary Scaling & Management

<p align="center"><img width="1400" src="docs/view-livemanager.webp"></p>

* **📈 Instant Tier Scaling:** Effortlessly scale any Adversary from Tier 1 to 4 using official benchmarks.
* **👀 Live Preview Dashboard:** Compare "Current" stats vs. "Target Tier" stats side-by-side before applying any changes.
* **🎲 Smart Math & Probabilities:**
    * Automatically recalculates HP, Stress, Difficulty, and Damage Thresholds.
    * Scales Attack modifiers and Damage formulas.
* **✨ Feature Automation:**
    * Auto-updates Experience values based on Tier difference.
    * Suggests appropriate **Features** (e.g., *Relentless*, *Momentum*) for the target Tier.
* **🔧 Manual Overrides:** Full control to manually tweak any specific stat (HP, Damage, etc) directly in the preview window.
* **📦 Batch & Compendium Support:**
    * Update multiple selected tokens on the canvas simultaneously.
    * Import and auto-scale adversaries directly from Compendiums into your world.

### ⚔️ Encounter Builder

<p align="center"><img width="1400" src="docs/view-encounterbuilder.webp"></p>

* **🔎 Search & Library:** Robust search across World actors and System Compendiums with filters for Tier and Type.
* **🧮 Smart Budgeting:** Automatic **Battle Point (BP)** calculation based on Party Size and Tier. Tracks current cost vs budget limit.
* **🧠 Synergy & Role Detection:** Automatically detects tactical roles like **Summoner**, **Spotlighter**, **Momentum**, and **Relentless**, adjusting the difficulty estimate based on enemy combinations.
* **💀 Difficulty Estimator:** Real-time difficulty assessment (Balanced, Challenging, Deadly, Out of Tier) with visual indicators.
* **🔥 Custom Modifiers:** Apply **Damage Boosts** to specific units or toggle manual difficulty modifiers (Easier/Harder) to fine-tune the challenge.
* **⚡ Quick Deployment:** Build your encounter list and **place tokens directly on the scene** (hidden by default) or organize them into folders.

### 📊 Compendium Statistics

<p align="center"><img width="1400" src="docs/view-compendiumstats.webp"></p>

* **🔍 Stats Explorer:** Browse comprehensive statistics for every adversary type across all 4 Tiers.
* **📋 Data Tables:** View calculated ranges for Difficulty, HP, Stress, Thresholds, Attack Modifiers, and Damage Rolls.
* **🧩 Feature Browser:** See a list of all features found in the compendium for each Tier.
* **🖐️ Drag & Drop:** Click to view feature details or **drag them directly onto an actor sheet**.

### 🎲 Dice Probability Calculator

<p align="center"><img width="400" src="docs/view-diceprob.webp"></p>

* **Live Analysis:** Instantly calculate success, failure, and critical hit chances for Duality Dice rolls.
* **Flexible Options:** Supports Advantage, Disadvantage, and flat numerical modifiers.
* **Chat Integration:** Send detailed probability result cards to the chat log.

## ⚙️ Usage

Access all functions (Adversary Manager, Encounter Builder, Compendium Stats, and Dice Probability) by clicking the buttons in the Daggerheart System Menu or Actor Directory.

<p align="center"><img width="600" src="docs/system-button.webp"></p>

You can also use macros:

```js
// Adversary Manager
AM.Manage();
```

```js
// Encounter Builder
AM.EncounterBuilder();
```

```js
// Compendium Stats
AM.CompendiumStats();
```

```js
// Dice Probability
AM.DiceProbability();
```

## ⚙️ Instructions
Learn more at [WIKI](https://github.com/brunocalado/daggerheart-advmanager/wiki).

## 🚀 Installation

Install via the Foundry VTT Module browser or use this manifest link:

* `https://raw.githubusercontent.com/brunocalado/daggerheart-advmanager/main/module.json`

## 📜 Changelog

You can read the full history of changes in the [CHANGELOG](CHANGELOG.md).

## ⚖️ Credits and License

* **Code License:** MIT License.
* **Assets:** AI Audio and images provided are [CC0 1.0 Universal Public Domain](https://creativecommons.org/publicdomain/zero/1.0/).

**Disclaimer:** This module is an independent creation and is not affiliated with Darrington Press.

## 🧰 My Daggerheart Modules

### 🛒 [daggerheart-store](https://github.com/brunocalado/daggerheart-store)

> A dynamic, interactive, and fully configurable store for the Daggerheart system in Foundry VTT.

### 💀 [daggerheart-advmanager](https://github.com/brunocalado/daggerheart-advmanager)

> The best way to scale and manage your adversaries.

### 📦 [daggerheart-extra-content](https://github.com/brunocalado/daggerheart-extra-content)

> Resources for Daggerheart

### 📏 [daggerheart-distances](https://github.com/brunocalado/daggerheart-distances)

> Visualizes Daggerheart combat ranges with customizable rings and hover distance calculations.

### 😱 [daggerheart-fear-tracker](https://github.com/brunocalado/daggerheart-fear-tracker)

> Adds an animated slider bar with configurable fear tokens to the UI.

### 💀 [daggerheart-death-moves](https://github.com/brunocalado/daggerheart-death-moves)

> Enhances the Death Move moment with immersive audio and visual effects.

### 🤖 [daggerheart-fear-macros](https://github.com/brunocalado/daggerheart-fear-macros)

> Automatically executes macros when the Daggerheart Fear resource is changed.