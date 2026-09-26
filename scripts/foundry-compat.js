/**
 * Helpers around Foundry VTT v14 document and application APIs.
 */

/**
 * Finds an open application by id. AppV2 windows are not in ui.windows, so this walks the
 * class's live instances.
 * @param {string} id - Application id from DEFAULT_OPTIONS.
 * @param {typeof foundry.applications.api.ApplicationV2|null} ApplicationClass - Optional AppV2 subclass.
 * @returns {Application|null}
 */
export function findApplicationById(id, ApplicationClass = null) {
    const seen = new Set();
    const classes = [ApplicationClass, foundry.applications.api.ApplicationV2].filter(Boolean);

    for (const cls of classes) {
        for (const app of cls.instances()) {
            if (seen.has(app)) continue;
            seen.add(app);
            if (app?.id === id) return app;
        }
    }

    return null;
}

/**
 * Prepares document data for creating a fresh world or embedded Document from a compendium source.
 * Uses fromCompendium() for compendium documents (strips identity fields for v14 validation).
 * @param {Document|Object} document - Source document or data object.
 * @param {WorldCollection|null} collection - Matching world collection (e.g. game.actors, game.items).
 * @param {Object} updateData - Extra creation data to merge in.
 * @returns {Object} Safe creation data.
 */
export function prepareDocumentCreateData(document, collection = null, updateData = {}) {
    let data;

    if (document?.compendium && collection) {
        data = collection.fromCompendium(document);
    } else if (document?.toObject) {
        data = document.toObject();
    } else {
        data = foundry.utils.deepClone(document ?? {});
    }

    data = foundry.utils.deepClone(data);
    delete data._id;

    // Drop the stale _stats block (timestamps, author, core/system versions) that v14 rejects on
    // create — but keep compendiumSource. That is the provenance the system's "Update to latest
    // compendium version" tool (Daggerheart 2.9+) and this module's change-log links read;
    // fromCompendium() populates it, a plain toObject() carries whatever the source already had.
    const compendiumSource = data._stats?.compendiumSource ?? null;
    delete data._stats;
    if (compendiumSource) data._stats = { compendiumSource };

    return foundry.utils.mergeObject(data, updateData, { inplace: false });
}

/**
 * Reads a document's compendium provenance from `_stats.compendiumSource`.
 * Returns "" when nothing is recorded.
 * @param {Document|Object|null|undefined} data - A document or its source data.
 * @returns {string} A compendium uuid, or "".
 */
export function getCompendiumSource(data) {
    return data?._stats?.compendiumSource || "";
}
