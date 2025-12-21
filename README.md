# Daggerheart: 💀 Adversary Manager 💀

<p align="center"><img width="500" src="assets/images/logo.webp"></p>

This module allows you to dynamically change an opponent's tier. For example: if you have a Tier 1 Bear, you can use the module to update its sheet to Tier 3 stats.

## Macros 

Open the manager
```js
AM.Manage()
```

## 🚀 Adversary Tier Scaling Guide

To perform a tier adjustment for adversaries, the module utilizes a comprehensive benchmark derived from all canonical adversaries found in the Daggerheart Core Book. By analyzing these standard values, the module can accurately predict and calculate the necessary stat shifts required to move an adversary from one tier to another.

Scaling Mechanics
In addition to base stat adjustments, the following rules apply when transitioning an adversary between tiers:

Experiences: When an adversary moves to a higher tier, their Experiences are automatically scaled upward. Furthermore, they may gain entirely new Experiences to reflect their increased threat level.

Adversary Features: A curated selection of "Adversary Features" is available for scaling. When an adversary ascends to a higher tier, they may be granted additional features to enhance their mechanical depth.

Configuration and Settings
Both the automatic scaling of Experiences and the addition of new adversary features are considered optional mechanics. These functions can be enabled or disabled individually within the application settings to suit the needs of your campaign.

## 🚀 Installation

Install via the Foundry VTT Module browser or use this manifest link:

* `https://raw.githubusercontent.com/brunocalado/daggerheart-advmanager/main/module.json`

## ⚖️ Credits and License

* **Code License:** MIT License.

* **Assets:** AI Audio and images provided are [CC0 1.0 Universal Public Domain](https://creativecommons.org/publicdomain/zero/1.0/).

**Disclaimer:** This module is an independent creation and is not affiliated with Darrington Press.