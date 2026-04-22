const BASE_CONDITION_STATS = [
  "enemies_killed",
  "times_hidden",
  "times_rested",
  "times_appraised",
  "typed_actions_count",
  "intent:precision_attack",
  "intent:environment_attack",
  "intent:hide",
  "intent:escape",
  "intent:devour_remains",
  "intent:social",
  "risk:high"
];

const DYNAMIC_THRESHOLDS = {
  enemySlayer: 3,
  enemyTypeSlayer: 5,
  stealth: 5,
  creativeTyped: 8,
  precision: 4,
  environment: 4,
  devour: 3,
  social: 4,
  reckless: 5
};

function slugify(value = "") {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function titleCase(value = "") {
  return String(value)
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === "object") return value;

  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function serializeSkill(row) {
  return {
    id: row.id,
    skill_key: row.skill_key,
    name: row.name,
    description: row.description,
    skill_type: row.skill_type,
    unlock_type: row.unlock_type,
    required_level: row.required_level,
    condition_stat_key: row.condition_stat_key,
    condition_threshold: row.condition_threshold,
    effect: parseJson(row.effect_json, {}),
    is_dynamic: !!row.is_dynamic,
    source_pattern: row.source_pattern,
    is_active: !!row.is_active,
    unlocked_at: row.unlocked_at
  };
}

async function ensurePlayerConditionStats(conn, playerId) {
  for (const statKey of BASE_CONDITION_STATS) {
    await conn.query(
      `INSERT INTO player_condition_stats (player_id, stat_key, stat_value, metadata_json)
       VALUES (?, ?, 0, NULL)
       ON DUPLICATE KEY UPDATE stat_key = stat_key`,
      [playerId, statKey]
    );
  }
}

async function incrementConditionStat(conn, playerId, statKey, amount = 1, metadata = null) {
  const metadataJson = metadata ? JSON.stringify(metadata) : null;

  await conn.query(
    `INSERT INTO player_condition_stats (player_id, stat_key, stat_value, metadata_json)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       stat_value = stat_value + VALUES(stat_value),
       metadata_json = COALESCE(VALUES(metadata_json), metadata_json)`,
    [playerId, statKey, amount, metadataJson]
  );

  const [[stat]] = await conn.query(
    `SELECT stat_key, stat_value, metadata_json
     FROM player_condition_stats
     WHERE player_id = ? AND stat_key = ?
     LIMIT 1`,
    [playerId, statKey]
  );

  return stat || null;
}

async function trackActionBehavior(conn, { playerId, actionKey, actionInput, defeatedEnemy, textResolution, textInterpretation }) {
  await ensurePlayerConditionStats(conn, playerId);

  const changedStats = [];

  async function increment(statKey, amount = 1, metadata = null) {
    const stat = await incrementConditionStat(conn, playerId, statKey, amount, metadata);
    if (stat) changedStats.push(stat);
  }

  if (actionKey === "hide") {
    await increment("times_hidden");
  }

  if (actionKey === "rest") {
    await increment("times_rested");
  }

  if (actionKey === "appraise") {
    await increment("times_appraised");
  }

  if (actionKey === "typed" || textInterpretation) {
    await increment("typed_actions_count", 1, {
      last_action: String(actionInput || "").slice(0, 240)
    });
  }

  const textActionSteps = Array.isArray(textInterpretation?.steps)
    ? textInterpretation.steps
    : textInterpretation?.intent
      ? [textInterpretation]
      : [];
  const textActionWasPlayable = textActionSteps.length > 0 && textResolution?.resolution_type !== "invalid_attempt";

  if (textActionWasPlayable && actionKey !== "hide" && textActionSteps.some((step) => step.intent === "hide")) {
    await increment("times_hidden", 1, {
      source: "typed_intent"
    });
  }

  if (textActionWasPlayable && actionKey !== "rest" && textActionSteps.some((step) => step.intent === "rest")) {
    await increment("times_rested", 1, {
      source: "typed_intent"
    });
  }

  if (textActionWasPlayable && actionKey !== "appraise" && textActionSteps.some((step) => step.intent === "plan_next_move")) {
    await increment("times_appraised", 1, {
      source: "typed_intent"
    });
  }

  if (textActionWasPlayable) {
    for (const step of textActionSteps) {
      if (!step.intent || step.intent === "invalid") continue;

      await increment(`intent:${step.intent}`, 1, {
        last_action: String(step.input || actionInput || "").slice(0, 240),
        approach: step.approach || null,
        risk_level: step.risk_level || null,
        resolution_type: textResolution?.resolution_type || null
      });
    }
  }

  if (textActionWasPlayable && textActionSteps.some((step) => step.risk_level === "high")) {
    await increment("risk:high", 1, {
      last_intent: textActionSteps.find((step) => step.risk_level === "high")?.intent || null,
      resolution_type: textResolution?.resolution_type || null
    });
  }

  if (defeatedEnemy) {
    await increment("enemies_killed");

    const enemyName = String(defeatedEnemy.name || "Unknown Enemy").trim() || "Unknown Enemy";
    const enemyNameSlug = slugify(enemyName) || "unknown_enemy";

    await increment(`enemy_killed:${enemyNameSlug}`, 1, {
      enemy_name: enemyName,
      enemy_type: defeatedEnemy.enemy_type || defeatedEnemy.type || null
    });

    const enemyType = String(defeatedEnemy.enemy_type || defeatedEnemy.type || "").trim();
    const enemyTypeSlug = slugify(enemyType);

    if (enemyTypeSlug) {
      await increment(`enemy_type_killed:${enemyTypeSlug}`, 1, {
        enemy_type: enemyType
      });
    }
  }

  return changedStats;
}

async function insertDynamicSkill(conn, skill) {
  const [result] = await conn.query(
    `INSERT INTO skills (
      skill_key,
      name,
      description,
      skill_type,
      unlock_type,
      required_level,
      condition_stat_key,
      condition_threshold,
      effect_json,
      is_dynamic,
      source_pattern
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE skill_key = skill_key`,
    [
      skill.skill_key,
      skill.name,
      skill.description,
      skill.skill_type,
      "condition",
      null,
      skill.condition_stat_key,
      skill.condition_threshold,
      JSON.stringify(skill.effect || {}),
      1,
      skill.source_pattern
    ]
  );

  return result.affectedRows === 1;
}

async function createDynamicSkillsFromPatterns(conn, playerId, changedStats = []) {
  const createdSkills = [];

  for (const stat of changedStats) {
    const statKey = stat.stat_key;
    const statValue = Number(stat.stat_value) || 0;
    const metadata = parseJson(stat.metadata_json, {});

    if (statKey.startsWith("enemy_killed:") && statValue >= DYNAMIC_THRESHOLDS.enemySlayer) {
      const enemySlug = statKey.split(":")[1] || "unknown_enemy";
      const enemyName = metadata.enemy_name || titleCase(enemySlug);

      const skill = {
        skill_key: `dynamic_slayer_${enemySlug}`,
        name: `${enemyName} Slayer`,
        description: `A passive combat instinct formed from repeatedly defeating ${enemyName}.`,
        skill_type: "passive",
        condition_stat_key: statKey,
        condition_threshold: DYNAMIC_THRESHOLDS.enemySlayer,
        effect: {
          damage_focus_against: enemyName,
          focus_bonus: 1
        },
        source_pattern: "repeated_enemy_kills"
      };

      const wasCreated = await insertDynamicSkill(conn, skill);
      if (wasCreated) createdSkills.push(skill.skill_key);
    }

    if (statKey.startsWith("enemy_type_killed:") && statValue >= DYNAMIC_THRESHOLDS.enemyTypeSlayer) {
      const enemyTypeSlug = statKey.split(":")[1] || "unknown_type";
      const enemyType = metadata.enemy_type || titleCase(enemyTypeSlug);

      const skill = {
        skill_key: `dynamic_type_hunter_${enemyTypeSlug}`,
        name: `${titleCase(enemyType)} Hunter`,
        description: `A passive combat pattern formed from repeatedly defeating ${enemyType} enemies.`,
        skill_type: "passive",
        condition_stat_key: statKey,
        condition_threshold: DYNAMIC_THRESHOLDS.enemyTypeSlayer,
        effect: {
          damage_focus_against_type: enemyType,
          focus_bonus: 1
        },
        source_pattern: "repeated_enemy_type_kills"
      };

      const wasCreated = await insertDynamicSkill(conn, skill);
      if (wasCreated) createdSkills.push(skill.skill_key);
    }

    if (statKey === "times_hidden" && statValue >= DYNAMIC_THRESHOLDS.stealth) {
      const skill = {
        skill_key: "dynamic_shadow_instinct",
        name: "Shadow Instinct",
        description: "A passive stealth sense formed by repeatedly hiding under pressure.",
        skill_type: "passive",
        condition_stat_key: "times_hidden",
        condition_threshold: DYNAMIC_THRESHOLDS.stealth,
        effect: {
          stealth_bonus: 1,
          detection_penalty: 1
        },
        source_pattern: "repeated_hiding"
      };

      const wasCreated = await insertDynamicSkill(conn, skill);
      if (wasCreated) createdSkills.push(skill.skill_key);
    }

    if (statKey === "typed_actions_count" && statValue >= DYNAMIC_THRESHOLDS.creativeTyped) {
      const skill = {
        skill_key: "dynamic_adaptive_insight",
        name: "Adaptive Insight",
        description: "An active intelligence skill formed by repeated creative typed actions.",
        skill_type: "active",
        condition_stat_key: "typed_actions_count",
        condition_threshold: DYNAMIC_THRESHOLDS.creativeTyped,
        effect: {
          intelligence_bonus: 1,
          analysis_window_turns: 1
        },
        source_pattern: "creative_typed_actions"
      };

      const wasCreated = await insertDynamicSkill(conn, skill);
      if (wasCreated) createdSkills.push(skill.skill_key);
    }

    if (statKey === "intent:precision_attack" && statValue >= DYNAMIC_THRESHOLDS.precision) {
      const skill = {
        skill_key: "dynamic_weakpoint_reader",
        name: "Weakpoint Reader",
        description: "A passive precision skill formed from repeatedly aiming for vulnerable points.",
        skill_type: "passive",
        condition_stat_key: "intent:precision_attack",
        condition_threshold: DYNAMIC_THRESHOLDS.precision,
        effect: {
          precision_damage_bonus: 1,
          weakpoint_accuracy_bonus: 1
        },
        source_pattern: "repeated_precision_intent"
      };

      const wasCreated = await insertDynamicSkill(conn, skill);
      if (wasCreated) createdSkills.push(skill.skill_key);
    }

    if (statKey === "intent:environment_attack" && statValue >= DYNAMIC_THRESHOLDS.environment) {
      const skill = {
        skill_key: "dynamic_room_weaponizer",
        name: "Room Weaponizer",
        description: "A passive tactical skill formed from repeatedly turning the environment into a weapon.",
        skill_type: "passive",
        condition_stat_key: "intent:environment_attack",
        condition_threshold: DYNAMIC_THRESHOLDS.environment,
        effect: {
          environmental_damage_bonus: 1,
          environmental_risk_reduction: 1
        },
        source_pattern: "repeated_environment_intent"
      };

      const wasCreated = await insertDynamicSkill(conn, skill);
      if (wasCreated) createdSkills.push(skill.skill_key);
    }

    if (statKey === "intent:devour_remains" && statValue >= DYNAMIC_THRESHOLDS.devour) {
      const skill = {
        skill_key: "dynamic_predator_metabolism",
        name: "Predator Metabolism",
        description: "A passive devour skill formed from repeatedly consuming defeated enemies.",
        skill_type: "passive",
        condition_stat_key: "intent:devour_remains",
        condition_threshold: DYNAMIC_THRESHOLDS.devour,
        effect: {
          devour_healing_bonus: 1
        },
        source_pattern: "repeated_devour_intent"
      };

      const wasCreated = await insertDynamicSkill(conn, skill);
      if (wasCreated) createdSkills.push(skill.skill_key);
    }

    if (statKey === "intent:social" && statValue >= DYNAMIC_THRESHOLDS.social) {
      const skill = {
        skill_key: "dynamic_creature_reader",
        name: "Creature Reader",
        description: "An active social skill formed from repeated attempts to communicate with dungeon creatures.",
        skill_type: "active",
        condition_stat_key: "intent:social",
        condition_threshold: DYNAMIC_THRESHOLDS.social,
        effect: {
          social_opening_bonus: 1,
          duration_turns: 1
        },
        source_pattern: "repeated_social_intent"
      };

      const wasCreated = await insertDynamicSkill(conn, skill);
      if (wasCreated) createdSkills.push(skill.skill_key);
    }

    if (statKey === "risk:high" && statValue >= DYNAMIC_THRESHOLDS.reckless) {
      const skill = {
        skill_key: "dynamic_berserker_commitment",
        name: "Berserker Commitment",
        description: "A passive combat skill formed from repeatedly choosing dangerous high-risk actions.",
        skill_type: "passive",
        condition_stat_key: "risk:high",
        condition_threshold: DYNAMIC_THRESHOLDS.reckless,
        effect: {
          high_risk_damage_bonus: 1,
          high_risk_backfire_penalty: 1
        },
        source_pattern: "repeated_high_risk_intent"
      };

      const wasCreated = await insertDynamicSkill(conn, skill);
      if (wasCreated) createdSkills.push(skill.skill_key);
    }
  }

  return createdSkills;
}

async function unlockMatchingSkills(conn, playerId, playerLevel) {
  const [skills] = await conn.query(
    `SELECT DISTINCT s.*
     FROM skills s
     LEFT JOIN player_condition_stats pcs
       ON pcs.player_id = ?
      AND pcs.stat_key = s.condition_stat_key
     WHERE NOT EXISTS (
       SELECT 1
       FROM player_skills ps
       WHERE ps.player_id = ?
         AND ps.skill_id = s.id
     )
     AND (
       (s.unlock_type = 'level' AND s.required_level IS NOT NULL AND s.required_level <= ?)
       OR
       (
         s.unlock_type = 'condition'
         AND s.condition_stat_key IS NOT NULL
         AND s.condition_threshold IS NOT NULL
         AND pcs.stat_value >= s.condition_threshold
       )
     )`,
    [playerId, playerId, playerLevel]
  );

  for (const skill of skills) {
    await conn.query(
      `INSERT INTO player_skills (player_id, skill_id, is_active)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE skill_id = skill_id`,
      [playerId, skill.id, skill.skill_type === "active" ? 1 : 0]
    );
  }

  return skills.map((skill) => serializeSkill({
    ...skill,
    is_active: skill.skill_type === "active" ? 1 : 0,
    unlocked_at: null
  }));
}

async function evaluateSkillProgression(conn, { playerId, playerLevel, changedStats = [] }) {
  await ensurePlayerConditionStats(conn, playerId);
  const dynamicSkillKeys = await createDynamicSkillsFromPatterns(conn, playerId, changedStats);
  const unlocked = await unlockMatchingSkills(conn, playerId, playerLevel);

  return {
    dynamic_skill_keys: dynamicSkillKeys,
    unlocked
  };
}

async function getPlayerSkills(connOrPool, playerId) {
  const [skills] = await connOrPool.query(
    `SELECT
      s.*,
      ps.is_active,
      ps.unlocked_at
     FROM player_skills ps
     INNER JOIN skills s ON ps.skill_id = s.id
     WHERE ps.player_id = ?
     ORDER BY ps.unlocked_at DESC, s.name ASC`,
    [playerId]
  );

  return skills.map(serializeSkill);
}

async function getPlayerSkillContext(connOrPool, playerId) {
  const skills = await getPlayerSkills(connOrPool, playerId);

  return {
    active: skills.filter((skill) => skill.skill_type === "active"),
    passive: skills.filter((skill) => skill.skill_type === "passive")
  };
}

async function getPlayerConditionStats(connOrPool, playerId) {
  const [stats] = await connOrPool.query(
    `SELECT stat_key, stat_value, metadata_json, updated_at
     FROM player_condition_stats
     WHERE player_id = ?
     ORDER BY stat_key ASC`,
    [playerId]
  );

  return stats.map((stat) => ({
    stat_key: stat.stat_key,
    stat_value: stat.stat_value,
    metadata: parseJson(stat.metadata_json, null),
    updated_at: stat.updated_at
  }));
}

module.exports = {
  ensurePlayerConditionStats,
  trackActionBehavior,
  evaluateSkillProgression,
  getPlayerSkills,
  getPlayerSkillContext,
  getPlayerConditionStats
};
