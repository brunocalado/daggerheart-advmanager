export const I18N_NAMESPACE = "DHAM";

const SYSTEM_KEY_ALIASES = {
    "Common.Adversary": "DAGGERHEART.GENERAL.Adversary.singular",
    "Common.Adversaries": "DAGGERHEART.GENERAL.Adversary.plural",
    "Common.Critical": "DAGGERHEART.GENERAL.criticalShort",
    "Common.CriticalThreshold": "DAGGERHEART.ACTIONS.Settings.criticalThreshold",
    "Common.Current": "DAGGERHEART.UI.Chat.damageRoll.currentTarget",
    "Common.Difficulty": "DAGGERHEART.GENERAL.difficulty",
    "Common.Experiences": "DAGGERHEART.GENERAL.Experience.plural",
    "Common.Failure": "DAGGERHEART.GENERAL.failure",
    "Common.Feature": "TYPES.Item.feature",
    "Common.Features": "DAGGERHEART.GENERAL.features",
    "Common.HP": "DAGGERHEART.GENERAL.HitPoints.short",
    "Common.Max": "DAGGERHEART.GENERAL.max",
    "Common.None": "DAGGERHEART.GENERAL.none",
    "Common.Preview": "DAGGERHEART.GENERAL.preview",
    "Common.Stress": "DAGGERHEART.GENERAL.stress",
    "Common.Success": "DAGGERHEART.GENERAL.success",
    "Common.Type": "DAGGERHEART.GENERAL.type",
    "CompendiumStats.HitPoints": "DAGGERHEART.GENERAL.HitPoints.plural",
    "DamageEngine.Custom": "DAGGERHEART.GENERAL.custom",
    "DiceProbability.Adv": "DAGGERHEART.GENERAL.Advantage.short",
    "DiceProbability.Advantage": "DAGGERHEART.GENERAL.Advantage.full",
    "DiceProbability.Dice": "DAGGERHEART.GENERAL.Dice.plural",
    "DiceProbability.Dis": "DAGGERHEART.GENERAL.Disadvantage.short",
    "DiceProbability.Disadvantage": "DAGGERHEART.GENERAL.Disadvantage.full",
    "DiceProbability.DualityDice": "DAGGERHEART.GENERAL.dualityDice",
    "DiceProbability.Results": "DAGGERHEART.GENERAL.result.plural",
    "DiceProbability.Roll": "DAGGERHEART.GENERAL.roll",
    "DiceProbability.RollType": "DAGGERHEART.APPLICATIONS.TagTeamSelect.rollType",
    "DiceProbability.SendToChat": "DAGGERHEART.UI.Tooltip.sendToChat",
    "Importer.Action": "DAGGERHEART.CONFIG.FeatureForm.action",
    "Importer.Passive": "DAGGERHEART.CONFIG.FeatureForm.passive",
    "Importer.Reaction": "DAGGERHEART.CONFIG.FeatureForm.reaction",
    "LiveManager.MagicalDamage": "DAGGERHEART.GENERAL.Damage.magicalDamage",
    "LiveManager.MagShort": "DAGGERHEART.CONFIG.DamageType.magical.abbreviation",
    "LiveManager.Minion": "DAGGERHEART.CONFIG.AdversaryType.minion.label",
    "LiveManager.NewAdversary": "DAGGERHEART.ACTORS.Environment.newAdversary",
    "LiveManager.PhysicalDamage": "DAGGERHEART.GENERAL.Damage.physicalDamage",
    "Types.bruiser": "DAGGERHEART.CONFIG.AdversaryType.bruiser.label",
    "Types.horde": "DAGGERHEART.CONFIG.AdversaryType.horde.label",
    "Types.leader": "DAGGERHEART.CONFIG.AdversaryType.leader.label",
    "Types.minion": "DAGGERHEART.CONFIG.AdversaryType.minion.label",
    "Types.ranged": "DAGGERHEART.CONFIG.AdversaryType.ranged.label",
    "Types.skulk": "DAGGERHEART.CONFIG.AdversaryType.skulk.label",
    "Types.social": "DAGGERHEART.CONFIG.AdversaryType.social.label",
    "Types.solo": "DAGGERHEART.CONFIG.AdversaryType.solo.label",
    "Types.standard": "DAGGERHEART.CONFIG.AdversaryType.standard.label",
    "Types.support": "DAGGERHEART.CONFIG.AdversaryType.support.label",
    "FeatureForms.action": "DAGGERHEART.CONFIG.FeatureForm.action",
    "FeatureForms.passive": "DAGGERHEART.CONFIG.FeatureForm.passive",
    "FeatureForms.reaction": "DAGGERHEART.CONFIG.FeatureForm.reaction"
};

function systemLocalize(aliasKey, data = null) {
    const systemKey = SYSTEM_KEY_ALIASES[aliasKey];
    if (!systemKey) return null;
    const value = data ? game.i18n.format(systemKey, data) : game.i18n.localize(systemKey);
    return value === systemKey ? null : value;
}

export function localize(key, data = null) {
    const fullKey = `${I18N_NAMESPACE}.${key}`;
    const systemValue = systemLocalize(key, data);
    if (systemValue) return systemValue;

    const value = data ? game.i18n.format(fullKey, data) : game.i18n.localize(fullKey);
    if (value !== fullKey) return value;

    return fullKey;
}

export function localizeType(type) {
    const key = String(type || "standard").toLowerCase();
    const label = localize(`Types.${key}`);
    if (label !== `${I18N_NAMESPACE}.Types.${key}`) return label;
    return key.charAt(0).toUpperCase() + key.slice(1);
}

export function localizeFeatureForm(form) {
    const key = String(form || "").toLowerCase();
    if (!key) return "";
    const label = localize(`FeatureForms.${key}`);
    return label === `${I18N_NAMESPACE}.FeatureForms.${key}` ? key.charAt(0).toUpperCase() + key.slice(1) : label;
}
