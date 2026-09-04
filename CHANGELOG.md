# 0.3.5

Checked against Daggerheart 2.9.2. The module reads and writes adversary data paths and never
calls the system's JavaScript API, so the 2.9.0–2.9.2 changes (custom/homebrew resources on
features and actions, `1d12h + 1d12f` roll formulas, the `Loot` → `Item` label rename) leave it
untouched — the adversary and feature schema the module depends on is unchanged. Verified in a
live 2.9.2 world: a full tier-up, feature add and adversary import all run clean.

- [Changed] Compendium Statistics census (`data/compendium-stats-core.json`) rebuilt against 2.9.2. The stat, damage and feature data is identical to the 2.8.2 census — only the version stamp moved — but matching it restores the instant-open path instead of the ~70s live recalculation.

Foundry moved a document's "which compendium entry is this a copy of" marker from
`flags.core.sourceId` to `_stats.compendiumSource` several releases ago. The module still wrote
the old one, which v14 treats as deprecated and which the system's "Update to latest compendium
version" tool (added in Daggerheart 2.9.0) does not read.

- [Fixed] Features added on a tier-up now record their origin in `_stats.compendiumSource`. They show up correctly in the system's compendium-refresh tool, and the feature links in the change log keep working. Older features that still carry the legacy flag are read either way.
- [Changed] Adversaries imported through the Encounter Builder now carry the same origin marker, so the system's compendium-refresh tool recognises them too.

# 0.3.4

Daggerheart 2.8 folded the Hope & Fear adversaries into the system compendium, taking it from 129
to 264 stat blocks. The scaling benchmarks had been derived from the core rulebook alone, so every
tier-up was measured against half the material — and four type/tier combinations the core book
never printed had no data behind them at all.

- [Changed] Benchmarks rebuilt from the whole system compendium (264 adversaries, core + Hope & Fear). Ranges come from the 15th-85th percentile where a type/tier has enough stat blocks, so a single outlier no longer widens a range.
- [Added] Horde Tier 3, Skulk Tier 4, Social Tier 4 and Standard Tier 4 now rest on real numbers instead of interpolation.
- [Fixed] Support Tier 2 listed its damage thresholds inverted (Major 23 / Severe 20).
- [Added] Around 30 Experience names from the new material.
- [Added] `tools/build-benchmarks.mjs`, which re-derives the benchmarks from the compendium, so they can be rebuilt whenever the system ships new adversaries.

Hope & Fear also stores a flat attack differently: `flatMultiplier: 0` with the die string left in
place. The module took the leftover die at face value.

- [Fixed] A minion dealing 1 damage was displayed and re-tiered as 1d6+1; Temporal Enforcer's flat 40 read as 1d6+40. Affects the Live Manager, Compendium Statistics and the change log.
- [Fixed] Re-tiering a minion left the old damage bonus behind, which resurfaced as NdX+bonus if the custom-damage box was ever unticked.

Compendium Statistics read all 264 adversary documents on every open, which grew to over a minute.

- [Changed] It now loads a pre-computed census that ships with the module (`data/compendium-stats-core.json`); opening the window went from ~70s to under a second. Extra compendiums you add are still read live and merged on top.
- [Changed] The window paints immediately instead of staying blank while it loads.
- [Added] The census is stamped with the system version and adversary count. When it no longer matches, the window says so and recalculates from the compendium rather than showing stale numbers.
- [Added] `AM.BuildStatsSnapshot()` rebuilds the census inside a world and downloads it — run it once per Daggerheart release and save the file over `data/compendium-stats-core.json`.
- [Changed] A recalculation caused by an out-of-date census is kept for the rest of the session, so a system patch release costs that load once instead of on every open.

The module no longer has an opinion about which features suit a tier.

- [Removed] Suggested Features: the curated per-tier lists, the ⭐ that marked them in the preview, and the "Auto-Add Features on Tier Up" setting that added one by itself when levelling up.
- [Changed] The preview panel stays and is now plainly a picker: it lists every feature in your compendiums matching the target Tier and Type, and adds only what you tick. The setting that shows it is now called "Show New Features Panel".

Note for anyone using the feature library: as shipped, the bundled `all-features` compendium covers
634 of the 709 feature names the system now has. Re-import it (see the wiki) to pick up the rest and
have them offered in the picker.
# 0.3.3

- removed ai assets

# 0.3.2

Daggerheart 2.6 restructured adversary attack damage: `system.attack.damage.parts` was replaced by
`damage.main` (the hit-points part, which now also carries the direct flag) plus `damage.resources`.
The module still read and wrote the old path, so it silently found nothing and had its writes
discarded by the system — no console errors. All damage access now resolves either schema shape.

- [Fixed] Live Manager: the Attack Damage field no longer starts empty and no longer clears itself after being edited.
- [Fixed] Live Manager: the Current panel shows the adversary's attack damage again instead of `None`.
- [Fixed] Live Manager: Direct damage reflects the adversary's real value again instead of always reading `No`, and changing it is saved.
- [Fixed] Live Manager: the Phys/Mag checkboxes reflect the adversary's actual damage types again.
- [Fixed] Feature damage (Horde/Minion) scales with the target tier again.
- [Fixed] Compendium Stats collects damage and halved-damage rolls again.

# 0.3.1

- [Fixed] Module CSS no longer leaks into other modules, systems, or Foundry UI — every style is now scoped under the module-id class (resolves conflict with daggerheart-store).
- [Fixed] Module windows failing to open due to a circular-import error (`MODULE_ID` referenced before initialization).

# 0.2.8

- v14
- https://github.com/brunocalado/daggerheart-advmanager/issues/7
- https://github.com/brunocalado/daggerheart-advmanager/issues/6
- Multiple fixes from PR https://github.com/brunocalado/daggerheart-advmanager/pull/5
- Features updated to DH 2x

# 0.2.7
- Last release for v13

# 0.2.5
- small fix for experiences

# 0.2.4
- Minion (X) feature will be updated
- Minion Group Attack feature will show up
- Migrate to SCSS
- Updated Core Features with system compendium 1.7.2
- Live Manager toogle button to auto render the modified actor
- js code refactor
- Refactored all templates

# 0.2.3
- refactor for the future
- Non GM users can't access the module anymore

# 0.2.2
- fixed empty compendiuns

# 0.2.1
- better feature detection to live manager

# 0.2.0
- you can change the name of an actor
- compendium stats only read adversaries
- dice probability does d20 now
- You can drag actors or a folder with actors to the encounter builder.
- added tooltip to new features

# 0.1.9
- new adversaries template

# 0.1.8
- fixed CSS leak
- moved exps out of the community table
- more experiences
- small css fix for encounter builder
- custom features can be tagged
- new function to import the features from an entire compendium flaging it to use in the live manager
- live manager visual improvements
- You can add more compendiuns to compendium-stats 
- removed custom features from live manager
- mass update uses suggested experiences
- minion feature show linked feature
- You can edit flags from feature

# 0.1.7
- encounter builder shows cost for each actor
- encounter builder shows how many adversaries you added
- encounter builder clear button
- nice art for actors without art
- new features have tags
- you can choose any official feature to any actor
- you can add your homebrew features
- live manager All Sources fixed
- easier to ready things on live manager
- live manager You can preview damage type and change it
- live manager You can change the critical now + crit chance
- you can change direct damage
- you can name the folder before create the encounter
- better name for created subfolders

# 0.1.6
- compendium-stats shows experience
- experiences uses new rule
- feature changes: you can read the feature; you can quickly remove bonus
- damnage in live manager show min max and mean damage 
- css improvements
- more suggested features
- you can pick a new set of suggested features from another type
- horde feature working well
- fixed add multiple features in the live manager
- experiences suggestions
- terrifying can increase difficult
- compendium-stats can find correct features now


# 0.1.5
- small css fix