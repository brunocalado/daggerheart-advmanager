// ============================================================
// Adversary Manager | i18n.js
// Thin wrappers over game.i18n. Every user-facing string lives in lang/*.json under "DHAM".
// ============================================================

const ROOT = "DHAM";

/**
 * Localizes a key relative to the module namespace, formatting placeholders when data is given.
 * @param {string} key - Key without the "DHAM." prefix (e.g. "Notify.GMOnly").
 * @param {Object} [data] - Placeholder values for {name}-style tokens.
 * @returns {string}
 */
export function tr(key, data) {
    const full = `${ROOT}.${key}`;
    return data ? game.i18n.format(full, data) : game.i18n.localize(full);
}

/**
 * Display label for an adversary type key ("bruiser" → "Bruiser").
 * Falls back to the capitalized key for types added by homebrew content.
 * @param {string} type
 * @returns {string}
 */
export function typeLabel(type) {
    if (!type) return "";
    const key = `${ROOT}.Types.${String(type).toLowerCase()}`;
    if (game.i18n.has(key)) return game.i18n.localize(key);
    return type.charAt(0).toUpperCase() + type.slice(1);
}

/**
 * Display label for a tier number ("Tier 2").
 * @param {number|string} n
 * @returns {string}
 */
export function tierLabel(n) {
    return tr("Common.Tier", { n });
}
