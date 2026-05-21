/**
 * Compatibility helpers for Foundry VTT v13/v14 API differences.
 */

/**
 * Finds an open application by id across AppV2 instances and legacy ui.windows.
 * In Foundry v14 AppV2 windows are not in ui.windows, so we search instances first.
 * @param {string} id - Application id from DEFAULT_OPTIONS.
 * @param {typeof foundry.applications.api.ApplicationV2|null} ApplicationClass - Optional AppV2 subclass.
 * @returns {Application|null}
 */
export function findApplicationById(id, ApplicationClass = null) {
    const seen = new Set();
    const classes = [ApplicationClass, foundry.applications?.api?.ApplicationV2].filter(Boolean);

    for (const cls of classes) {
        if (typeof cls.instances !== "function") continue;
        for (const app of cls.instances()) {
            if (seen.has(app)) continue;
            seen.add(app);
            if (app?.id === id) return app;
        }
    }

    return Object.values(globalThis.ui?.windows ?? {}).find(app => app?.id === id) || null;
}

/**
 * Prepares document data for creating a fresh world or embedded Document from a compendium source.
 * Uses fromCompendium() where available (strips identity fields properly for v14 validation).
 * @param {Document|Object} document - Source document or data object.
 * @param {WorldCollection|null} collection - Matching world collection (e.g. game.actors, game.items).
 * @param {Object} updateData - Extra creation data to merge in.
 * @returns {Object} Safe creation data.
 */
export function prepareDocumentCreateData(document, collection = null, updateData = {}) {
    let data;

    if (document?.compendium && collection && typeof collection.fromCompendium === "function") {
        data = collection.fromCompendium(document);
    } else if (document?.toObject) {
        data = document.toObject();
    } else {
        data = foundry.utils.deepClone(document ?? {});
    }

    data = foundry.utils.deepClone(data);
    delete data._id;
    delete data._stats;

    return foundry.utils.mergeObject(data, updateData, { inplace: false });
}
