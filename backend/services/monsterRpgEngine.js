const DEFAULT_DIFFICULTY = "medium";
const BALANCE = { damageTaken: 1, xp: 1, loot: 1, enemy: 1 };

const STARTERS = [
  {
    species: "Kobold Hatchling",
    stats: { strength: 15, agility: 15, vitality: 10, intelligence: 10, wisdom: 8, resolve: 15, dexterity: 12, perception: 11, luck: 5, charisma: 4, thaumaturgy: 10, health: 100 },
    traits: ["Reincarnated Soul", "Monster Body"],
    active: [
      { key: "bite", name: "Bite", level: 1, xp: 0, cost_type: "stamina", cost: 4, power: 8 },
      { key: "claw", name: "Claw", level: 1, xp: 0, cost_type: "stamina", cost: 5, power: 9 }
    ],
    passive: [{ key: "darkvision", name: "Darkvision", level: 1, xp: 0 }]
  },
  {
    species: "Ash Imp",
    stats: { strength: 4, agility: 7, vitality: 4, intelligence: 6, wisdom: 3, resolve: 4, dexterity: 6, perception: 5, luck: 4, charisma: 3 },
    traits: ["Small Frame", "Ember Blood"],
    active: [{ key: "ember_spit", name: "Ember Spit", level: 1, xp: 0, cost_type: "mp", cost: 4, power: 9 }],
    passive: [{ key: "heat_tolerance", name: "Heat Tolerance", level: 1, xp: 0 }]
  },
  {
    species: "Bone Rat",
    stats: { strength: 5, agility: 8, vitality: 4, intelligence: 3, wisdom: 4, resolve: 5, dexterity: 7, perception: 7, luck: 4, charisma: 1 },
    traits: ["Carrion Scent", "Nimble Skeleton"],
    active: [{ key: "gnaw", name: "Gnaw", level: 1, xp: 0, cost_type: "stamina", cost: 4, power: 8 }],
    passive: [{ key: "danger_sense", name: "Danger Sense", level: 1, xp: 0 }]
  }
];

const AREAS = {
  moss_grotto: {
    name: "Moss Grotto",
    description: "A wet cradle of roots, spores, and things hungry enough to eat newborn monsters.",
    monsters: [
      { name: "Starving Beetle", level: 1, hp: 18, strength: 4, agility: 3, defense: 1, xp: 24 },
      { name: "Needle Larva", level: 2, hp: 22, strength: 5, agility: 5, defense: 1, xp: 34 }
    ]
  },
  moonfen: {
    name: "Moonfen",
    description: "Mist rolls over black water. Lesser tribes hunt here for food, trophies, and sacrifices.",
    monsters: [
      { name: "Fen Goblin", level: 4, hp: 38, strength: 8, agility: 7, defense: 3, xp: 65 },
      { name: "Bog Wisp", level: 5, hp: 30, strength: 5, agility: 10, defense: 2, xp: 72 }
    ]
  }
};

const FLOORS = [
  { floor: 1, area_key: "moss_grotto", name: "Moss Grotto", description: "A wet cradle of roots, spores, and things hungry enough to eat newborn monsters." },
  { floor: 2, area_key: "fungal_sump", name: "Fungal Sump", description: "Pale caps breathe poison over black water and half-eaten bones." },
  { floor: 3, area_key: "bone_runoff", name: "Bone Runoff", description: "A drainage of cracked ribs and scavenger tunnels where every sound carries teeth." },
  { floor: 4, area_key: "moonfen", name: "Moonfen", description: "Mist rolls over black water. Lesser tribes hunt here for food, trophies, and sacrifices." },
  { floor: 5, area_key: "ruined_warren", name: "Ruined Warren", description: "Collapsed dens hide old traps, rival nests, and the remains of failed evolutions." },
  { floor: 6, area_key: "ember_hollow", name: "Ember Hollow", description: "Heat crawls through the stone. Ash-born predators listen for weakness." },
  { floor: 7, area_key: "silver_mire", name: "Silver Mire", description: "Reflective pools show false prey, false exits, and sometimes true futures." },
  { floor: 8, area_key: "obsidian_roots", name: "Obsidian Roots", description: "Ancient roots pierce volcanic glass and drink mana from anything that bleeds." },
  { floor: 9, area_key: "crownless_den", name: "Crownless Den", description: "Apex monsters without kingdoms gather here to test who may descend." },
  { floor: 10, area_key: "monarch_pit", name: "Monarch Pit", description: "The first throne waits below. Something without a crown guards the right to become more." }
];

const BASE_QUESTS = [
  { key: "first_meal", name: "First Meal", status: "active", progress: 0, target: 2, reward: "10 soul XP", description: "Feed twice without dying." },
  { key: "predator_seed", name: "Seed of a Predator", status: "active", progress: 0, target: 3, reward: "Predator title", description: "Win three hunts in this life." }
];

function getFloor(value) {
  const floor = Math.max(1, Math.min(10, Number(value || 1)));
  return FLOORS[floor - 1] || FLOORS[0];
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function pickRandom(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function derivedFromStats(stats) {
  return {
    defense: Math.floor(stats.vitality * 1.4 + stats.resolve * 0.6),
    magic_attack: Math.floor(stats.intelligence * 1.5 + stats.wisdom * 0.5),
    magic_defense: Math.floor(stats.wisdom * 1.3 + stats.resolve * 0.8),
    critical_rate: Math.min(45, Math.floor(3 + stats.dexterity * 0.6 + stats.luck * 0.4)),
    dodge_rate: Math.min(50, Math.floor(4 + stats.agility * 0.7 + stats.perception * 0.3)),
    movement_speed: Math.floor(8 + stats.agility * 1.2)
  };
}

function xpToNext(level) {
  return Math.floor(90 + level * level * 28);
}

function serializeRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    difficulty: row.difficulty || DEFAULT_DIFFICULTY,
    name: row.name,
    race_species: row.species,
    evolution_stage: row.evolution_stage,
    level: row.level,
    xp: row.xp,
    xp_to_next: row.xp_to_next,
    hp: row.hp,
    max_hp: row.max_hp,
    mp: row.mp,
    max_mp: row.max_mp,
    stamina: row.stamina,
    max_stamina: row.max_stamina,
    hunger: row.hunger,
    currency: row.currency,
    reputation: row.reputation,
    soul_level: row.soul_level,
    death_count: row.death_count,
    reincarnation_count: row.reincarnation_count,
    current_floor: Number(row.current_floor || parseJson(row.world_flags_json, {})?.current_floor || 1),
    area_key: row.area_key,
    is_alive: !!row.is_alive,
    stats: parseJson(row.stats_json, {}),
    derived: parseJson(row.derived_json, {}),
    skills: parseJson(row.skills_json, []),
    passive_skills: parseJson(row.passive_skills_json, []),
    active_skills: parseJson(row.active_skills_json, []),
    traits: parseJson(row.traits_json, []),
    titles: parseJson(row.titles_json, []),
    status_effects: parseJson(row.status_effects_json, []),
    equipment: parseJson(row.equipment_json, {}),
    inventory: parseJson(row.inventory_json, []),
    relationships: parseJson(row.relationships_json, []),
    achievements: parseJson(row.achievements_json, []),
    quests: parseJson(row.quests_json, []),
    evolution_progress: parseJson(row.evolution_json, {}),
    world_flags: parseJson(row.world_flags_json, {})
  };
}

function makeScene(run, event = null) {
  const floor = getFloor(run.current_floor);
  const area = AREAS[run.area_key] || {
    name: floor.name,
    description: floor.description,
    monsters: [
      { name: `Floor ${floor.floor} Lurker`, level: floor.floor, hp: 16 + floor.floor * 8, strength: 3 + floor.floor * 2, agility: 3 + floor.floor, defense: Math.floor(floor.floor / 2), xp: 22 + floor.floor * 15 },
      { name: `Hungry Depth Spawn`, level: floor.floor + 1, hp: 18 + floor.floor * 9, strength: 4 + floor.floor * 2, agility: 4 + floor.floor, defense: Math.floor(floor.floor / 2), xp: 28 + floor.floor * 16 }
    ]
  };
  return {
    title: event?.title || run.scene_title || area.name,
    text: event?.text || run.scene_text || area.description,
    area: `Floor ${floor.floor}: ${area.name}`,
    choices: event?.choices || getDefaultChoices(run)
  };
}

function createStartState() {
  const starter = STARTERS[0];
  const stats = { ...starter.stats };
  const derived = derivedFromStats(stats);
  const maxHp = 80;
  const maxMp = 55;
  const maxStamina = 70;

  return {
    difficulty: DEFAULT_DIFFICULTY,
    name: "Krix",
    species: starter.species,
    evolution_stage: 0,
    level: 1,
    xp: 0,
    xp_to_next: 100,
    hp: maxHp,
    max_hp: maxHp,
    mp: maxMp,
    max_mp: maxMp,
    stamina: maxStamina,
    max_stamina: maxStamina,
    hunger: 82,
    soul_level: 1,
    death_count: 0,
    reincarnation_count: 1,
    currency: 0,
    reputation: -5,
    current_floor: 1,
    area_key: "moss_grotto",
    scene_title: "The Time I Got Reincarnated as a Monster",
    scene_text: `Death was supposed to be the end.

One moment you were alive.
The next, there was only darkness.
No sky. No ground. No sound.

Then a voice echoed through your soul.

"Life terminated."

Countless stars appeared around you, each containing fragments of memories from your previous life.
The stars spiraled together.

"Soul compatible."
"Beginning Reincarnation Cycle."

The void shattered.
Images flashed before your eyes.

Dragons. Goblins. Slimes. Wolves. Monsters of every kind.

Then came warmth.
A body.
Small. Weak. Hungry.

You gasped as air filled unfamiliar lungs.
Your eyes snapped open.

You lay within a cavern illuminated by glowing blue mushrooms. Around you were dozens of reptilian creatures with scales, tails, and yellow eyes.

Kobolds.

As your mind struggled to understand, a translucent blue window appeared before your vision.

Another window appeared.

The cave suddenly trembled.
Dust rained from the ceiling.
Several adult kobolds hissed nervously.

Then a roar echoed from deeper within the mountain.

A predator.
A powerful one.

Every instinct screamed danger.

For the first time, you understood the truth.

You weren't a hero.
You weren't a chosen one.
You were a freshly hatched kobold named Krix.

Small.
Weak.
Hungry.
And very easy to eat.`,
    stats,
    derived,
    skills: [...starter.active, ...starter.passive],
    passive_skills: starter.passive,
    active_skills: starter.active,
    traits: starter.traits,
    titles: ["Reincarnated Lesser Monster"],
    status_effects: [],
    equipment: { weapon: null, armor: null, accessory: null },
    inventory: [{ key: "moss_clump", name: "Moss Clump", quantity: 1, type: "food" }],
    relationships: [],
    achievements: [],
    quests: BASE_QUESTS,
    evolution_progress: {
      essence: 0,
      available_paths: ["Kobold Scout", "Kobold Bruiser", "Kobold Shaman"],
      conditions: ["Reach level 5", "Win 3 hunts", "Gain 25 essence"],
      ready: false
    },
    world_flags: { current_floor: 1, hunts_won: 0, actions: {}, discoveries: [], defeated: {} },
    is_alive: true
  };
}

function getDefaultChoices(run) {
  return [
    { key: "search_food", label: "A. Scramble for food before the other hatchlings take it.", detail: "Use instinct and speed." },
    { key: "inspect_body", label: "B. Inspect your new kobold body and the blue window.", detail: "Understand your character sheet." },
    { key: "watch_adults", label: "C. Stay low and watch the adult kobolds.", detail: "Use caution and observation." },
    { key: "follow_roar", label: run.current_floor >= 10 ? "D. Face the source of the roar." : "D. Move toward the deeper roar.", detail: "Risk danger for information." }
  ];
}

function getHatchlingConflictChoices() {
  return [
    { key: "bite_back", label: "A. Bite back at the aggressive hatchling.", detail: "Use Bite Lv.1." },
    { key: "intimidate_hatchling", label: "B. Attempt to intimidate it with a snarl and show of force.", detail: "Use Resolve." },
    { key: "dodge_hatchling", label: "C. Dodge the attack and create distance.", detail: "Use Agility." },
    { key: "drop_food_flee", label: "D. Drop the food and flee.", detail: "Seek an easier meal elsewhere." },
    { key: "outwit_hatchling", label: "E. Use your human intelligence to outwit it.", detail: "Type the trick if you want something specific." }
  ];
}

function normalizeActionKey(actionInput) {
  const text = String(actionInput || "").trim().toLowerCase();
  if (["hunt", "explore", "train", "feed", "descend", "evolve"].includes(text)) return text;
  if (/bite back|aggressive hatchling|bite lv\.?1/.test(text)) return "hatchling_bite";
  if (/intimidate|snarl|show of force|resolve/.test(text)) return "hatchling_intimidate";
  if (/dodge.*hatchling|create distance|agility/.test(text)) return "hatchling_dodge";
  if (/drop.*food|flee|easier meal/.test(text)) return "hatchling_flee";
  if (/outwit|human intelligence|trick/.test(text)) return "hatchling_outwit";
  if (/food|eat|grub|mushroom|worship|obey|hoard|take all|scramble/.test(text)) return "food_dominance";
  if (/bite|claw|attack|fight|beat|hit|strike|kill/.test(text)) return "hunt";
  if (/inspect|sheet|window|body|status/.test(text)) return "inspect_body";
  if (/hide|watch|adult|observe|listen|look/.test(text)) return "explore";
  if (/run|flee|escape|dodge/.test(text)) return "dodge_hatchling";
  if (/deeper|roar|descend|move/.test(text)) return "descend";
  return "freeform";
}

function resolveHatchlingContest(state, actionKey, log) {
  const rival = "the dull-grey hatchling";
  if (actionKey === "hatchling_bite") {
    state.stamina = Math.max(0, state.stamina - 5);
    state.xp += 12;
    addSkillXp(state.active_skills, "bite", 16, log);
    addSkillXp(state.skills, "bite", 16, log);
    log.push(`You lunge before ${rival} can take the mushroom. Your small jaws clamp down hard on its shoulder.

It shrieks, more shocked than broken, and tumbles sideways. The food stays in your claws.

The nearby hatchlings freeze for half a breath. They do not understand worship, but they understand teeth.`);
    return;
  }

  if (actionKey === "hatchling_intimidate") {
    state.stamina = Math.max(0, state.stamina - 3);
    state.stats.resolve += 1;
    state.xp += 10;
    log.push(`You spread your claws, bare your teeth, and force a hiss from a throat that still feels alien.

The sound comes out sharper than expected. ${rival} slows, uncertain. It is bigger, but hunger is not courage.

You keep the grub. More importantly, the smaller hatchlings notice that you did not immediately fold.`);
    return;
  }

  if (actionKey === "hatchling_dodge") {
    state.stamina = Math.max(0, state.stamina - 4);
    state.stats.agility += 1;
    state.xp += 10;
    log.push(`You throw yourself sideways. The grey hatchling's jaws snap shut on empty air, close enough that you feel the heat of its breath.

Your tail slaps stone. The mushroom nearly slips from your claws, but you keep it.

Distance opens. Not safety, but enough space to choose the next move.`);
    return;
  }

  if (actionKey === "hatchling_flee") {
    state.hunger = Math.max(0, state.hunger - 8);
    state.stamina = Math.max(0, state.stamina - 6);
    log.push(`You drop the mushroom and scramble back.

The grey hatchling pounces on the food instead of your throat. It wins the meal. You win another few breaths.

Your stomach twists painfully. Survival is not victory. Sometimes it is only the refusal to die first.`);
    return;
  }

  state.xp += 14;
  state.stats.intelligence += 1;
  log.push(`Your human mind reaches through the panic.

Instead of meeting force with force, you flick the glowing mushroom fragment toward a cluster of smaller hatchlings. Their eyes snap to it. Bodies collide. The grey hatchling hesitates as the food pile becomes chaos.

You use that moment to drag the grub closer and shift behind a stone ridge.

It is not dominance yet. It is the first proof that this tiny body still carries a thinking soul.`);
}

function levelUp(state, log) {
  while (state.xp >= state.xp_to_next) {
    state.xp -= state.xp_to_next;
    state.level += 1;
    state.xp_to_next = xpToNext(state.level);
    state.stats.strength += 1;
    state.stats.vitality += 1;
    state.stats.resolve += state.level % 2 === 0 ? 1 : 0;
    state.max_hp += 8;
    state.max_mp += 3;
    state.max_stamina += 5;
    state.hp = state.max_hp;
    state.mp = state.max_mp;
    state.stamina = state.max_stamina;
    log.push(`Level up: ${state.name} reached level ${state.level}.`);
  }
}

function addSkillXp(skills, key, amount, log) {
  const skill = skills.find((item) => item.key === key);
  if (!skill) return;
  skill.xp = Number(skill.xp || 0) + amount;
  const needed = Number(skill.level || 1) * 40;
  if (skill.xp >= needed) {
    skill.xp -= needed;
    skill.level = Number(skill.level || 1) + 1;
    skill.power = Number(skill.power || 0) + 2;
    log.push(`${skill.name} reached skill level ${skill.level}.`);
  }
}

function incrementAction(state, actionKey) {
  const flags = state.world_flags;
  if (!flags.actions) flags.actions = {};
  flags.actions[actionKey] = Number(flags.actions[actionKey] || 0) + 1;
  return flags.actions[actionKey];
}

function unlockByPractice(state, actionKey, count, log) {
  if (actionKey === "train" && count === 3 && !state.skills.some((skill) => skill.key === "survival_instinct")) {
    const skill = { key: "survival_instinct", name: "Survival Instinct", level: 1, xp: 0, source: "Repeated survival training" };
    state.skills.push(skill);
    state.passive_skills.push(skill);
    log.push("New passive skill acquired: Survival Instinct.");
  }

  if (actionKey === "explore" && count === 3 && !state.skills.some((skill) => skill.key === "scent_memory")) {
    const skill = { key: "scent_memory", name: "Scent Memory", level: 1, xp: 0, source: "Repeated exploration" };
    state.skills.push(skill);
    state.passive_skills.push(skill);
    log.push("New passive skill acquired: Scent Memory.");
  }
}

function updateQuestProgress(state, questKey, amount, log) {
  const quest = state.quests.find((item) => item.key === questKey && item.status === "active");
  if (!quest) return;
  quest.progress = Math.min(quest.target, Number(quest.progress || 0) + amount);
  if (quest.progress >= quest.target) {
    quest.status = "complete";
    log.push(`Quest complete: ${quest.name}.`);
    if (questKey === "predator_seed" && !state.titles.includes("Predator Seed")) {
      state.titles.push("Predator Seed");
      state.reputation += 3;
    }
    if (questKey === "first_meal") {
      state.soul_level += 1;
    }
  }
}

function resolveHunt(state, mod, log) {
  const floor = getFloor(state.current_floor);
  const area = AREAS[state.area_key] || {
    monsters: [
      { name: `Floor ${floor.floor} Lurker`, level: floor.floor, hp: 16 + floor.floor * 8, strength: 3 + floor.floor * 2, agility: 3 + floor.floor, defense: Math.floor(floor.floor / 2), xp: 22 + floor.floor * 15 },
      { name: `Hungry Depth Spawn`, level: floor.floor + 1, hp: 18 + floor.floor * 9, strength: 4 + floor.floor * 2, agility: 4 + floor.floor, defense: Math.floor(floor.floor / 2), xp: 28 + floor.floor * 16 }
    ]
  };
  const monster = { ...pickRandom(area.monsters) };
  monster.hp = Math.floor(monster.hp * mod.enemy);
  monster.strength = Math.floor(monster.strength * mod.enemy);

  const activeSkill = state.active_skills[0];
  const canUseSkill = activeSkill && (activeSkill.cost_type === "mp" ? state.mp >= activeSkill.cost : state.stamina >= activeSkill.cost);
  let playerDamage = Math.max(1, state.stats.strength + Math.floor(state.stats.dexterity / 2) - monster.defense);
  if (canUseSkill) {
    playerDamage += Number(activeSkill.power || 0);
    if (activeSkill.cost_type === "mp") state.mp -= activeSkill.cost;
    else state.stamina -= activeSkill.cost;
    addSkillXp(state.active_skills, activeSkill.key, 18, log);
    addSkillXp(state.skills, activeSkill.key, 18, log);
  }

  const crit = Math.random() * 100 < state.derived.critical_rate;
  if (crit) playerDamage = Math.floor(playerDamage * 1.6);

  const enemyDamage = Math.max(0, Math.floor((monster.strength + monster.level * 2 - state.derived.defense * 0.35) * mod.damageTaken));
  const won = playerDamage >= monster.hp || state.hp > enemyDamage;

  if (won) {
    state.hp = Math.max(1, state.hp - enemyDamage);
    const xpGain = Math.floor(monster.xp * mod.xp);
    const essence = Math.max(2, Math.floor(monster.level * mod.loot));
    state.xp += xpGain;
    state.hunger = Math.max(0, state.hunger - 10);
    state.inventory.push({ key: "monster_meat", name: `${monster.name} Meat`, quantity: 1, type: "food" });
    state.evolution_progress.essence += essence;
    state.world_flags.hunts_won = Number(state.world_flags.hunts_won || 0) + 1;
    state.world_flags.defeated[monster.name] = Number(state.world_flags.defeated[monster.name] || 0) + 1;
    updateQuestProgress(state, "predator_seed", 1, log);
    log.push(`You defeated a ${monster.name}, gained ${xpGain} XP, and absorbed ${essence} essence.`);
  } else {
    state.hp = 0;
    state.is_alive = false;
    state.death_count += 1;
    log.push(`A ${monster.name} killed this body. Death is recorded, but the soul remembers.`);
  }
}

function resolveExplore(state, log) {
  state.hunger = Math.max(0, state.hunger - 6);
  state.stamina = Math.max(0, state.stamina - 5);
  state.xp += 12;
  state.stats.perception += 1;

  const discovery = state.level >= 3 ? "moonfen_path" : "glowcap_nest";
  if (!state.world_flags.discoveries.includes(discovery)) {
    state.world_flags.discoveries.push(discovery);
    state.inventory.push({ key: "glowcap", name: "Glowcap", quantity: 1, type: "material" });
    log.push(discovery === "moonfen_path" ? "You found tracks leading toward the Moonfen." : "You discovered a glowcap nest.");
  } else {
    log.push("You mapped more of the grotto and learned where larger predators patrol.");
  }

  const floor = getFloor(state.current_floor);
  state.area_key = floor.area_key;
}

function resolveTrain(state, log) {
  state.stamina = Math.max(0, state.stamina - 8);
  state.hunger = Math.max(0, state.hunger - 5);
  state.xp += 10;
  state.stats.resolve += 1;
  state.stats.dexterity += 1;
  addSkillXp(state.passive_skills, "survival_instinct", 10, log);
  addSkillXp(state.skills, "survival_instinct", 10, log);
  log.push("You repeat crude movements until instinct starts replacing panic.");
}

function resolveFeed(state, log) {
  const food = state.inventory.find((item) => item.type === "food" && Number(item.quantity || 0) > 0);
  if (food) {
    food.quantity -= 1;
    state.hunger = Math.min(100, state.hunger + 26);
    state.hp = Math.min(state.max_hp, state.hp + 12);
    updateQuestProgress(state, "first_meal", 1, log);
    log.push(`You consumed ${food.name}. Hunger eased and torn flesh knitted together.`);
  } else {
    state.hunger = Math.min(100, state.hunger + 8);
    state.stamina = Math.max(0, state.stamina - 4);
    log.push("You forage scraps from damp stone. It is barely food, but it keeps the body moving.");
  }
}

function resolveEvolve(state, log) {
  const ready = state.level >= 5 && Number(state.world_flags.hunts_won || 0) >= 3 && state.evolution_progress.essence >= 25;
  state.evolution_progress.ready = ready;
  if (!ready) {
    log.push("Your flesh trembles, but the soul lacks the pressure needed for evolution.");
    return;
  }

  const currentSpecies = state.race_species || state.species;
  const nextSpecies = currentSpecies.startsWith("Greater ") ? `Elder ${currentSpecies}` : `Greater ${currentSpecies}`;
  state.race_species = nextSpecies;
  state.species = nextSpecies;
  state.evolution_stage += 1;
  state.evolution_progress.essence -= 25;
  state.stats.strength += 3;
  state.stats.vitality += 4;
  state.stats.resolve += 2;
  state.max_hp += 30;
  state.max_mp += 10;
  state.max_stamina += 20;
  state.hp = state.max_hp;
  state.mp = state.max_mp;
  state.stamina = state.max_stamina;
  state.titles.push(`Evolved ${nextSpecies}`);
  state.traits.push("Evolved Body");
  log.push(`Evolution achieved: you became a ${nextSpecies}. The world will no longer mistake you for harmless prey.`);
}

function resolveDescend(state, log) {
  if (state.current_floor >= 10) {
    state.xp += 45;
    state.evolution_progress.essence += 5;
    log.push("You stand in the Monarch Pit. There is no deeper floor yet, only the trial to become something stronger.");
    return;
  }

  const neededLevel = Math.max(1, state.current_floor);
  if (state.level < neededLevel) {
    log.push(`The passage rejects a weak body. Reach level ${neededLevel} before descending.`);
    return;
  }

  state.current_floor += 1;
  const floor = getFloor(state.current_floor);
  state.area_key = floor.area_key;
  state.world_flags.current_floor = state.current_floor;
  state.hunger = Math.max(0, state.hunger - 8);
  state.stamina = Math.max(0, state.stamina - 6);
  state.xp += 18 + state.current_floor * 4;
  log.push(`You descend to Floor ${floor.floor}: ${floor.name}. ${floor.description}`);
}

function resolveFoodDominance(state, log) {
  state.hunger = Math.max(0, state.hunger - 4);
  state.stamina = Math.max(0, state.stamina - 3);
  state.inventory.push({ key: "cave_grub", name: "Slimy Cave Grub", quantity: 1, type: "food" });
  state.inventory.push({ key: "blue_mushroom_fragment", name: "Blue Mushroom Fragment", quantity: 1, type: "food" });
  state.world_flags.hatchling_rival = "grey_hatchling";
  state.world_flags.food_hoard = true;
  log.push(`The other hatchlings, driven by primal hunger, pay you little mind as you gather a small pile of scraps. They are too busy scrambling amongst themselves, tiny claws and teeth fighting for the easiest morsels.

Taking all the food would draw the ire of every hungry hatchling and likely the adult kobolds nearby. Still, your ambition is clear. You seek dominance even in this newborn body.

You secure a slimy cave grub and a fragment of glowing mushroom. It is not much, but it is a start.

You open your mouth, ready to declare your terms, but the words catch in your throat. These creatures do not understand worship, tribute, or dominion. Their world is simpler.

Eat or be eaten.

A slightly larger hatchling with dull grey scales notices your hoard. It snarls, shoves two smaller kobolds aside, and lunges. Tiny jaws snap toward the mushroom in your grasp.

You have secured a meager portion of food. Now you face immediate competition.`);
}

function resolveInspectBody(state, log) {
  state.xp += 5;
  state.world_flags.inspected_sheet = true;
  log.push(`You stare at your claws until the truth settles in.

Five fingers are gone. Soft human skin is gone. In their place are dark scales, a tail that twitches with your fear, and small claws sharp enough to tear flesh if you commit to it.

The blue window follows your sight without moving.

Name: Krix.
Species: Kobold Hatchling.

The name feels assigned, not remembered. The body accepts it before your mind does.`);
}

function resolveFreeform(state, actionInput, log) {
  state.hunger = Math.max(0, state.hunger - 3);
  state.stamina = Math.max(0, state.stamina - 2);
  log.push(`You try: "${String(actionInput || "").trim()}"

The thought is human. The body answering it is not.

Your small claws flex, your tail drags over cold stone, and the hatchery reacts in simple animal terms: movement, hunger, fear, weakness. Whatever plan you make must pass through this fragile kobold body first.`);
}

function normalizeState(run) {
  const state = serializeRun(run);
  state.stats = { ...state.stats };
  state.derived = derivedFromStats(state.stats);
  state.current_floor = Math.max(1, Math.min(10, Number(state.current_floor || 1)));
  state.area_key = state.area_key || getFloor(state.current_floor).area_key;
  state.world_flags = state.world_flags && typeof state.world_flags === "object" ? state.world_flags : {};
  state.world_flags.current_floor = state.current_floor;
  if (!state.world_flags.actions) state.world_flags.actions = {};
  if (!state.world_flags.discoveries) state.world_flags.discoveries = [];
  if (!state.world_flags.defeated) state.world_flags.defeated = {};
  return state;
}

function applyAction(run, actionInput) {
  const state = normalizeState(run);
  const mod = BALANCE;
  const log = [];
  const actionKey = normalizeActionKey(actionInput);
  const actionCount = incrementAction(state, actionKey);

  if (!state.is_alive && actionKey !== "reincarnate") {
    return {
      state,
      event: {
        title: "Dead Flesh",
        text: "This body is dead. Begin a new reincarnation to continue.",
        log
      }
    };
  }

  if (actionKey.startsWith("hatchling_")) resolveHatchlingContest(state, actionKey, log);
  else if (actionKey === "food_dominance") resolveFoodDominance(state, log);
  else if (actionKey === "inspect_body") resolveInspectBody(state, log);
  else if (actionKey === "hunt") resolveHunt(state, mod, log);
  else if (actionKey === "explore") resolveExplore(state, log);
  else if (actionKey === "train") resolveTrain(state, log);
  else if (actionKey === "feed") resolveFeed(state, log);
  else if (actionKey === "descend") resolveDescend(state, log);
  else if (actionKey === "evolve") resolveEvolve(state, log);
  else resolveFreeform(state, actionInput, log);

  unlockByPractice(state, actionKey, actionCount, log);
  if (state.hunger <= 0 && state.is_alive) {
    state.hp = Math.max(0, state.hp - Math.floor(8 * mod.damageTaken));
    state.status_effects = [{ key: "starving", name: "Starving", severity: "danger" }];
    log.push("Starvation gnaws at the body.");
    if (state.hp <= 0) {
      state.is_alive = false;
      state.death_count += 1;
      log.push("This body collapsed from starvation.");
    }
  }

  levelUp(state, log);
  state.derived = derivedFromStats(state.stats);

  const floor = getFloor(state.current_floor);
  const area = AREAS[state.area_key] || { name: floor.name };
  const title = state.is_alive ? area.name : "Death";
  const text = log.join("\n") || "The world shifts, waiting to see what you become.";

  return {
    state,
    event: {
      title,
      text,
      log,
      choices: actionKey === "food_dominance" ? getHatchlingConflictChoices() : getDefaultChoices(state)
    }
  };
}

function toDbPayload(state, scene = null) {
  return {
    species: state.race_species || state.species,
    evolution_stage: state.evolution_stage,
    level: state.level,
    xp: state.xp,
    xp_to_next: state.xp_to_next,
    hp: state.hp,
    max_hp: state.max_hp,
    mp: state.mp,
    max_mp: state.max_mp,
    stamina: state.stamina,
    max_stamina: state.max_stamina,
    hunger: state.hunger,
    soul_level: state.soul_level,
    death_count: state.death_count,
    reincarnation_count: state.reincarnation_count,
    currency: state.currency,
    reputation: state.reputation,
    current_floor: state.current_floor,
    area_key: state.area_key,
    scene_title: scene?.title || state.scene_title || "The World Watches",
    scene_text: scene?.text || state.scene_text || "",
    stats_json: JSON.stringify(state.stats),
    derived_json: JSON.stringify(state.derived),
    skills_json: JSON.stringify(state.skills),
    passive_skills_json: JSON.stringify(state.passive_skills),
    active_skills_json: JSON.stringify(state.active_skills),
    traits_json: JSON.stringify(state.traits),
    titles_json: JSON.stringify(state.titles),
    status_effects_json: JSON.stringify(state.status_effects),
    equipment_json: JSON.stringify(state.equipment),
    inventory_json: JSON.stringify(state.inventory.filter((item) => Number(item.quantity || 0) !== 0)),
    relationships_json: JSON.stringify(state.relationships),
    achievements_json: JSON.stringify(state.achievements),
    quests_json: JSON.stringify(state.quests),
    evolution_json: JSON.stringify(state.evolution_progress),
    world_flags_json: JSON.stringify(state.world_flags),
    is_alive: state.is_alive ? 1 : 0
  };
}

module.exports = {
  createStartState,
  makeScene,
  applyAction,
  serializeRun,
  toDbPayload
};
