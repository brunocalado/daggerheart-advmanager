export const ADVERSARY_BENCHMARKS = {
    "bruiser": {
      "tiers": {
        "tier_1": { "difficulty": "12–14", "threshold_min": "7/14", "threshold_max": "9/18", "hp": "5–7", "stress": "3–4", "attack_modifier": "+0 to +2", "damage_rolls": ["1d8+6", "1d10+4", "1d12+2"], "avg_damage": "8–11", "suggested_features": ["Momentum", "Ramp Up"] },
        "tier_2": { "difficulty": "14–16", "threshold_min": "10/24", "threshold_max": "15/28", "hp": "5–7", "stress": "4–6", "attack_modifier": "+2 to +4", "damage_rolls": ["2d8+6", "2d10+2", "2d10+4", "2d12+2", "2d12+3"], "avg_damage": "12–16", "suggested_features": ["Momentum", "Ramp Up"] },
        "tier_3": { "difficulty": "16–18", "threshold_min": "18/35", "threshold_max": "25/40", "hp": "6–8", "stress": "4–6", "attack_modifier": "+3 to +5", "damage_rolls": ["3d8+8", "3d8+6", "3d10+4", "3d12+2", "3d12+1"], "avg_damage": "18–22", "suggested_features": ["Momentum", "Ramp Up"] },
        "tier_4": { "difficulty": "18–20", "threshold_min": "30/60", "threshold_max": "40/70", "hp": "7–9", "stress": "4–6", "attack_modifier": "+5 to +8", "damage_rolls": ["4d8+12", "4d10+10", "4d12+15"], "avg_damage": "30–45", "suggested_features": ["Momentum", "Ramp Up"] }
      }
    },
    "horde": {
      "tiers": {
        "tier_1": { "difficulty": "10–12", "threshold_min": "5/9", "threshold_max": "10/12", "hp": "5–6", "stress": "2–3", "attack_modifier": "-2 to +0", "damage_rolls": ["1d6+4", "1d8+3", "1d10+2"], "halved_damage_x": ["1d4+1", "1d4+2"], "suggested_features": "" },
        "tier_2": { "difficulty": "12–14", "threshold_min": "10/16", "threshold_max": "15/20", "hp": "5–6", "stress": "2–3", "attack_modifier": "-1 to +1", "damage_rolls": ["2d6+3", "2d6+6", "2d8+4", "2d8+6", "2d10+2"], "halved_damage_x": ["2d4+1", "1d6+3"], "suggested_features": "" },
        "tier_3": { "difficulty": "14–16", "threshold_min": "15/27", "threshold_max": "25/32", "hp": "6–7", "stress": "3–4", "attack_modifier": "+0 to +2", "damage_rolls": ["3d6+6", "3d8+4", "3d10+2"], "halved_damage_x": ["3d4+1", "2d6+2"], "suggested_features": "" },
        "tier_4": { "difficulty": "16–18", "threshold_min": "20/35", "threshold_max": "30/45", "hp": "7–8", "stress": "4–6", "attack_modifier": "+1 to +3", "damage_rolls": ["4d6+10", "4d8+8", "4d10+4"], "halved_damage_x": ["4d4+2", "2d6+5"], "suggested_features": "" }
      }
    },
    "leader": {
      "tiers": {
        "tier_1": { "difficulty": "12–14", "threshold_min": "8/13", "threshold_max": "12/16", "hp": "5–7", "stress": "3–4", "attack_modifier": "+2 to +4", "damage_rolls": ["1d8+5", "1d10+3", "1d12+1"], "suggested_features": ["Momentum", "Move as a Unit", "Rally", "Reinforcements", "Tactician"] },
        "tier_2": { "difficulty": "14–16", "threshold_min": "12/24", "threshold_max": "15/28", "hp": "5–7", "stress": "4–5", "attack_modifier": "+3 to +5", "damage_rolls": ["2d8+6", "2d10+3", "2d12+1"], "suggested_features": ["Momentum", "Move as a Unit", "Rally", "Reinforcements", "Tactician"] },
        "tier_3": { "difficulty": "17–19", "threshold_min": "18/36", "threshold_max": "25/42", "hp": "6–8", "stress": "5–6", "attack_modifier": "+5 to +7", "damage_rolls": ["3d8+8", "3d10+1", "3d10+4", "3d12+1"], "suggested_features": ["Momentum", "Move as a Unit", "Rally", "Reinforcements", "Tactician"] },
        "tier_4": { "difficulty": "19–21", "threshold_min": "30/60", "threshold_max": "60/70", "hp": "7–9", "stress": "6–8", "attack_modifier": "+8 to +10", "damage_rolls": ["4d8+10", "4d10+8", "4d12+6"], "suggested_features": ["Momentum", "Move as a Unit", "Rally", "Reinforcements", "Tactician"] }
      }
    },
    "minion": {
      "tiers": {
        "tier_1": { "difficulty": "10–13", "threshold_thresholds": "None", "hp": "1", "stress": "1", "attack_modifier": "-2 to +0", "minion_feature_x": "3–5", "basic_attack_y": "1–3", "suggested_features": "" },
        "tier_2": { "difficulty": "12–14", "threshold_thresholds": "None", "hp": "1", "stress": "1", "attack_modifier": "-1 to +1", "minion_feature_x": "5–7", "basic_attack_y": "2–4", "suggested_features": "" },
        "tier_3": { "difficulty": "14–16", "threshold_thresholds": "None", "hp": "1", "stress": "1–2", "attack_modifier": "+0 to +2", "minion_feature_x": "7–9", "basic_attack_y": "5–8", "suggested_features": "" },
        "tier_4": { "difficulty": "16–18", "threshold_thresholds": "None", "hp": "1", "stress": "1–2", "attack_modifier": "+1 to +3", "minion_feature_x": "9–12", "basic_attack_y": "10–12", "suggested_features": "" }
      }
    },
    "ranged": {
      "tiers": {
        "tier_1": { "difficulty": "10–12", "threshold_min": "3/6", "threshold_max": "5/9", "hp": "3–4", "stress": "2–3", "attack_modifier": "+1 to +2", "damage_rolls": ["1d8+5", "1d10+3", "1d12+1"], "suggested_features": ["Momentum"] },
        "tier_2": { "difficulty": "13–15", "threshold_min": "5/13", "threshold_max": "8/18", "hp": "3–5", "stress": "2–3", "attack_modifier": "+2 to +5", "damage_rolls": ["2d8+6", "2d10+4", "2d12+2"], "suggested_features": ["Momentum"] },
        "tier_3": { "difficulty": "15–17", "threshold_min": "12/25", "threshold_max": "15/30", "hp": "3–6", "stress": "3–4", "attack_modifier": "+3 to +7", "damage_rolls": ["3d8+6", "3d10+3", "3d12"], "suggested_features": ["Momentum"] },
        "tier_4": { "difficulty": "17–19", "threshold_min": "18/30", "threshold_max": "25/40", "hp": "3–6", "stress": "4–5", "attack_modifier": "+4 to +8", "damage_rolls": ["4d8+10", "4d10+8", "4d12+6"], "suggested_features": ["Momentum"] }
      }
    },
    "skulk": {
      "tiers": {
        "tier_1": { "difficulty": "10–12", "threshold_min": "5/8", "threshold_max": "7/12", "hp": "3–4", "stress": "2–3", "attack_modifier": "+1 to +2", "damage_rolls": ["1d4+4", "1d6+2", "1d8+1"], "suggested_features": ["Advanced Pack Tactics", "Momentum", "Terrifying"] },
        "tier_2": { "difficulty": "12–14", "threshold_min": "7/16", "threshold_max": "9/20", "hp": "3–5", "stress": "3–4", "attack_modifier": "+2 to +5", "damage_rolls": ["2d4+5", "2d6+3", "2d8+1"], "suggested_features": ["Advanced Pack Tactics", "Momentum", "Terrifying"] },
        "tier_3": { "difficulty": "14–16", "threshold_min": "15/27", "threshold_max": "20/32", "hp": "4–6", "stress": "4–5", "attack_modifier": "+3 to +7", "damage_rolls": ["3d4+8", "3d6+6", "3d8+3"], "suggested_features": ["Advanced Pack Tactics", "Momentum", "Terrifying"] },
        "tier_4": { "difficulty": "16–18", "threshold_min": "20/35", "threshold_max": "30/45", "hp": "4–6", "stress": "4–6", "attack_modifier": "+4 to +8", "damage_rolls": ["5d6+10", "4d8+8", "4d10+6"], "suggested_features": ["Advanced Pack Tactics", "Momentum", "Terrifying"] }
      }
    },
    "solo": {
      "tiers": {
        "tier_1": { "difficulty": "12–14", "threshold_min": "8/13", "threshold_max": "12/16", "hp": "8–10", "stress": "3–4", "attack_modifier": "+2 to +3", "damage_rolls": ["1d10+4", "1d12+3", "1d20"], "suggested_features": ["Relentless (X)", "Momentum"] },
        "tier_2": { "difficulty": "14–16", "threshold_min": "12/24", "threshold_max": "15/28", "hp": "8–10", "stress": "4–5", "attack_modifier": "+3 to +4", "damage_rolls": ["2d8+6", "2d10+4", "2d20"], "suggested_features": ["Relentless (X)", "Momentum"] },
        "tier_3": { "difficulty": "17–19", "threshold_min": "18/30", "threshold_max": "25/40", "hp": "10–12", "stress": "5–6", "attack_modifier": "+4 to +7", "damage_rolls": ["3d10+8", "3d12+6", "3d20"], "suggested_features": ["Relentless (X)", "Momentum"] },
        "tier_4": { "difficulty": "19–21", "threshold_min": "30/60", "threshold_max": "40/70", "hp": "10–12", "stress": "6–8", "attack_modifier": "+7 to +10", "damage_rolls": ["4d8+12", "4d10+10", "4d12+12"], "suggested_features": ["Relentless (X)", "Momentum"] }
      }
    },
    "social": {
      "tiers": {
        "tier_1": { "difficulty": "12–14", "threshold_min": "4/8", "threshold_max": "6/10", "hp": "2–4", "stress": "3–5", "attack_modifier": "-4 to +0", "damage_rolls": ["1d4+1", "1d4+2", "1d6+1"], "suggested_features": ["Move as a Unit", "Rally", "Reinforcements", "Tactician"] },
        "tier_2": { "difficulty": "13–15", "threshold_min": "7/13", "threshold_max": "9/19", "hp": "3–5", "stress": "3–5", "attack_modifier": "-2 to +2", "damage_rolls": ["1d4+3", "1d6+2", "2d6+3"], "suggested_features": ["Move as a Unit", "Rally", "Reinforcements", "Tactician"] },
        "tier_3": { "difficulty": "14–16", "threshold_min": "15/30", "threshold_max": "20/35", "hp": "4–6", "stress": "4–6", "attack_modifier": "+0 to +4", "damage_rolls": ["2d6+3", "3d6+1", "3d6+3"], "suggested_features": ["Move as a Unit", "Rally", "Reinforcements", "Tactician"] },
        "tier_4": { "difficulty": "17–18", "threshold_min": "25/40", "threshold_max": "35/50", "hp": "5–7", "stress": "4–6", "attack_modifier": "+2 to +6", "damage_rolls": ["4d4+4", "3d6+8", "4d6+4"], "suggested_features": ["Move as a Unit", "Rally", "Reinforcements", "Tactician"] }
      }
    },
    "standard": {
      "tiers": {
        "tier_1": { "difficulty": "11–13", "threshold_min": "5/8", "threshold_max": "8/12", "hp": "3–4", "stress": "3–4", "attack_modifier": "+0 to +2", "damage_rolls": ["1d4+3", "1d4+4", "1d6+2", "1d8+1"], "suggested_features": "" },
        "tier_2": { "difficulty": "13–15", "threshold_min": "8/16", "threshold_max": "12/20", "hp": "3–5", "stress": "4–5", "attack_modifier": "+1 to +3", "damage_rolls": ["2d4+4", "2d6+3", "2d8+2"], "suggested_features": "" },
        "tier_3": { "difficulty": "15–17", "threshold_min": "15/27", "threshold_max": "20/32", "hp": "4–6", "stress": "5–6", "attack_modifier": "+2 to +4", "damage_rolls": ["3d6+3", "3d8+2", "3d10+1", "3d12+2"], "suggested_features": "" },
        "tier_4": { "difficulty": "17–19", "threshold_min": "25/35", "threshold_max": "35/50", "hp": "5–6", "stress": "5–6", "attack_modifier": "+3 to +5", "damage_rolls": ["4d6+10", "4d8+4", "4d8+6", "4d10+2"], "suggested_features": "" }
      }
    },
    "support": {
      "tiers": {
        "tier_1": { "difficulty": "12–14", "threshold_min": "5/9", "threshold_max": "8/12", "hp": "3–4", "stress": "4–5", "attack_modifier": "+0 to +2", "damage_rolls": ["1d4+4", "1d6+2", "1d8"], "suggested_features": "" },
        "tier_2": { "difficulty": "14–16", "threshold_min": "8/16", "threshold_max": "23/20", "hp": "3–5", "stress": "4–6", "attack_modifier": "+1 to +3", "damage_rolls": ["2d4+3", "2d6+2", "2d8+1"], "suggested_features": "" },
        "tier_3": { "difficulty": "16–18", "threshold_min": "15/28", "threshold_max": "20/35", "hp": "4–6", "stress": "5–6", "attack_modifier": "+2 to +4", "damage_rolls": ["3d6+3", "3d8+2", "3d10"], "suggested_features": "" },
        "tier_4": { "difficulty": "18–20", "threshold_min": "20/35", "threshold_max": "30/45", "hp": "4–6", "stress": "5–6", "attack_modifier": "+3 to +5", "damage_rolls": ["4d6+8", "4d8+6", "3d10+4"], "suggested_features": "" }
      }
    }
};