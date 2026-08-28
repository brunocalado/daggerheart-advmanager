export const ADVERSARY_EXPERIENCES = {
  "bruiser": [
    "Ambusher",
    "Battle-Hardened",
    "Camouflage",
    "Collateral Damage",
    "Huge",
    "Incredible Strength",
    "Intimidation",
    "Intrusion",
    "Keen Senses",
    "Protection",
    "Resilience",
    "Stealth",
    "Swimming",
    "Throw",
    "Unveiled Threats",
    "Unstoppable",
    "Heavy-Handed",
    "Guarded",
    "Demolition",
    "Brawling",
    "Athletics",
    "Tenacious",
    "Siegebreaker",
    "Predator",
    "Thief",
    "Bloodthirsty",
    "Sailor"
  ],
  "horde": [
    "Camouflage",
    "Mob Tactics",
    "Scent Tracking",
    "Scavenging",
    "Swimming",
    "Pack Mentality",
    "Endless",
    "Swarm",
    "Overwhelm",
    "Infestation",
    "Hive Mind",
    "Stampede",
    "Encircle",
    "Tactics",
    "Sailor",
    "Darkness"
  ],
  "leader": [
    "Ancient Knowledge",
    "Animal Handling",
    "Battle Tactics",
    "Bloodhound",
    "Coercion",
    "Command",
    "Diplomacy",
    "Divine Knowledge",
    "Fallen Lore",
    "Forbidden Knowledge",
    "Forest Knowledge",
    "High Society",
    "Intrusion",
    "Leadership",
    "Local Knowledge",
    "Magical Knowledge",
    "Manipulation",
    "Persuasion",
    "Strategic Planning",
    "Swimming",
    "Wisdom of Centuries",
    "Authority",
    "Grand Strategist",
    "Bolstering",
    "Oratory",
    "Warlord",
    "Politics",
    "Cult of Personality",
    "Overseer",
    "Keen Senses",
    "Tactics",
    "Commander",
    "Hunter",
    "Sailor"
  ],
  "minion": [
    "Distraction",
    "Evasion",
    "Intrusion",
    "Keen Senses",
    "Sleight of Hand",
    "Stealth",
    "Lookout",
    "Quick-Reflexes",
    "Expendable",
    "Loyal",
    "Scout",
    "Runner",
    "Opportunist",
    "Obedient",
    "Darkness",
    "Thief"
  ],
  "ranged": [
    "Ancient Knowledge",
    "Deadly Aim",
    "Heightened Perception",
    "Local Knowledge",
    "Magical Knowledge",
    "Manipulation",
    "Marksmanship",
    "Strategize",
    "Eagle Eye",
    "High-Ground Advantage",
    "Suppressing Fire",
    "Sniper",
    "Ricochet",
    "Ballistics",
    "Spotter",
    "Quick Draw",
    "Stealth"
  ],
  "skulk": [
    "Acrobatics",
    "Blend In",
    "Bloodthirsty",
    "Camouflage",
    "Deception",
    "Intrusion",
    "Keen Senses",
    "Light Feet",
    "Manipulation",
    "Poisoner",
    "Sleight of Hand",
    "Infiltrator",
    "Silent-Step",
    "Saboteur",
    "Shadows",
    "Escape Artist",
    "Assassination",
    "Dirty Tricks",
    "Disguise",
    "Stealth"
  ],
  "solo": [
    "Adaptability",
    "Boundless Knowledge",
    "Camouflage",
    "Combat Mastery",
    "Conquest",
    "History",
    "Hunt from Above",
    "Intimidation",
    "Local Knowledge",
    "Magical Knowledge",
    "Manipulation",
    "Navigation",
    "Perception",
    "Scent Tracking",
    "Self-Sufficiency",
    "Stealth",
    "Survival",
    "Tracker",
    "Legendary Prowess",
    "Unyielding",
    "Apex Predator",
    "Immortal",
    "Mastermind",
    "Arcane Mastery",
    "Indomitable",
    "Mythic",
    "Giant-Sized",
    "Hunter",
    "Tactics",
    "Magic",
    "Bloodthirsty"
  ],
  "social": [
    "Administration",
    "Barter",
    "Deception",
    "High Society",
    "History",
    "Manipulation",
    "Negotiation",
    "Performance",
    "Shrewd Negotiator",
    "Silver Tongue",
    "Social Manners",
    "Regal Bearing",
    "Eloquence",
    "Insightful",
    "Bribery",
    "Charm",
    "Courtier",
    "Gossip",
    "Connections",
    "Nobility",
    "Socialite"
  ],
  "standard": [
    "Ancient Knowledge",
    "Discipline",
    "Local Knowledge",
    "Magical Knowledge",
    "Mechanics",
    "Stealth",
    "Swimming",
    "Combat Training",
    "Versatility",
    "Stout",
    "Patrol",
    "Drill",
    "Formation",
    "Teamwork",
    "Vigilance",
    "Aquatic",
    "Keen Senses",
    "Hunter",
    "Camouflage",
    "Thief",
    "Magic"
  ],
  "support": [
    "Animal Knowledge",
    "Assistance",
    "Cartography",
    "First Aid",
    "Forest Knowledge",
    "Healing",
    "History",
    "Inspiration",
    "Lay of the Land",
    "Magical Knowledge",
    "Manipulation",
    "Nature's Friend",
    "Rituals",
    "Restoration",
    "Warding",
    "Guidance",
    "Blessing",
    "Alchemy",
    "Scholar",
    "Herbalism",
    "Divination",
    "Ancient Knowledge",
    "Magic"
  ]
};
export const ADVERSARY_BENCHMARKS = {
  "bruiser": {
    "tiers": {
      "tier_1": {
        "difficulty": "10/14",
        "threshold_min": "7/14",
        "threshold_max": "9/17",
        "hp": "5/7",
        "stress": "2/4",
        "attack_modifier": "+1/+2",
        "damage_rolls": [
          "1d10+1",
          "2d6",
          "1d8+3",
          "1d10+2",
          "1d12+2",
          "1d4+6"
        ],
        "avg_damage": "7/9",
        "experiences": {
          "amount": "1/2",
          "modifier": "+2/+3"
        }
      },
      "tier_2": {
        "difficulty": "14/15",
        "threshold_min": "14/27",
        "threshold_max": "15/28",
        "hp": "6/8",
        "stress": "3/5",
        "attack_modifier": "+2/+3",
        "damage_rolls": [
          "2d12",
          "2d10+2",
          "2d10+3",
          "2d8+5",
          "2d10+4",
          "2d12+3"
        ],
        "avg_damage": "13/16",
        "experiences": {
          "amount": "1/2",
          "modifier": "+2/+3"
        }
      },
      "tier_3": {
        "difficulty": "17",
        "threshold_min": "21/40",
        "threshold_max": "22/40",
        "hp": "6/10",
        "stress": "3/5",
        "attack_modifier": "+2/+7",
        "damage_rolls": [
          "2d12+1",
          "3d8+1",
          "3d8+2",
          "3d10+1",
          "3d8+4",
          "3d10+2"
        ],
        "avg_damage": "14/19",
        "experiences": {
          "amount": "1/2",
          "modifier": "+2/+4"
        }
      },
      "tier_4": {
        "difficulty": "19/20",
        "threshold_min": "35/69",
        "threshold_max": "40/71",
        "hp": "7/10",
        "stress": "4/5",
        "attack_modifier": "+4/+7",
        "damage_rolls": [
          "4d6+13",
          "4d10+10",
          "4d12+15",
          "4d20"
        ],
        "avg_damage": "27/42",
        "experiences": {
          "amount": "1/2",
          "modifier": "+2/+4"
        }
      }
    }
  },
  "horde": {
    "tiers": {
      "tier_1": {
        "difficulty": "8/12",
        "threshold_min": "4/8",
        "threshold_max": "6/11",
        "hp": "4/6",
        "stress": "2/3",
        "attack_modifier": "-3/+1",
        "damage_rolls": [
          "1d8",
          "1d4+2",
          "1d8+2",
          "1d6+3",
          "1d8+3",
          "1d10+2"
        ],
        "avg_damage": "5/8",
        "halved_damage_x": [
          "1d4",
          "1d4+1",
          "1d4+2"
        ],
        "experiences": {
          "amount": "0/1",
          "modifier": "+2/+3"
        }
      },
      "tier_2": {
        "difficulty": "13/15",
        "threshold_min": "9/19",
        "threshold_max": "11/21",
        "hp": "4/6",
        "stress": "3",
        "attack_modifier": "+0/+1",
        "damage_rolls": [
          "2d6+2",
          "2d6+3",
          "2d8+2",
          "2d6+4"
        ],
        "avg_damage": "9/11",
        "halved_damage_x": [
          "1d6+1",
          "2d4+1",
          "1d6+3"
        ],
        "experiences": {
          "amount": "0/1",
          "modifier": "+2/+3"
        }
      },
      "tier_3": {
        "difficulty": "14/16",
        "threshold_min": "15/27",
        "threshold_max": "25/32",
        "hp": "6/8",
        "stress": "3/4",
        "attack_modifier": "+0/+2",
        "damage_rolls": [
          "3d6+6",
          "3d6+8"
        ],
        "avg_damage": "17/19",
        "halved_damage_x": [
          "2d6",
          "2d6+2"
        ],
        "experiences": {
          "amount": "0/2",
          "modifier": "+2/+4"
        }
      },
      "tier_4": {
        "difficulty": "17",
        "threshold_min": "24/45",
        "threshold_max": "25/48",
        "hp": "7/8",
        "stress": "5/6",
        "attack_modifier": "+2",
        "damage_rolls": [
          "4d10",
          "4d6+10"
        ],
        "avg_damage": "22/24",
        "halved_damage_x": [
          "2d10",
          "2d6+5"
        ],
        "experiences": {
          "amount": "0/2",
          "modifier": "+2/+4"
        }
      }
    }
  },
  "leader": {
    "tiers": {
      "tier_1": {
        "difficulty": "13/14",
        "threshold_min": "6/13",
        "threshold_max": "8/14",
        "hp": "6/7",
        "stress": "2/4",
        "attack_modifier": "+2/+4",
        "damage_rolls": [
          "1d8+3",
          "1d10+2",
          "1d12+2",
          "1d8+4",
          "1d10+4",
          "1d8+5"
        ],
        "avg_damage": "8/10",
        "experiences": {
          "amount": "1/2",
          "modifier": "+2/+3"
        }
      },
      "tier_2": {
        "difficulty": "15/16",
        "threshold_min": "12/24",
        "threshold_max": "13/26",
        "hp": "6/7",
        "stress": "4/5",
        "attack_modifier": "+2/+5",
        "damage_rolls": [
          "2d8+2",
          "2d8+4",
          "2d10+2",
          "2d12",
          "2d12+1",
          "2d10+3"
        ],
        "avg_damage": "11/14",
        "experiences": {
          "amount": "1/2",
          "modifier": "+2/+3"
        }
      },
      "tier_3": {
        "difficulty": "16/18",
        "threshold_min": "18/36",
        "threshold_max": "24/42",
        "hp": "6/8",
        "stress": "5/6",
        "attack_modifier": "+4/+5",
        "damage_rolls": [
          "3d10",
          "3d10+1",
          "3d10+4",
          "2d20+4"
        ],
        "avg_damage": "17/25",
        "experiences": {
          "amount": "1/2",
          "modifier": "+2/+3"
        }
      },
      "tier_4": {
        "difficulty": "20/21",
        "threshold_min": "33/66",
        "threshold_max": "37/70",
        "hp": "7/9",
        "stress": "5/8",
        "attack_modifier": "+6/+8",
        "damage_rolls": [
          "4d10+10",
          "4d12+8"
        ],
        "avg_damage": "32/34",
        "experiences": {
          "amount": "1/2",
          "modifier": "+3/+4"
        }
      }
    }
  },
  "minion": {
    "tiers": {
      "tier_1": {
        "difficulty": "8/11",
        "threshold_thresholds": "None",
        "hp": "1",
        "stress": "1",
        "attack_modifier": "-3/+3",
        "minion_feature_x": "3/4",
        "basic_attack_y": "1/3",
        "experiences": {
          "amount": "0/1",
          "modifier": "+2/+4"
        }
      },
      "tier_2": {
        "difficulty": "12/13",
        "threshold_thresholds": "None",
        "hp": "1",
        "stress": "1/2",
        "attack_modifier": "-1/+3",
        "minion_feature_x": "5/6",
        "basic_attack_y": "4/6",
        "experiences": {
          "amount": "0/1",
          "modifier": "+2/+4"
        }
      },
      "tier_3": {
        "difficulty": "14/16",
        "threshold_thresholds": "None",
        "hp": "1",
        "stress": "1/2",
        "attack_modifier": "+0/+3",
        "minion_feature_x": "6/9",
        "basic_attack_y": "5/8",
        "experiences": {
          "amount": "0/2",
          "modifier": "+2/+4"
        }
      },
      "tier_4": {
        "difficulty": "17/18",
        "threshold_thresholds": "None",
        "hp": "1",
        "stress": "1/2",
        "attack_modifier": "+2/+3",
        "minion_feature_x": "12/13",
        "basic_attack_y": "10/12",
        "experiences": {
          "amount": "0/2",
          "modifier": "+2/+4"
        }
      }
    }
  },
  "ranged": {
    "tiers": {
      "tier_1": {
        "difficulty": "9/13",
        "threshold_min": "4/7",
        "threshold_max": "4/8",
        "hp": "2/3",
        "stress": "2",
        "attack_modifier": "-1/+2",
        "damage_rolls": [
          "1d8+1",
          "1d6+3",
          "1d8+3",
          "1d10+2"
        ],
        "avg_damage": "6/8",
        "experiences": {
          "amount": "0/1",
          "modifier": "+2/+3"
        }
      },
      "tier_2": {
        "difficulty": "13/16",
        "threshold_min": "6/14",
        "threshold_max": "11/23",
        "hp": "3/5",
        "stress": "3/6",
        "attack_modifier": "+2/+4",
        "damage_rolls": [
          "2d8+3",
          "2d8+4",
          "2d10+2",
          "2d10+4"
        ],
        "avg_damage": "12/15",
        "experiences": {
          "amount": "0/2",
          "modifier": "+2/+3"
        }
      },
      "tier_3": {
        "difficulty": "15/18",
        "threshold_min": "12/25",
        "threshold_max": "20/32",
        "hp": "3/6",
        "stress": "3/6",
        "attack_modifier": "+3/+7",
        "damage_rolls": [
          "3d8+3",
          "3d10+3"
        ],
        "avg_damage": "17/20",
        "experiences": {
          "amount": "0/3",
          "modifier": "+2/+4"
        }
      },
      "tier_4": {
        "difficulty": "17/19",
        "threshold_min": "18/30",
        "threshold_max": "25/45",
        "hp": "3/6",
        "stress": "3/6",
        "attack_modifier": "+4/+8",
        "damage_rolls": [
          "4d8+8"
        ],
        "avg_damage": "26",
        "experiences": {
          "amount": "0/3",
          "modifier": "+3/+4"
        }
      }
    }
  },
  "skulk": {
    "tiers": {
      "tier_1": {
        "difficulty": "11/13",
        "threshold_min": "4/7",
        "threshold_max": "5/10",
        "hp": "2/4",
        "stress": "2/3",
        "attack_modifier": "-1/+2",
        "damage_rolls": [
          "1d6",
          "1d4+1",
          "1d6+1",
          "1d4+2",
          "1d8+1",
          "1d6+2"
        ],
        "avg_damage": "4/6",
        "experiences": {
          "amount": "1/2",
          "modifier": "+2/+4"
        }
      },
      "tier_2": {
        "difficulty": "13/15",
        "threshold_min": "8/17",
        "threshold_max": "9/19",
        "hp": "4/5",
        "stress": "3/5",
        "attack_modifier": "+2/+3",
        "damage_rolls": [
          "2d6+1",
          "2d6+3",
          "2d8+1",
          "2d8+2",
          "2d8+3",
          "2d8+4"
        ],
        "avg_damage": "8/13",
        "experiences": {
          "amount": "1/2",
          "modifier": "+2/+4"
        }
      },
      "tier_3": {
        "difficulty": "14/17",
        "threshold_min": "16/30",
        "threshold_max": "18/35",
        "hp": "5/6",
        "stress": "3/5",
        "attack_modifier": "+2/+4",
        "damage_rolls": [
          "3d6+1",
          "2d6+7",
          "3d8+1",
          "3d8+2",
          "3d8+4",
          "3d8+5"
        ],
        "avg_damage": "12/19",
        "experiences": {
          "amount": "1/2",
          "modifier": "+3/+4"
        }
      },
      "tier_4": {
        "difficulty": "16/18",
        "threshold_min": "20/35",
        "threshold_max": "30/52",
        "hp": "5/6",
        "stress": "4/6",
        "attack_modifier": "+4/+8",
        "damage_rolls": [
          "4d10+10"
        ],
        "avg_damage": "32",
        "experiences": {
          "amount": "1/2",
          "modifier": "+3/+4"
        }
      }
    }
  },
  "solo": {
    "tiers": {
      "tier_1": {
        "difficulty": "13/14",
        "threshold_min": "7/14",
        "threshold_max": "8/15",
        "hp": "8/9",
        "stress": "3/4",
        "attack_modifier": "+2/+4",
        "damage_rolls": [
          "1d12",
          "1d10+2",
          "1d12+2",
          "1d10+4",
          "1d20",
          "1d12+4"
        ],
        "avg_damage": "7/11",
        "experiences": {
          "amount": "0/2",
          "modifier": "+2/+3"
        }
      },
      "tier_2": {
        "difficulty": "14/15",
        "threshold_min": "10/20",
        "threshold_max": "15/28",
        "hp": "8/10",
        "stress": "3/6",
        "attack_modifier": "+2/+4",
        "damage_rolls": [
          "2d6+3",
          "2d10",
          "2d10+4",
          "2d12+2",
          "3d6+8",
          "2d12+6"
        ],
        "avg_damage": "10/19",
        "experiences": {
          "amount": "1/2",
          "modifier": "+2/+3"
        }
      },
      "tier_3": {
        "difficulty": "17/18",
        "threshold_min": "20/35",
        "threshold_max": "24/45",
        "hp": "10/12",
        "stress": "6/8",
        "attack_modifier": "+3/+7",
        "damage_rolls": [
          "2d12+2",
          "3d10",
          "3d10+2",
          "4d10",
          "3d12+4",
          "3d20"
        ],
        "avg_damage": "15/32",
        "experiences": {
          "amount": "1/2",
          "modifier": "+3/+4"
        }
      },
      "tier_4": {
        "difficulty": "18/20",
        "threshold_min": "33/58",
        "threshold_max": "38/70",
        "hp": "10/12",
        "stress": "6/10",
        "attack_modifier": "+7/+8",
        "damage_rolls": [
          "4d8+7",
          "4d10+4",
          "4d8+9",
          "4d10+5",
          "4d8+10",
          "4d12+10"
        ],
        "avg_damage": "25/36",
        "experiences": {
          "amount": "1/2",
          "modifier": "+3/+5"
        }
      }
    }
  },
  "social": {
    "tiers": {
      "tier_1": {
        "difficulty": "12/14",
        "threshold_min": "4/8",
        "threshold_max": "6/10",
        "hp": "3",
        "stress": "3/5",
        "attack_modifier": "-4/-3",
        "damage_rolls": [
          "1d4+1",
          "1d4+2",
          "1d6+1",
          "1d6+3"
        ],
        "avg_damage": "4/7",
        "experiences": {
          "amount": "1/2",
          "modifier": "+3"
        }
      },
      "tier_2": {
        "difficulty": "13/15",
        "threshold_min": "7/13",
        "threshold_max": "9/19",
        "hp": "3/5",
        "stress": "3/5",
        "attack_modifier": "-3/-2",
        "damage_rolls": [
          "1d4+3",
          "1d6+2"
        ],
        "avg_damage": "6",
        "experiences": {
          "amount": "1/2",
          "modifier": "+3"
        }
      },
      "tier_3": {
        "difficulty": "16/17",
        "threshold_min": "16/32",
        "threshold_max": "20/32",
        "hp": "4/6",
        "stress": "5/8",
        "attack_modifier": "+0/+3",
        "damage_rolls": [
          "3d6+3",
          "3d6+4",
          "3d8+3",
          "3d8+5"
        ],
        "avg_damage": "14/19",
        "experiences": {
          "amount": "1/2",
          "modifier": "+3"
        }
      },
      "tier_4": {
        "difficulty": "17/18",
        "threshold_min": "25/40",
        "threshold_max": "35/50",
        "hp": "5/7",
        "stress": "5/8",
        "attack_modifier": "+2/+6",
        "damage_rolls": [
          "4d6+8"
        ],
        "avg_damage": "22",
        "experiences": {
          "amount": "2/4",
          "modifier": "+3/+4"
        }
      }
    }
  },
  "standard": {
    "tiers": {
      "tier_1": {
        "difficulty": "11/12",
        "threshold_min": "5/8",
        "threshold_max": "6/11",
        "hp": "3/5",
        "stress": "2/3",
        "attack_modifier": "+0/+1",
        "damage_rolls": [
          "1d6+1",
          "1d8",
          "1d8+1",
          "1d6+2",
          "1d8+2",
          "1d10+1"
        ],
        "avg_damage": "5/7",
        "experiences": {
          "amount": "0/1",
          "modifier": "+2/+3"
        }
      },
      "tier_2": {
        "difficulty": "13/15",
        "threshold_min": "8/18",
        "threshold_max": "10/19",
        "hp": "3/5",
        "stress": "2/4",
        "attack_modifier": "+1/+2",
        "damage_rolls": [
          "2d6+1",
          "2d6+3",
          "2d8+1",
          "2d6+4",
          "2d10",
          "2d8+4"
        ],
        "avg_damage": "8/13",
        "experiences": {
          "amount": "1/2",
          "modifier": "+2/+3"
        }
      },
      "tier_3": {
        "difficulty": "16/17",
        "threshold_min": "18/35",
        "threshold_max": "19/36",
        "hp": "5/7",
        "stress": "4/5",
        "attack_modifier": "+2/+3",
        "damage_rolls": [
          "3d6",
          "3d8",
          "3d8+3",
          "3d8+5",
          "3d10+3"
        ],
        "avg_damage": "11/20",
        "experiences": {
          "amount": "1/2",
          "modifier": "+3/+4"
        }
      },
      "tier_4": {
        "difficulty": "17/19",
        "threshold_min": "25/35",
        "threshold_max": "35/50",
        "hp": "5/7",
        "stress": "4/6",
        "attack_modifier": "+3/+6",
        "damage_rolls": [
          "4d8+4",
          "4d10+8"
        ],
        "avg_damage": "22/30",
        "experiences": {
          "amount": "1/2",
          "modifier": "+3/+5"
        }
      }
    }
  },
  "support": {
    "tiers": {
      "tier_1": {
        "difficulty": "12/14",
        "threshold_min": "5/9",
        "threshold_max": "8/12",
        "hp": "3/4",
        "stress": "4/5",
        "attack_modifier": "+0/+2",
        "damage_rolls": [
          "1d6+2"
        ],
        "avg_damage": "6",
        "experiences": {
          "amount": "1/2",
          "modifier": "+2/+3"
        }
      },
      "tier_2": {
        "difficulty": "13/16",
        "threshold_min": "8/16",
        "threshold_max": "20/23",
        "hp": "3/5",
        "stress": "4/7",
        "attack_modifier": "+1/+3",
        "damage_rolls": [
          "2d4+3",
          "2d6+2",
          "2d6+4"
        ],
        "avg_damage": "8/11",
        "experiences": {
          "amount": "2/3",
          "modifier": "+2/+3"
        }
      },
      "tier_3": {
        "difficulty": "15/17",
        "threshold_min": "15/29",
        "threshold_max": "24/38",
        "hp": "5/8",
        "stress": "4/7",
        "attack_modifier": "+2/+4",
        "damage_rolls": [
          "3d6+2",
          "3d6+5",
          "3d10+6"
        ],
        "avg_damage": "13/23",
        "experiences": {
          "amount": "2/3",
          "modifier": "+2/+3"
        }
      },
      "tier_4": {
        "difficulty": "18/19",
        "threshold_min": "26/42",
        "threshold_max": "27/47",
        "hp": "5/8",
        "stress": "4/7",
        "attack_modifier": "+4/+7",
        "damage_rolls": [
          "4d8+5",
          "4d6+10",
          "4d8+10"
        ],
        "avg_damage": "23/28",
        "experiences": {
          "amount": "2/3",
          "modifier": "+2/+3"
        }
      }
    }
  }
};

export const PC_BENCHMARKS = {
   "tier_1":{
      "evasion":"8/14",
      "hp":"5/9",
      "stress":"6/8",
      "base_damage_thresholds":"6/13",
      "threshold_modifiers_major":"+0/+4",
      "threshold_modifiers_severe":"-1/+6",
      "base_armor_score":"3",
      "armor_modifiers":"+0/+4",
      "standard_max_character_trait":2,
      "absolute_max_character_trait":2
   },
   "tier_2":{
      "evasion":"8/16",
      "hp":"5/11",
      "stress":"6/10",
      "base_damage_thresholds":"9/20",
      "threshold_modifiers_major":"+0/+10",
      "threshold_modifiers_severe":"-2/+12",
      "base_armor_score":"4",
      "armor_modifiers":"+0/+4",
      "standard_max_character_trait":3,
      "absolute_max_character_trait":3
   },
   "tier_3":{
      "evasion":"8/18",
      "hp":"5/12",
      "stress":"6/12",
      "base_damage_thresholds":"11/27",
      "threshold_modifiers_major":"+3/+16",
      "threshold_modifiers_severe":"+1/+20",
      "base_armor_score":"5",
      "armor_modifiers":"+0/+5",
      "standard_max_character_trait":4,
      "absolute_max_character_trait":6
   },
   "tier_4":{
      "evasion":"8/20",
      "hp":"5/12",
      "stress":"6/12",
      "base_damage_thresholds":"13/36",
      "threshold_modifiers_major":"+6/+22",
      "threshold_modifiers_severe":"+4/+28",
      "base_armor_score":"6",
      "armor_modifiers":"+0/+6",
      "standard_max_character_trait":5,
      "absolute_max_character_trait":7
   }
};

export const POWERFUL_FEATURES = {
   "summoner":[
      "Won't Stay Dead",
      "Blood and Souls",
      "Unending Battle",
      "Split",
      "Deadly Companion",
      "Reinforcements",
      "Endless Legions",
      "The Best Muscle Money Can Buy",
      "Open the Gates of Death",
      "Drain and Multiply",
      "More Where That Came From",
      "Summon Tormentors",
      "Ashen Vengeance",
      "All-Consuming Rage",
      "I Have Never Known Defeat",
      "The Hunt Is On",
      "Summoning Ritual",
      "Fallen Hounds",
      "Grow Saplings",
      "Guards, Seize Them!",
      "Crownsguard"
   ],
   "spotlighter":[
      "The Root of Villainy",
      "Group Attack",
      "Split",
      "For the Realm!",
      "Two as One",
      "Deadly Companion",
      "Voice of the Forest",
      "Dance Of Death",
      "Open the Gates of Death",
      "Tactician",
      "Strike as One",
      "Ashen Vengeance",
      "I Have Never Known Defeat",
      "The Hunt Is On",
      "Move as a Unit",
      "Rally Guards",
      "Inevitable Death",
      "Money Is Time",
      "We Are One",
      "Seize Your Moment",
      "Fallen Hounds",
      "Grow Saplings"
   ]
};