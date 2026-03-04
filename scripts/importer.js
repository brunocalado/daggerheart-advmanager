/**
 * Feature importer for Daggerheart Adversary Manager.
 * Reads Actor compendiums, extracts embedded items, and creates organized
 * world Item documents with importedFrom flags for feature lookup.
 */

// Items that should ALWAYS be imported, even if they exist in the folder
const ALWAYS_DUPLICATE = [
    "Scapegoat",
    "From Above",
    "Mind Dance",
    "Hallucinatory Breath",
    "Doombringer",
    "Death Quake",
    "Trample"
];

// Colors for Daggerheart Adversary Types folders
const TYPE_COLORS = {
    "Bruiser": "#4a0404",      // Deep Blood Red
    "Horde": "#0f3d0f",        // Dark Forest Green
    "Leader": "#5c4905",       // Dark Bronze/Brown
    "Minion": "#2f3f4f",       // Dark Slate
    "Ranged": "#002366",       // Navy Blue
    "Skulk": "#1a0033",        // Deep Indigo/Black
    "Social": "#660033",       // Deep Maroon/Pink
    "Solo": "#000000",         // Black
    "Standard": "#3b1e08",     // Dark Chocolate
    "Support": "#004d40",      // Deep Teal
    "Unknown": "#333333"       // Dark Gray
};

/**
 * Capitalizes the first letter and lowercases the rest.
 * @param {string} str - Input string.
 * @returns {string} Capitalized string.
 */
function capitalize(str) {
    if (!str) return "";
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Imports features from a Compendium into organized folders in the Items directory.
 * Creates a three-level folder hierarchy: root / adversary-type / feature-category.
 * Deduplicates by name+type+tier+folder unless the item is in ALWAYS_DUPLICATE.
 * @param {string} compendiumId - The ID of the compendium source (e.g., "daggerheart.adversaries").
 * @param {string} rootFolderName - The name of the root folder to create/use in Items directory.
 * @param {string} customTag - The tag to apply to the 'importedFrom.customTag' flag (e.g., "Core", "Void").
 */
export async function importFeatures(compendiumId, rootFolderName, customTag) {
    console.log(`Daggerheart Manager | Starting import from ${compendiumId} to folder "${rootFolderName}" with tag "${customTag}"...`);

    const pack = game.packs.get(compendiumId);
    if (!pack) {
        const msg = `Compendium "${compendiumId}" not found.`;
        ui.notifications.error(msg);
        console.error(msg);
        return;
    }

    if (pack.documentName !== "Actor") {
        ui.notifications.error(`Compendium "${compendiumId}" is not an Actor compendium.`);
        return;
    }

    // 1. Create or Find Main Folder
    let mainFolder = game.folders.find(f => f.name === rootFolderName && f.type === "Item");

    if (!mainFolder) {
        console.log(`Creating main folder "${rootFolderName}"...`);
        mainFolder = await Folder.create({
            name: rootFolderName,
            type: "Item",
            color: "#000000",
            sorting: "a"
        });
    }

    const folderCache = {};

    /**
     * Gets or creates a subfolder under a parent, with caching.
     * @param {string} folderName - Name of the subfolder.
     * @param {string} parentFolderId - ID of the parent folder.
     * @param {string|null} colorCode - Optional color for the folder.
     * @returns {Promise<Folder>}
     */
    async function getOrCreateFolder(folderName, parentFolderId, colorCode = null) {
        const cacheKey = `${parentFolderId}-${folderName}`;
        if (folderCache[cacheKey]) return folderCache[cacheKey];

        let folder = game.folders.find(f =>
            f.name === folderName &&
            f.type === "Item" &&
            f.folder?.id === parentFolderId
        );

        if (!folder) {
            folder = await Folder.create({
                name: folderName,
                type: "Item",
                folder: parentFolderId,
                color: colorCode,
                sorting: "a"
            });
        }

        folderCache[cacheKey] = folder;
        return folder;
    }

    /**
     * Determines the feature category (Action, Reaction, Passive) based on featureForm.
     * @param {Item} item - The item document.
     * @returns {string} Category name.
     */
    function getFeatureCategory(item) {
        const form = String(item.system?.featureForm || "").toLowerCase().trim();
        if (form.includes("reaction")) return "Reaction";
        if (form.includes("action")) return "Action";
        return "Passive";
    }

    /**
     * Creates a single item in the target folder with importedFrom flags.
     * Skips duplicates unless the item name is in ALWAYS_DUPLICATE.
     * @param {Item} itemDoc - The source item document.
     * @param {Folder} folderObj - Target folder.
     * @param {string} sourceName - Name of the source adversary.
     * @param {number} sourceTier - Tier of the source adversary.
     * @param {string} sourceType - Type of the source adversary.
     * @returns {Promise<boolean>} True if created, false if skipped.
     */
    async function createItemInFolder(itemDoc, folderObj, sourceName, sourceTier, sourceType) {
        try {
            const iName = itemDoc.name;
            const iType = itemDoc.type;

            const isSpecialCase = ALWAYS_DUPLICATE.includes(iName);

            if (!isSpecialCase) {
                const existing = game.items.find(i =>
                    i.name === iName &&
                    i.type === iType &&
                    i.folder?.id === folderObj.id &&
                    i.flags?.importedFrom?.tier === sourceTier
                );

                if (existing) return false;
            }

            const itemData = itemDoc.toObject();

            const creationData = {
                name: iName,
                type: iType,
                img: itemData.img || "icons/svg/item-bag.svg",
                system: itemData.system,
                folder: folderObj.id,
                effects: itemData.effects,
                flags: {
                    importedFrom: {
                        compendium: compendiumId,
                        adversary: sourceName,
                        tier: sourceTier,
                        type: sourceType,
                        customTag: customTag,
                        originalId: itemData._id,
                        isSpecialCase: isSpecialCase
                    }
                }
            };

            await Item.create(creationData);
            return true;

        } catch (err) {
            console.error(`Error creating item "${itemDoc.name}":`, err);
            return false;
        }
    }

    // 2. Load Documents
    const allDocs = await pack.getDocuments();
    console.log(`Found ${allDocs.length} documents in ${compendiumId}...`);

    const adversaries = allDocs.filter(doc => doc.type === "adversary");
    const filteredOut = allDocs.length - adversaries.length;

    if (filteredOut > 0) {
        console.log(`Filtered out ${filteredOut} non-adversary actors.`);
    }
    console.log(`Processing ${adversaries.length} adversaries...`);

    let totalCreated = 0;
    let skippedCount = 0;

    // 3. Process Adversaries
    for (const adversary of adversaries) {
        if (adversary.type !== "adversary") {
            console.warn(`Skipping non-adversary: ${adversary.name} (type: ${adversary.type})`);
            continue;
        }

        const rawType = adversary.system?.type || "Standard";
        const advType = capitalize(rawType);
        const tier = Number(adversary.system?.tier) || 0;

        const typeColor = TYPE_COLORS[advType] || TYPE_COLORS["Unknown"];
        const typeFolder = await getOrCreateFolder(advType, mainFolder.id, typeColor);

        for (const item of adversary.items) {
            const categoryName = getFeatureCategory(item);
            const categoryFolder = await getOrCreateFolder(categoryName, typeFolder.id);

            const created = await createItemInFolder(item, categoryFolder, adversary.name, tier, advType);

            if (created) totalCreated++;
            else skippedCount++;
        }
    }

    // Final Report
    console.log(`--- IMPORT FINISHED ---`);
    console.log(`Total Adversaries Processed: ${adversaries.length}`);
    console.log(`Total Items Created: ${totalCreated}`);
    console.log(`Total Items Skipped: ${skippedCount}`);
    if (filteredOut > 0) {
        console.log(`Non-Adversary Actors Filtered: ${filteredOut}`);
    }

    console.log(`Import complete! Created ${totalCreated} items from ${adversaries.length} adversaries.`);

    // Expand main folder in directory
    if (mainFolder) {
        setTimeout(() => {
            const folderElement = document.querySelector(`.directory-item.folder[data-folder-id="${mainFolder.id}"]`);
            if (folderElement) folderElement.classList.remove("collapsed");
        }, 500);
    }
}
