/*!
 * Daggerheart: Adversary Manager
 * 2025 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * Display label for an adversary type key. Reuses the Daggerheart system's own translation
 * (a lang key only, not CONFIG.DH, so the module stays independent of the system's JS) and
 * falls back to the capitalized key for homebrew types the system has no label for.
 * The module deliberately has no keys of its own for the types: translators would re-translate
 * what the system already ships, and a homebrew type would get nothing either way.
 * @param {string} type  e.g. "bruiser" or "Bruiser"
 * @returns {string}
 */
export function adversaryTypeLabel(type) {
    if (!type) return "";
    const key = `DAGGERHEART.CONFIG.AdversaryType.${type.toLowerCase()}.label`;
    return game.i18n.has(key) ? game.i18n.localize(key) : type.charAt(0).toUpperCase() + type.slice(1);
}
