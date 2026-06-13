// =========================================
// SHARED MODULE CONSTANTS
//
// Dependency-free leaf: this file imports nothing from the rest of the module,
// so it can be imported anywhere without circular-import risk. MODULE_ID is
// consumed at class-definition time (static DEFAULT_OPTIONS.classes), which is
// exactly why it must live here and not in module.js — module.js imports the
// Application classes, so importing MODULE_ID from it creates a cycle that puts
// MODULE_ID in the temporal dead zone during static initialization.
// =========================================

/** @type {string} The module id — single source of truth, mirrors module.json "id". */
export const MODULE_ID = "daggerheart-advmanager";
