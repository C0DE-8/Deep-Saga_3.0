const router = require("express").Router();
const pool = require("../config/db");
const { model } = require("../config/gemini");
const { buildPrompt, buildActionInterpretationPrompt } = require("../config/prompts");
const authenticateToken = require("../middleware/authMiddleware");
const { getActionTimeCost, applyTime, getTimeOfDay } = require("../services/timeEngine");
const {
  trackActionBehavior,
  evaluateSkillProgression,
  getPlayerSkillContext
} = require("../services/skillEngine");

// Loads the player's current persisted dungeon scene.
router.get("/current", authenticateToken, async function getCurrentState(req, res) {
  function parseJson(value, fallback = null) {
    if (!value) return fallback;
    if (typeof value === "object") return value;

    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function parseAiJson(raw) {
    const text = String(raw || "").trim();
    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    return JSON.parse(cleaned);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getPlayerSnapshot(player) {
    return {
      id: player.id,
      name: player.name,
      persona: player.persona,
      current_dungeon_level: player.current_dungeon_level,
      current_floor: player.current_floor,
      current_area: player.current_area,
      level: player.level,
      exp: player.exp,
      stat_points: player.stat_points,
      hp: player.hp,
      max_hp: player.max_hp,
      strength_stat: player.strength_stat,
      dexterity_stat: player.dexterity_stat,
      stamina_stat: player.stamina_stat,
      intelligence_stat: player.intelligence_stat,
      charisma_stat: player.charisma_stat,
      wisdom_stat: player.wisdom_stat,
      is_alive: player.is_alive,
      time_of_day: getTimeOfDay(player.current_hour)
    };
  }

  function getEnemySnapshot(enemy, count, hp) {
    if (!enemy) return null;

    return {
      id: enemy.id,
      name: enemy.name,
      enemy_type: enemy.enemy_type,
      species: enemy.species,
      rank_tier: enemy.rank_tier,
      faction_key: enemy.faction_key,
      elemental_affinity: enemy.elemental_affinity,
      description: enemy.description,
      abilities: parseJson(enemy.abilities_json, []),
      behavior: parseJson(enemy.behavior_json, {}),
      mutations: parseJson(enemy.mutation_json, {}),
      ai_style_prompt: enemy.ai_style_prompt,
      encounter_role: enemy.encounter_role,
      formation: parseJson(enemy.formation_json, {}),
      spawn_rules: parseJson(enemy.spawn_rules_json, {}),
      count,
      hp,
      max_hp: enemy.scaled_hp,
      attack: enemy.scaled_attack,
      defense: enemy.scaled_defense,
      xp_reward: enemy.scaled_xp,
      is_boss: enemy.is_boss ? 1 : 0
    };
  }

  function getLocationPayload(floor) {
    return {
      level: floor.level_number,
      floor: floor.floor_number,
      name: floor.name,
      level_name: floor.level_name,
      biome: floor.biome,
      description: floor.description,
      is_boss_floor: floor.is_boss_floor ? 1 : 0,
      difficulty_rating: floor.difficulty_rating,
      gateway_name: floor.gateway_name
    };
  }

  async function loadPlayer(conn, userId) {
    const [[player]] = await conn.query(
      `SELECT
        id,
        user_id,
        persona,
        name,
        current_race,
        current_title,
        COALESCE(current_dungeon_level, 1) AS current_dungeon_level,
        level,
        exp,
        stat_points,
        hp,
        max_hp,
        strength_stat,
        dexterity_stat,
        stamina_stat,
        intelligence_stat,
        charisma_stat,
        wisdom_stat,
        current_floor,
        current_area,
        life_number,
        is_alive,
        year_survived,
        day_survived,
        current_hour
       FROM players
       WHERE user_id = ?
       LIMIT 1`,
      [userId]
    );

    return player || null;
  }

  async function loadFloor(conn, player) {
    const [[floor]] = await conn.query(
      `SELECT
        df.id,
        df.floor_number,
        df.name,
        df.description,
        df.is_boss_floor,
        df.difficulty_rating,
        dl.level_number,
        dl.name AS level_name,
        dl.biome,
        dl.gateway_name
       FROM dungeon_floors df
       INNER JOIN dungeon_levels dl ON df.level_id = dl.id
       WHERE dl.level_number = ?
         AND df.floor_number = ?
       LIMIT 1`,
      [player.current_dungeon_level || 1, player.current_floor || 1]
    );

    return floor || null;
  }

  async function loadSpawnEnemy(conn, floor) {
    const [[enemy]] = await conn.query(
      `SELECT
        et.*,
        fes.min_group_size,
        fes.max_group_size,
        fes.encounter_role,
        fes.formation_json,
        fes.spawn_rules_json,
        GREATEST(et.base_hp + (? * 3), 1) AS scaled_hp,
        GREATEST(et.base_attack + FLOOR(? / 5), 1) AS scaled_attack,
        GREATEST(et.base_defense + FLOOR(? / 12), 0) AS scaled_defense,
        GREATEST(et.xp_reward + FLOOR(? / 2), 1) AS scaled_xp
       FROM floor_enemy_spawns fes
       INNER JOIN enemy_types et ON fes.enemy_type_id = et.id
       WHERE fes.dungeon_floor_id = ?
       ORDER BY fes.is_boss_spawn DESC, (-LOG(GREATEST(RAND(), 0.000001)) / GREATEST(fes.spawn_weight, 1)) ASC
       LIMIT 1`,
      [
        floor.difficulty_rating,
        floor.difficulty_rating,
        floor.difficulty_rating,
        floor.difficulty_rating,
        floor.id
      ]
    );

    return enemy || null;
  }

  async function loadOrCreateFloorState(conn, player, floor, spawnEnemy) {
    async function loadEncounterMembers(encounterId) {
      if (!encounterId) return [];

      const [members] = await conn.query(
        `SELECT *
         FROM player_encounter_enemies
         WHERE encounter_id = ?
         ORDER BY is_defeated ASC, position_index ASC, id ASC`,
        [encounterId]
      );

      return members.map((member) => ({
        id: member.id,
        enemy_type_id: member.enemy_type_id,
        enemy_key: member.enemy_key,
        display_name: member.display_name,
        role_key: member.role_key,
        rank_tier: member.rank_tier,
        faction_key: member.faction_key,
        position_index: member.position_index,
        hp: member.current_hp,
        max_hp: member.max_hp,
        attack: member.attack_value,
        defense: member.defense_value,
        phase: member.phase,
        statuses: parseJson(member.status_json, []),
        resistances: parseJson(member.resistance_json, {}),
        weaknesses: parseJson(member.weakness_json, {}),
        abilities: parseJson(member.ability_state_json, []),
        mutations: parseJson(member.mutation_state_json, {}),
        behavior: parseJson(member.ai_behavior_json, {}),
        is_summoned: member.is_summoned ? 1 : 0,
        is_defeated: member.is_defeated ? 1 : 0
      }));
    }

    const [[existing]] = await conn.query(
      `SELECT *
       FROM player_floor_states
       WHERE player_id = ? AND dungeon_floor_id = ?
       LIMIT 1`,
      [player.id, floor.id]
    );

    if (existing?.active_encounter_id) {
      return {
        ...existing,
        biome_hazard: parseJson(existing.biome_hazard_json, null),
        encounter_members: await loadEncounterMembers(existing.active_encounter_id)
      };
    }

    const enemyCount = spawnEnemy
      ? clamp(spawnEnemy.min_group_size || 1, 1, spawnEnemy.max_group_size || 1)
      : 0;
    const enemyHp = spawnEnemy ? spawnEnemy.scaled_hp * enemyCount : 0;
    let activeEncounterId = null;
    let biomeHazard = null;

    if (spawnEnemy) {
      const [[hazard]] = await conn.query(
        `SELECT *
         FROM dungeon_biome_hazards
         WHERE biome = ?
           AND ? BETWEEN min_dungeon_level AND max_dungeon_level
         ORDER BY (-LOG(GREATEST(RAND(), 0.000001)) / GREATEST(spawn_weight, 1)) ASC
         LIMIT 1`,
        [floor.biome, floor.level_number]
      );
      biomeHazard = hazard
        ? {
            hazard_key: hazard.hazard_key,
            name: hazard.name,
            description: hazard.description,
            effect: parseJson(hazard.effect_json, {})
          }
        : null;

      const [encounterResult] = await conn.query(
        `INSERT INTO player_encounters (
          player_id,
          dungeon_floor_id,
          encounter_type,
          faction_key,
          formation_key,
          formation_json,
          synergy_json,
          biome_hazard_json,
          environment_effect_json,
          ai_directive_json,
          phase,
          difficulty_rating,
          is_hidden,
          is_roaming
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          player.id,
          floor.id,
          spawnEnemy.encounter_role || "ambient",
          spawnEnemy.faction_key || null,
          parseJson(spawnEnemy.formation_json, {})?.group_logic || null,
          spawnEnemy.formation_json || null,
          JSON.stringify({
            faction_key: spawnEnemy.faction_key || null,
            role: spawnEnemy.encounter_role || "ambient",
            group_size: enemyCount
          }),
          biomeHazard ? JSON.stringify(biomeHazard) : null,
          biomeHazard ? JSON.stringify(biomeHazard.effect || {}) : null,
          JSON.stringify({
            enemy_style: spawnEnemy.ai_style_prompt || null,
            behavior: parseJson(spawnEnemy.behavior_json, {}),
            abilities: parseJson(spawnEnemy.abilities_json, [])
          }),
          1,
          floor.difficulty_rating,
          spawnEnemy.is_hidden ? 1 : 0,
          spawnEnemy.is_roaming ? 1 : 0
        ]
      );
      activeEncounterId = encounterResult.insertId;

      for (let i = 1; i <= enemyCount; i += 1) {
        await conn.query(
          `INSERT INTO player_encounter_enemies (
            encounter_id,
            enemy_type_id,
            enemy_key,
            display_name,
            role_key,
            rank_tier,
            faction_key,
            position_index,
            current_hp,
            max_hp,
            attack_value,
            defense_value,
            phase,
            status_json,
            resistance_json,
            weakness_json,
            ability_state_json,
            mutation_state_json,
            ai_behavior_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            activeEncounterId,
            spawnEnemy.id,
            spawnEnemy.enemy_key,
            enemyCount > 1 ? `${spawnEnemy.name} ${i}` : spawnEnemy.name,
            i === 1 ? "leader" : "fighter",
            spawnEnemy.rank_tier || "common",
            spawnEnemy.faction_key || null,
            i,
            spawnEnemy.scaled_hp,
            spawnEnemy.scaled_hp,
            spawnEnemy.scaled_attack,
            spawnEnemy.scaled_defense,
            1,
            JSON.stringify([]),
            JSON.stringify({ element: spawnEnemy.elemental_affinity || null }),
            JSON.stringify({ inferred_from_biome: floor.biome }),
            spawnEnemy.abilities_json || JSON.stringify([]),
            spawnEnemy.mutation_json || JSON.stringify({}),
            spawnEnemy.behavior_json || JSON.stringify({})
          ]
        );
      }
    }

    await conn.query(
      `INSERT INTO player_floor_states (
        player_id,
        dungeon_floor_id,
        active_enemy_type_id,
        active_encounter_id,
        enemy_count,
        enemy_hp,
        is_boss,
        biome_hazard_json,
        encounter_seed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        player.id,
        floor.id,
        spawnEnemy?.id || null,
        activeEncounterId,
        enemyCount,
        enemyHp,
        spawnEnemy?.is_boss ? 1 : 0,
        biomeHazard ? JSON.stringify(biomeHazard) : null,
        `${player.id}:${floor.id}:${Date.now()}`
      ]
    );

    return {
      player_id: player.id,
      dungeon_floor_id: floor.id,
      active_enemy_type_id: spawnEnemy?.id || null,
      active_encounter_id: activeEncounterId,
      enemy_count: enemyCount,
      enemy_hp: enemyHp,
      is_boss: spawnEnemy?.is_boss ? 1 : 0,
      biome_hazard_json: biomeHazard ? JSON.stringify(biomeHazard) : null,
      biome_hazard: biomeHazard,
      encounter_members: await loadEncounterMembers(activeEncounterId),
      last_event_json: null
    };
  }

  async function loadMemories(conn, playerId) {
    const [memories] = await conn.query(
      `SELECT memory_type, summary, importance, metadata_json, created_at
       FROM player_memories
       WHERE player_id = ?
       ORDER BY importance DESC, created_at DESC
       LIMIT 8`,
      [playerId]
    );

    return memories.map((memory) => ({
      ...memory,
      metadata: parseJson(memory.metadata_json, null)
    }));
  }

  async function loadInventory(conn, playerId) {
    const [items] = await conn.query(
      `SELECT item_key, name, item_type, quantity, metadata_json
       FROM player_inventory
       WHERE player_id = ?
       ORDER BY item_type ASC, name ASC`,
      [playerId]
    );

    return items.map((item) => ({
      ...item,
      metadata: parseJson(item.metadata_json, null)
    }));
  }

  async function narrateScene(context) {
    try {
      if (!process.env.GEMINI_API_KEY) {
        return {
          narration: "",
          choices: []
        };
      }

      const prompt = buildPrompt({
        persona: context.player.persona,
        context
      });
      const result = await model.generateContent(prompt);
      const parsed = parseAiJson(result.response.text());

      return {
        narration: String(parsed.narration || ""),
        choices: Array.isArray(parsed.choices) && parsed.choices.length
          ? parsed.choices.slice(0, 5).map(String)
          : []
      };
    } catch (error) {
      console.error("play narration error:", error.message);
      return {
        narration: "",
        choices: []
      };
    }
  }

  async function buildResponse(conn, player, floor, enemy, state, eventFeedback = null) {
    const enemyPayload = state?.enemy_hp > 0
      ? getEnemySnapshot(enemy, state.enemy_count, state.enemy_hp)
      : null;
    if (enemyPayload) {
      enemyPayload.active_encounter_id = state.active_encounter_id || null;
      enemyPayload.members = state.encounter_members || [];
      enemyPayload.biome_hazard = state.biome_hazard || parseJson(state.biome_hazard_json, null);
    }
    const location = getLocationPayload(floor);
    const inventory = await loadInventory(conn, player.id);
    const memories = await loadMemories(conn, player.id);
    const skills = await getPlayerSkillContext(conn, player.id);
    const context = {
      player: getPlayerSnapshot(player),
      location,
      enemy: enemyPayload,
      inventory,
      memories,
      skills,
      event_feedback: eventFeedback
    };
    const ai = await narrateScene(context);

    return {
      message: eventFeedback?.message || "play_state_ready",
      scene: {
        title: location.name,
        text: ai.narration,
        type: "dungeon",
        choices: ai.choices,
        can_type: true
      },
      world: {
        level: location.level,
        floor: location.floor,
        area: location.name,
        biome: location.biome,
        time_of_day: getTimeOfDay(player.current_hour)
      },
      player: getPlayerSnapshot(player),
      enemy: enemyPayload,
      event_feedback: eventFeedback
    };
  }

  const userId = req.user.userId;
  let conn;

  try {
    conn = await pool.getConnection();
    const player = await loadPlayer(conn, userId);

    if (!player) return res.status(404).json({ message: "Player not found" });

    const floor = await loadFloor(conn, player);
    if (!floor) return res.status(404).json({ message: "Dungeon floor not found. Run migration 002." });

    const enemy = await loadSpawnEnemy(conn, floor);
    const state = await loadOrCreateFloorState(conn, player, floor, enemy);

    return res.json(await buildResponse(conn, player, floor, enemy, state));
  } catch (error) {
    console.error("play current error:", error);
    return res.status(500).json({ message: "Failed to load play state" });
  } finally {
    if (conn) conn.release();
  }
});

// Creates or resumes the player's dungeon scene.
router.post("/start", authenticateToken, async function startGame(req, res) {
  function parseJson(value, fallback = null) {
    if (!value) return fallback;
    if (typeof value === "object") return value;

    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function parseAiJson(raw) {
    const text = String(raw || "").trim();
    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    return JSON.parse(cleaned);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getPlayerSnapshot(player) {
    return {
      id: player.id,
      name: player.name,
      persona: player.persona,
      current_dungeon_level: player.current_dungeon_level,
      current_floor: player.current_floor,
      current_area: player.current_area,
      level: player.level,
      exp: player.exp,
      stat_points: player.stat_points,
      hp: player.hp,
      max_hp: player.max_hp,
      strength_stat: player.strength_stat,
      dexterity_stat: player.dexterity_stat,
      stamina_stat: player.stamina_stat,
      intelligence_stat: player.intelligence_stat,
      charisma_stat: player.charisma_stat,
      wisdom_stat: player.wisdom_stat,
      is_alive: player.is_alive,
      time_of_day: getTimeOfDay(player.current_hour)
    };
  }

  function getEnemySnapshot(enemy, count, hp) {
    if (!enemy) return null;

    return {
      id: enemy.id,
      name: enemy.name,
      enemy_type: enemy.enemy_type,
      species: enemy.species,
      rank_tier: enemy.rank_tier,
      faction_key: enemy.faction_key,
      elemental_affinity: enemy.elemental_affinity,
      description: enemy.description,
      abilities: parseJson(enemy.abilities_json, []),
      behavior: parseJson(enemy.behavior_json, {}),
      mutations: parseJson(enemy.mutation_json, {}),
      ai_style_prompt: enemy.ai_style_prompt,
      encounter_role: enemy.encounter_role,
      formation: parseJson(enemy.formation_json, {}),
      spawn_rules: parseJson(enemy.spawn_rules_json, {}),
      count,
      hp,
      max_hp: enemy.scaled_hp,
      attack: enemy.scaled_attack,
      defense: enemy.scaled_defense,
      xp_reward: enemy.scaled_xp,
      is_boss: enemy.is_boss ? 1 : 0
    };
  }

  function getLocationPayload(floor) {
    return {
      level: floor.level_number,
      floor: floor.floor_number,
      name: floor.name,
      level_name: floor.level_name,
      biome: floor.biome,
      description: floor.description,
      is_boss_floor: floor.is_boss_floor ? 1 : 0,
      difficulty_rating: floor.difficulty_rating,
      gateway_name: floor.gateway_name
    };
  }

  async function loadPlayer(conn, userId) {
    const [[player]] = await conn.query(
      `SELECT
        id,
        user_id,
        persona,
        name,
        current_race,
        current_title,
        COALESCE(current_dungeon_level, 1) AS current_dungeon_level,
        level,
        exp,
        stat_points,
        hp,
        max_hp,
        strength_stat,
        dexterity_stat,
        stamina_stat,
        intelligence_stat,
        charisma_stat,
        wisdom_stat,
        current_floor,
        current_area,
        life_number,
        is_alive,
        year_survived,
        day_survived,
        current_hour
       FROM players
       WHERE user_id = ?
       LIMIT 1`,
      [userId]
    );

    return player || null;
  }

  async function loadFloor(conn, player) {
    const [[floor]] = await conn.query(
      `SELECT
        df.id,
        df.floor_number,
        df.name,
        df.description,
        df.is_boss_floor,
        df.difficulty_rating,
        dl.level_number,
        dl.name AS level_name,
        dl.biome,
        dl.gateway_name
       FROM dungeon_floors df
       INNER JOIN dungeon_levels dl ON df.level_id = dl.id
       WHERE dl.level_number = ?
         AND df.floor_number = ?
       LIMIT 1`,
      [player.current_dungeon_level || 1, player.current_floor || 1]
    );

    return floor || null;
  }

  async function loadSpawnEnemy(conn, floor) {
    const [[enemy]] = await conn.query(
      `SELECT
        et.*,
        fes.min_group_size,
        fes.max_group_size,
        fes.encounter_role,
        fes.formation_json,
        fes.spawn_rules_json,
        GREATEST(et.base_hp + (? * 3), 1) AS scaled_hp,
        GREATEST(et.base_attack + FLOOR(? / 5), 1) AS scaled_attack,
        GREATEST(et.base_defense + FLOOR(? / 12), 0) AS scaled_defense,
        GREATEST(et.xp_reward + FLOOR(? / 2), 1) AS scaled_xp
       FROM floor_enemy_spawns fes
       INNER JOIN enemy_types et ON fes.enemy_type_id = et.id
       WHERE fes.dungeon_floor_id = ?
       ORDER BY fes.is_boss_spawn DESC, (-LOG(GREATEST(RAND(), 0.000001)) / GREATEST(fes.spawn_weight, 1)) ASC
       LIMIT 1`,
      [
        floor.difficulty_rating,
        floor.difficulty_rating,
        floor.difficulty_rating,
        floor.difficulty_rating,
        floor.id
      ]
    );

    return enemy || null;
  }

  async function loadOrCreateFloorState(conn, player, floor, spawnEnemy) {
    async function loadEncounterMembers(encounterId) {
      if (!encounterId) return [];

      const [members] = await conn.query(
        `SELECT *
         FROM player_encounter_enemies
         WHERE encounter_id = ?
         ORDER BY is_defeated ASC, position_index ASC, id ASC`,
        [encounterId]
      );

      return members.map((member) => ({
        id: member.id,
        enemy_type_id: member.enemy_type_id,
        enemy_key: member.enemy_key,
        display_name: member.display_name,
        role_key: member.role_key,
        rank_tier: member.rank_tier,
        faction_key: member.faction_key,
        position_index: member.position_index,
        hp: member.current_hp,
        max_hp: member.max_hp,
        attack: member.attack_value,
        defense: member.defense_value,
        phase: member.phase,
        statuses: parseJson(member.status_json, []),
        resistances: parseJson(member.resistance_json, {}),
        weaknesses: parseJson(member.weakness_json, {}),
        abilities: parseJson(member.ability_state_json, []),
        mutations: parseJson(member.mutation_state_json, {}),
        behavior: parseJson(member.ai_behavior_json, {}),
        is_summoned: member.is_summoned ? 1 : 0,
        is_defeated: member.is_defeated ? 1 : 0
      }));
    }

    const [[existing]] = await conn.query(
      `SELECT *
       FROM player_floor_states
       WHERE player_id = ? AND dungeon_floor_id = ?
       LIMIT 1`,
      [player.id, floor.id]
    );

    if (existing?.active_encounter_id) {
      return {
        ...existing,
        biome_hazard: parseJson(existing.biome_hazard_json, null),
        encounter_members: await loadEncounterMembers(existing.active_encounter_id)
      };
    }

    const enemyCount = spawnEnemy
      ? clamp(spawnEnemy.min_group_size || 1, 1, spawnEnemy.max_group_size || 1)
      : 0;
    const enemyHp = spawnEnemy ? spawnEnemy.scaled_hp * enemyCount : 0;
    let activeEncounterId = null;
    let biomeHazard = null;

    if (spawnEnemy) {
      const [[hazard]] = await conn.query(
        `SELECT *
         FROM dungeon_biome_hazards
         WHERE biome = ?
           AND ? BETWEEN min_dungeon_level AND max_dungeon_level
         ORDER BY (-LOG(GREATEST(RAND(), 0.000001)) / GREATEST(spawn_weight, 1)) ASC
         LIMIT 1`,
        [floor.biome, floor.level_number]
      );
      biomeHazard = hazard
        ? {
            hazard_key: hazard.hazard_key,
            name: hazard.name,
            description: hazard.description,
            effect: parseJson(hazard.effect_json, {})
          }
        : null;

      const [encounterResult] = await conn.query(
        `INSERT INTO player_encounters (
          player_id,
          dungeon_floor_id,
          encounter_type,
          faction_key,
          formation_key,
          formation_json,
          synergy_json,
          biome_hazard_json,
          environment_effect_json,
          ai_directive_json,
          phase,
          difficulty_rating,
          is_hidden,
          is_roaming
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          player.id,
          floor.id,
          spawnEnemy.encounter_role || "ambient",
          spawnEnemy.faction_key || null,
          parseJson(spawnEnemy.formation_json, {})?.group_logic || null,
          spawnEnemy.formation_json || null,
          JSON.stringify({
            faction_key: spawnEnemy.faction_key || null,
            role: spawnEnemy.encounter_role || "ambient",
            group_size: enemyCount
          }),
          biomeHazard ? JSON.stringify(biomeHazard) : null,
          biomeHazard ? JSON.stringify(biomeHazard.effect || {}) : null,
          JSON.stringify({
            enemy_style: spawnEnemy.ai_style_prompt || null,
            behavior: parseJson(spawnEnemy.behavior_json, {}),
            abilities: parseJson(spawnEnemy.abilities_json, [])
          }),
          1,
          floor.difficulty_rating,
          spawnEnemy.is_hidden ? 1 : 0,
          spawnEnemy.is_roaming ? 1 : 0
        ]
      );
      activeEncounterId = encounterResult.insertId;

      for (let i = 1; i <= enemyCount; i += 1) {
        await conn.query(
          `INSERT INTO player_encounter_enemies (
            encounter_id,
            enemy_type_id,
            enemy_key,
            display_name,
            role_key,
            rank_tier,
            faction_key,
            position_index,
            current_hp,
            max_hp,
            attack_value,
            defense_value,
            phase,
            status_json,
            resistance_json,
            weakness_json,
            ability_state_json,
            mutation_state_json,
            ai_behavior_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            activeEncounterId,
            spawnEnemy.id,
            spawnEnemy.enemy_key,
            enemyCount > 1 ? `${spawnEnemy.name} ${i}` : spawnEnemy.name,
            i === 1 ? "leader" : "fighter",
            spawnEnemy.rank_tier || "common",
            spawnEnemy.faction_key || null,
            i,
            spawnEnemy.scaled_hp,
            spawnEnemy.scaled_hp,
            spawnEnemy.scaled_attack,
            spawnEnemy.scaled_defense,
            1,
            JSON.stringify([]),
            JSON.stringify({ element: spawnEnemy.elemental_affinity || null }),
            JSON.stringify({ inferred_from_biome: floor.biome }),
            spawnEnemy.abilities_json || JSON.stringify([]),
            spawnEnemy.mutation_json || JSON.stringify({}),
            spawnEnemy.behavior_json || JSON.stringify({})
          ]
        );
      }
    }

    await conn.query(
      `INSERT INTO player_floor_states (
        player_id,
        dungeon_floor_id,
        active_enemy_type_id,
        active_encounter_id,
        enemy_count,
        enemy_hp,
        is_boss,
        biome_hazard_json,
        encounter_seed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        player.id,
        floor.id,
        spawnEnemy?.id || null,
        activeEncounterId,
        enemyCount,
        enemyHp,
        spawnEnemy?.is_boss ? 1 : 0,
        biomeHazard ? JSON.stringify(biomeHazard) : null,
        `${player.id}:${floor.id}:${Date.now()}`
      ]
    );

    return {
      player_id: player.id,
      dungeon_floor_id: floor.id,
      active_enemy_type_id: spawnEnemy?.id || null,
      active_encounter_id: activeEncounterId,
      enemy_count: enemyCount,
      enemy_hp: enemyHp,
      is_boss: spawnEnemy?.is_boss ? 1 : 0,
      biome_hazard_json: biomeHazard ? JSON.stringify(biomeHazard) : null,
      biome_hazard: biomeHazard,
      encounter_members: await loadEncounterMembers(activeEncounterId),
      last_event_json: null
    };
  }

  async function loadMemories(conn, playerId) {
    const [memories] = await conn.query(
      `SELECT memory_type, summary, importance, metadata_json, created_at
       FROM player_memories
       WHERE player_id = ?
       ORDER BY importance DESC, created_at DESC
       LIMIT 8`,
      [playerId]
    );

    return memories.map((memory) => ({
      ...memory,
      metadata: parseJson(memory.metadata_json, null)
    }));
  }

  async function loadInventory(conn, playerId) {
    const [items] = await conn.query(
      `SELECT item_key, name, item_type, quantity, metadata_json
       FROM player_inventory
       WHERE player_id = ?
       ORDER BY item_type ASC, name ASC`,
      [playerId]
    );

    return items.map((item) => ({
      ...item,
      metadata: parseJson(item.metadata_json, null)
    }));
  }

  async function narrateScene(context) {
    try {
      if (!process.env.GEMINI_API_KEY) {
        return {
          narration: "",
          choices: []
        };
      }

      const prompt = buildPrompt({
        persona: context.player.persona,
        context
      });
      const result = await model.generateContent(prompt);
      const parsed = parseAiJson(result.response.text());

      return {
        narration: String(parsed.narration || ""),
        choices: Array.isArray(parsed.choices) && parsed.choices.length
          ? parsed.choices.slice(0, 5).map(String)
          : []
      };
    } catch (error) {
      console.error("play narration error:", error.message);
      return {
        narration: "",
        choices: []
      };
    }
  }

  async function buildResponse(conn, player, floor, enemy, state, eventFeedback = null) {
    const enemyPayload = state?.enemy_hp > 0
      ? getEnemySnapshot(enemy, state.enemy_count, state.enemy_hp)
      : null;
    if (enemyPayload) {
      enemyPayload.active_encounter_id = state.active_encounter_id || null;
      enemyPayload.members = state.encounter_members || [];
      enemyPayload.biome_hazard = state.biome_hazard || parseJson(state.biome_hazard_json, null);
    }
    const location = getLocationPayload(floor);
    const inventory = await loadInventory(conn, player.id);
    const memories = await loadMemories(conn, player.id);
    const skills = await getPlayerSkillContext(conn, player.id);
    const context = {
      player: getPlayerSnapshot(player),
      location,
      enemy: enemyPayload,
      inventory,
      memories,
      skills,
      event_feedback: eventFeedback
    };
    const ai = await narrateScene(context);

    return {
      message: eventFeedback?.message || "play_state_ready",
      scene: {
        title: location.name,
        text: ai.narration,
        type: "dungeon",
        choices: ai.choices,
        can_type: true
      },
      world: {
        level: location.level,
        floor: location.floor,
        area: location.name,
        biome: location.biome,
        time_of_day: getTimeOfDay(player.current_hour)
      },
      player: getPlayerSnapshot(player),
      enemy: enemyPayload,
      event_feedback: eventFeedback
    };
  }

  const userId = req.user.userId;
  let conn;

  try {
    conn = await pool.getConnection();
    const player = await loadPlayer(conn, userId);

    if (!player) return res.status(404).json({ message: "Player not found" });

    const floor = await loadFloor(conn, player);
    if (!floor) return res.status(404).json({ message: "Dungeon floor not found. Run migration 002." });

    const enemy = await loadSpawnEnemy(conn, floor);
    const state = await loadOrCreateFloorState(conn, player, floor, enemy);

    return res.json(await buildResponse(conn, player, floor, enemy, state));
  } catch (error) {
    console.error("play start error:", error);
    return res.status(500).json({ message: "Failed to start play state" });
  } finally {
    if (conn) conn.release();
  }
});

// Interprets player text, resolves backend rules, and persists the action result.
router.post("/action", authenticateToken, async function resolveAction(req, res) {
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function parseJson(value, fallback = null) {
    if (!value) return fallback;
    if (typeof value === "object") return value;

    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function parseAiJson(raw) {
    const text = String(raw || "").trim();
    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    return JSON.parse(cleaned);
  }

  function getPlayerSnapshot(player) {
    return {
      id: player.id,
      name: player.name,
      persona: player.persona,
      current_dungeon_level: player.current_dungeon_level,
      current_floor: player.current_floor,
      current_area: player.current_area,
      level: player.level,
      exp: player.exp,
      stat_points: player.stat_points,
      hp: player.hp,
      max_hp: player.max_hp,
      strength_stat: player.strength_stat,
      dexterity_stat: player.dexterity_stat,
      stamina_stat: player.stamina_stat,
      intelligence_stat: player.intelligence_stat,
      charisma_stat: player.charisma_stat,
      wisdom_stat: player.wisdom_stat,
      is_alive: player.is_alive,
      time_of_day: getTimeOfDay(player.current_hour)
    };
  }

  function getEnemySnapshot(enemy, count, hp) {
    if (!enemy) return null;

    return {
      id: enemy.id,
      name: enemy.name,
      enemy_type: enemy.enemy_type,
      species: enemy.species,
      rank_tier: enemy.rank_tier,
      faction_key: enemy.faction_key,
      elemental_affinity: enemy.elemental_affinity,
      description: enemy.description,
      abilities: parseJson(enemy.abilities_json, []),
      behavior: parseJson(enemy.behavior_json, {}),
      mutations: parseJson(enemy.mutation_json, {}),
      ai_style_prompt: enemy.ai_style_prompt,
      encounter_role: enemy.encounter_role,
      formation: parseJson(enemy.formation_json, {}),
      spawn_rules: parseJson(enemy.spawn_rules_json, {}),
      count,
      hp,
      max_hp: enemy.scaled_hp,
      attack: enemy.scaled_attack,
      defense: enemy.scaled_defense,
      xp_reward: enemy.scaled_xp,
      is_boss: enemy.is_boss ? 1 : 0
    };
  }

  function getLocationPayload(floor) {
    return {
      level: floor.level_number,
      floor: floor.floor_number,
      name: floor.name,
      level_name: floor.level_name,
      biome: floor.biome,
      description: floor.description,
      is_boss_floor: floor.is_boss_floor ? 1 : 0,
      difficulty_rating: floor.difficulty_rating,
      gateway_name: floor.gateway_name
    };
  }

  async function narrateScene(context) {
    try {
      if (!process.env.GEMINI_API_KEY) {
        return {
          narration: "",
          choices: []
        };
      }

      const prompt = buildPrompt({
        persona: context.player.persona,
        context
      });
      const result = await model.generateContent(prompt);
      const parsed = parseAiJson(result.response.text());

      return {
        narration: String(parsed.narration || ""),
        choices: Array.isArray(parsed.choices) && parsed.choices.length
          ? parsed.choices.slice(0, 5).map(String)
          : []
      };
    } catch (error) {
      console.error("play narration error:", error.message);
      return {
        narration: "",
        choices: []
      };
    }
  }

  async function interpretPlayerAction({ persona, context, actionInput }) {
    if (!process.env.GEMINI_API_KEY) {
      return {
        action_key: "typed_player_action",
        mechanic_key: "typed",
        playable: true,
        intent: actionInput,
        target: null,
        approach: "fallback",
        risk_level: "medium",
        reason: "Gemini is not configured"
      };
    }

    try {
      const prompt = buildActionInterpretationPrompt({
        persona,
        context,
        action: actionInput
      });
      const result = await model.generateContent(prompt);
      const parsed = parseAiJson(result.response.text());

      return {
        action_key: String(parsed.action_key || "typed_player_action"),
        mechanic_key: String(parsed.mechanic_key || "typed"),
        playable: parsed.playable !== false,
        intent: String(parsed.intent || actionInput),
        target: parsed.target ? String(parsed.target) : null,
        approach: String(parsed.approach || ""),
        risk_level: ["low", "medium", "high"].includes(parsed.risk_level) ? parsed.risk_level : "medium",
        reason: String(parsed.reason || "")
      };
    } catch (error) {
      console.error("play interpretation error:", error.message);

      return {
        action_key: "typed_player_action",
        mechanic_key: "typed",
        playable: true,
        intent: actionInput,
        target: null,
        approach: "fallback",
        risk_level: "medium",
        reason: "Action interpretation fallback"
      };
    }
  }

  async function loadPlayer(conn, userId) {
    const [[player]] = await conn.query(
      `SELECT
        id,
        user_id,
        persona,
        name,
        current_race,
        current_title,
        COALESCE(current_dungeon_level, 1) AS current_dungeon_level,
        level,
        exp,
        stat_points,
        hp,
        max_hp,
        strength_stat,
        dexterity_stat,
        stamina_stat,
        intelligence_stat,
        charisma_stat,
        wisdom_stat,
        current_floor,
        current_area,
        life_number,
        is_alive,
        year_survived,
        day_survived,
        current_hour
       FROM players
       WHERE user_id = ?
       LIMIT 1`,
      [userId]
    );

    return player || null;
  }

  async function loadFloorByPosition(conn, dungeonLevel, floorNumber) {
    const [[floor]] = await conn.query(
      `SELECT
        df.id,
        df.floor_number,
        df.name,
        df.description,
        df.is_boss_floor,
        df.difficulty_rating,
        dl.level_number,
        dl.name AS level_name,
        dl.biome,
        dl.gateway_name
       FROM dungeon_floors df
       INNER JOIN dungeon_levels dl ON df.level_id = dl.id
       WHERE dl.level_number = ?
         AND df.floor_number = ?
       LIMIT 1`,
      [dungeonLevel, floorNumber]
    );

    return floor || null;
  }

  async function loadFloor(conn, player) {
    return loadFloorByPosition(conn, player.current_dungeon_level || 1, player.current_floor || 1);
  }

  async function loadSpawnEnemy(conn, floor) {
    const [[enemy]] = await conn.query(
      `SELECT
        et.*,
        fes.min_group_size,
        fes.max_group_size,
        fes.encounter_role,
        fes.formation_json,
        fes.spawn_rules_json,
        GREATEST(et.base_hp + (? * 3), 1) AS scaled_hp,
        GREATEST(et.base_attack + FLOOR(? / 5), 1) AS scaled_attack,
        GREATEST(et.base_defense + FLOOR(? / 12), 0) AS scaled_defense,
        GREATEST(et.xp_reward + FLOOR(? / 2), 1) AS scaled_xp
       FROM floor_enemy_spawns fes
       INNER JOIN enemy_types et ON fes.enemy_type_id = et.id
       WHERE fes.dungeon_floor_id = ?
       ORDER BY fes.is_boss_spawn DESC, (-LOG(GREATEST(RAND(), 0.000001)) / GREATEST(fes.spawn_weight, 1)) ASC
       LIMIT 1`,
      [
        floor.difficulty_rating,
        floor.difficulty_rating,
        floor.difficulty_rating,
        floor.difficulty_rating,
        floor.id
      ]
    );

    return enemy || null;
  }

  async function loadOrCreateFloorState(conn, player, floor, spawnEnemy) {
    async function loadEncounterMembers(encounterId) {
      if (!encounterId) return [];

      const [members] = await conn.query(
        `SELECT *
         FROM player_encounter_enemies
         WHERE encounter_id = ?
         ORDER BY is_defeated ASC, position_index ASC, id ASC`,
        [encounterId]
      );

      return members.map((member) => ({
        id: member.id,
        enemy_type_id: member.enemy_type_id,
        enemy_key: member.enemy_key,
        display_name: member.display_name,
        role_key: member.role_key,
        rank_tier: member.rank_tier,
        faction_key: member.faction_key,
        position_index: member.position_index,
        hp: member.current_hp,
        max_hp: member.max_hp,
        attack: member.attack_value,
        defense: member.defense_value,
        phase: member.phase,
        statuses: parseJson(member.status_json, []),
        resistances: parseJson(member.resistance_json, {}),
        weaknesses: parseJson(member.weakness_json, {}),
        abilities: parseJson(member.ability_state_json, []),
        mutations: parseJson(member.mutation_state_json, {}),
        behavior: parseJson(member.ai_behavior_json, {}),
        is_summoned: member.is_summoned ? 1 : 0,
        is_defeated: member.is_defeated ? 1 : 0
      }));
    }

    const [[existing]] = await conn.query(
      `SELECT *
       FROM player_floor_states
       WHERE player_id = ? AND dungeon_floor_id = ?
       LIMIT 1`,
      [player.id, floor.id]
    );

    if (existing?.active_encounter_id) {
      return {
        ...existing,
        biome_hazard: parseJson(existing.biome_hazard_json, null),
        encounter_members: await loadEncounterMembers(existing.active_encounter_id)
      };
    }

    const enemyCount = spawnEnemy
      ? clamp(spawnEnemy.min_group_size || 1, 1, spawnEnemy.max_group_size || 1)
      : 0;
    const enemyHp = spawnEnemy ? spawnEnemy.scaled_hp * enemyCount : 0;
    let activeEncounterId = null;
    let biomeHazard = null;

    if (spawnEnemy) {
      const [[hazard]] = await conn.query(
        `SELECT *
         FROM dungeon_biome_hazards
         WHERE biome = ?
           AND ? BETWEEN min_dungeon_level AND max_dungeon_level
         ORDER BY (-LOG(GREATEST(RAND(), 0.000001)) / GREATEST(spawn_weight, 1)) ASC
         LIMIT 1`,
        [floor.biome, floor.level_number]
      );
      biomeHazard = hazard
        ? {
            hazard_key: hazard.hazard_key,
            name: hazard.name,
            description: hazard.description,
            effect: parseJson(hazard.effect_json, {})
          }
        : null;

      const [encounterResult] = await conn.query(
        `INSERT INTO player_encounters (
          player_id,
          dungeon_floor_id,
          encounter_type,
          faction_key,
          formation_key,
          formation_json,
          synergy_json,
          biome_hazard_json,
          environment_effect_json,
          ai_directive_json,
          phase,
          difficulty_rating,
          is_hidden,
          is_roaming
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          player.id,
          floor.id,
          spawnEnemy.encounter_role || "ambient",
          spawnEnemy.faction_key || null,
          parseJson(spawnEnemy.formation_json, {})?.group_logic || null,
          spawnEnemy.formation_json || null,
          JSON.stringify({
            faction_key: spawnEnemy.faction_key || null,
            role: spawnEnemy.encounter_role || "ambient",
            group_size: enemyCount
          }),
          biomeHazard ? JSON.stringify(biomeHazard) : null,
          biomeHazard ? JSON.stringify(biomeHazard.effect || {}) : null,
          JSON.stringify({
            enemy_style: spawnEnemy.ai_style_prompt || null,
            behavior: parseJson(spawnEnemy.behavior_json, {}),
            abilities: parseJson(spawnEnemy.abilities_json, [])
          }),
          1,
          floor.difficulty_rating,
          spawnEnemy.is_hidden ? 1 : 0,
          spawnEnemy.is_roaming ? 1 : 0
        ]
      );
      activeEncounterId = encounterResult.insertId;

      for (let i = 1; i <= enemyCount; i += 1) {
        await conn.query(
          `INSERT INTO player_encounter_enemies (
            encounter_id,
            enemy_type_id,
            enemy_key,
            display_name,
            role_key,
            rank_tier,
            faction_key,
            position_index,
            current_hp,
            max_hp,
            attack_value,
            defense_value,
            phase,
            status_json,
            resistance_json,
            weakness_json,
            ability_state_json,
            mutation_state_json,
            ai_behavior_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            activeEncounterId,
            spawnEnemy.id,
            spawnEnemy.enemy_key,
            enemyCount > 1 ? `${spawnEnemy.name} ${i}` : spawnEnemy.name,
            i === 1 ? "leader" : "fighter",
            spawnEnemy.rank_tier || "common",
            spawnEnemy.faction_key || null,
            i,
            spawnEnemy.scaled_hp,
            spawnEnemy.scaled_hp,
            spawnEnemy.scaled_attack,
            spawnEnemy.scaled_defense,
            1,
            JSON.stringify([]),
            JSON.stringify({ element: spawnEnemy.elemental_affinity || null }),
            JSON.stringify({ inferred_from_biome: floor.biome }),
            spawnEnemy.abilities_json || JSON.stringify([]),
            spawnEnemy.mutation_json || JSON.stringify({}),
            spawnEnemy.behavior_json || JSON.stringify({})
          ]
        );
      }
    }

    await conn.query(
      `INSERT INTO player_floor_states (
        player_id,
        dungeon_floor_id,
        active_enemy_type_id,
        active_encounter_id,
        enemy_count,
        enemy_hp,
        is_boss,
        biome_hazard_json,
        encounter_seed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        player.id,
        floor.id,
        spawnEnemy?.id || null,
        activeEncounterId,
        enemyCount,
        enemyHp,
        spawnEnemy?.is_boss ? 1 : 0,
        biomeHazard ? JSON.stringify(biomeHazard) : null,
        `${player.id}:${floor.id}:${Date.now()}`
      ]
    );

    return {
      player_id: player.id,
      dungeon_floor_id: floor.id,
      active_enemy_type_id: spawnEnemy?.id || null,
      active_encounter_id: activeEncounterId,
      enemy_count: enemyCount,
      enemy_hp: enemyHp,
      is_boss: spawnEnemy?.is_boss ? 1 : 0,
      biome_hazard_json: biomeHazard ? JSON.stringify(biomeHazard) : null,
      biome_hazard: biomeHazard,
      encounter_members: await loadEncounterMembers(activeEncounterId),
      last_event_json: null
    };
  }

  async function loadMemories(conn, playerId) {
    const [memories] = await conn.query(
      `SELECT memory_type, summary, importance, metadata_json, created_at
       FROM player_memories
       WHERE player_id = ?
       ORDER BY importance DESC, created_at DESC
       LIMIT 8`,
      [playerId]
    );

    return memories.map((memory) => ({
      ...memory,
      metadata: parseJson(memory.metadata_json, null)
    }));
  }

  async function loadInventory(conn, playerId) {
    const [items] = await conn.query(
      `SELECT item_key, name, item_type, quantity, metadata_json
       FROM player_inventory
       WHERE player_id = ?
       ORDER BY item_type ASC, name ASC`,
      [playerId]
    );

    return items.map((item) => ({
      ...item,
      metadata: parseJson(item.metadata_json, null)
    }));
  }

  async function buildAiContext(conn, player, floor, enemy, state, eventFeedback = null) {
    const enemyPayload = state?.enemy_hp > 0
      ? getEnemySnapshot(enemy, state.enemy_count, state.enemy_hp)
      : null;
    if (enemyPayload) {
      enemyPayload.active_encounter_id = state.active_encounter_id || null;
      enemyPayload.members = state.encounter_members || [];
      enemyPayload.biome_hazard = state.biome_hazard || parseJson(state.biome_hazard_json, null);
    }
    const location = getLocationPayload(floor);
    const inventory = await loadInventory(conn, player.id);
    const memories = await loadMemories(conn, player.id);
    const skills = await getPlayerSkillContext(conn, player.id);

    return {
      player: getPlayerSnapshot(player),
      location,
      enemy: enemyPayload,
      inventory,
      memories,
      skills,
      event_feedback: eventFeedback
    };
  }

  async function buildResponse(conn, player, floor, enemy, state, eventFeedback = null) {
    const context = await buildAiContext(conn, player, floor, enemy, state, eventFeedback);
    const ai = await narrateScene(context);
    const location = context.location;

    return {
      message: eventFeedback?.message || "play_state_ready",
      scene: {
        title: location.name,
        text: ai.narration,
        type: "dungeon",
        choices: ai.choices,
        can_type: true
      },
      world: {
        level: location.level,
        floor: location.floor,
        area: location.name,
        biome: location.biome,
        time_of_day: getTimeOfDay(player.current_hour)
      },
      player: getPlayerSnapshot(player),
      enemy: context.enemy,
      event_feedback: eventFeedback
    };
  }

  const userId = req.user.userId;
  const actionInput = String(req.body?.action || req.body?.choice || "").trim();

  if (!actionInput) {
    return res.status(400).json({ message: "Action or choice is required" });
  }

  let conn;
  let transactionStarted = false;

  try {
    conn = await pool.getConnection();

    const player = await loadPlayer(conn, userId);
    if (!player) {
      return res.status(404).json({ message: "Player not found" });
    }

    if (!player.is_alive || player.hp <= 0) {
      return res.status(400).json({ message: "This life has ended", player: getPlayerSnapshot(player) });
    }

    const floor = await loadFloor(conn, player);
    if (!floor) {
      return res.status(404).json({ message: "Dungeon floor not found. Run migration 002." });
    }

    const enemy = await loadSpawnEnemy(conn, floor);
    const state = await loadOrCreateFloorState(conn, player, floor, enemy);
    const actionContext = await buildAiContext(conn, player, floor, enemy, state, {
      player_action: actionInput
    });
    const actionInterpretation = await interpretPlayerAction({
      persona: player.persona,
      context: actionContext,
      actionInput
    });
    const actionKey = actionInterpretation.action_key;
    const mechanicKey = actionInterpretation.playable ? actionInterpretation.mechanic_key : "typed";

    await conn.beginTransaction();
    transactionStarted = true;

    const time = applyTime({
      year: player.year_survived,
      day: player.day_survived,
      hour: player.current_hour,
      hoursToAdd: getActionTimeCost(mechanicKey)
    });
    const eventFeedback = {
      player_action: actionInput,
      action_key: actionKey,
      mechanic_key: mechanicKey,
      interpretation: actionInterpretation,
      message: "action_resolved"
    };

    let defeatedEnemy = null;
    let nextHp = player.hp;
    let nextExp = player.exp;
    let nextLevel = player.level;
    let nextStatPoints = player.stat_points;
    let nextDungeonLevel = player.current_dungeon_level || 1;
    let nextFloor = player.current_floor || 1;
    let nextArea = floor.name;
    let nextEnemyHp = state.enemy_hp;
    let nextEnemyCount = state.enemy_count;
    let nextAlive = player.is_alive;

    if (mechanicKey === "attack" && enemy && state.enemy_hp > 0) {
      const activeMembers = Array.isArray(state.encounter_members)
        ? state.encounter_members.filter((member) => !member.is_defeated && member.hp > 0)
        : [];
      const targetMember = activeMembers[0] || null;
      const targetDefense = targetMember ? targetMember.defense : enemy.scaled_defense;
      const playerDamage = Math.max(1, player.strength_stat * 2 + Math.floor(player.dexterity_stat / 2) - targetDefense);
      const groupAttack = activeMembers.length
        ? activeMembers.reduce((sum, member) => sum + Number(member.attack || 0), 0)
        : enemy.scaled_attack * Math.max(1, state.enemy_count);
      const enemyDamage = Math.max(0, groupAttack - Math.floor(player.stamina_stat / 2));

      if (targetMember) {
        const nextTargetHp = Math.max(0, targetMember.hp - playerDamage);

        await conn.query(
          `UPDATE player_encounter_enemies
           SET current_hp = ?, is_defeated = ?, defeated_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE defeated_at END
           WHERE id = ?`,
          [nextTargetHp, nextTargetHp <= 0 ? 1 : 0, nextTargetHp <= 0 ? 1 : 0, targetMember.id]
        );

        const remainingMembers = activeMembers.map((member) => (
          member.id === targetMember.id
            ? { ...member, hp: nextTargetHp, is_defeated: nextTargetHp <= 0 ? 1 : 0 }
            : member
        )).filter((member) => !member.is_defeated && member.hp > 0);

        nextEnemyHp = remainingMembers.reduce((sum, member) => sum + Number(member.hp || 0), 0);
        nextEnemyCount = remainingMembers.length;

        if (!remainingMembers.length && state.active_encounter_id) {
          await conn.query(
            `UPDATE player_encounters
             SET is_resolved = 1, resolved_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [state.active_encounter_id]
          );
        }
      } else {
        nextEnemyHp = Math.max(0, state.enemy_hp - playerDamage);
      }

      if (nextEnemyHp <= 0) {
        defeatedEnemy = enemy;
        nextExp += enemy.scaled_xp * Math.max(1, state.enemy_count);
        eventFeedback.combat = {
          player_attempt: actionInput,
          target_member: targetMember,
          player_damage_dealt: playerDamage,
          enemy_damage_dealt: 0,
          remaining_enemy_count: 0,
          defeated: true
        };

        const requiredExp = Math.max(25, (nextLevel + 1) * 50);
        if (nextExp >= requiredExp) {
          nextExp -= requiredExp;
          nextLevel += 1;
          nextStatPoints += 3;
          eventFeedback.level_up = {
            level: nextLevel,
            stat_points_gained: 3
          };
        }
      } else {
        nextHp = Math.max(0, player.hp - enemyDamage);
        eventFeedback.combat = {
          player_attempt: actionInput,
          target_member: targetMember,
          enemy_reaction_code: "counterattack",
          player_damage_dealt: playerDamage,
          enemy_damage_dealt: enemyDamage,
          remaining_enemy_count: nextEnemyCount,
          defeated: false
        };
      }
    } else if (mechanicKey === "move") {
      if (state.enemy_hp > 0) {
        const enemyDamage = enemy ? Math.max(1, enemy.scaled_attack - Math.floor(player.dexterity_stat / 2)) : 0;
        nextHp = Math.max(0, player.hp - enemyDamage);
        eventFeedback.world_reaction = {
          code: "blocked_by_active_enemy",
          blocked: true
        };
        eventFeedback.combat = {
          player_attempt: actionInput,
          enemy_reaction_code: "opportunity_attack",
          player_damage_dealt: 0,
          enemy_damage_dealt: enemyDamage,
          defeated: false
        };
      } else if (player.current_floor >= 10) {
        nextDungeonLevel = Math.min(100, nextDungeonLevel + 1);
        nextFloor = nextDungeonLevel >= 100 && player.current_floor >= 10 ? 10 : 1;
        eventFeedback.world_reaction = {
          code: "level_gateway_opened",
          next_dungeon_level: nextDungeonLevel,
          next_floor: nextFloor
        };
      } else {
        nextFloor += 1;
        eventFeedback.world_reaction = {
          code: "floor_advanced",
          next_floor: nextFloor
        };
      }
    } else if (mechanicKey === "rest") {
      const recovery = Math.max(4, player.stamina_stat * 2);
      nextHp = Math.min(player.max_hp, player.hp + recovery);
      eventFeedback.recovery = {
        hp_recovered: nextHp - player.hp,
        recovery_complete: nextHp === player.max_hp
      };
    } else if (mechanicKey === "defend") {
      if (enemy && state.enemy_hp > 0) {
        const enemyDamage = Math.max(0, Math.floor(enemy.scaled_attack / 2) - player.stamina_stat);
        nextHp = Math.max(0, player.hp - enemyDamage);
        eventFeedback.combat = {
          player_attempt: actionInput,
          enemy_reaction_code: "guard_test",
          player_damage_dealt: 0,
          enemy_damage_dealt: enemyDamage,
          defeated: false
        };
      }
    } else if (mechanicKey === "hide") {
      eventFeedback.world_reaction = {
        code: "hide_attempt",
        threat_present: !!(enemy && state.enemy_hp > 0)
      };
    } else if (mechanicKey === "appraise" || mechanicKey === "look" || mechanicKey === "typed") {
      eventFeedback.world_reaction = {
        code: "observation",
        source_action_key: actionKey,
        source_mechanic_key: mechanicKey
      };
    }

    const nextLocation = await loadFloorByPosition(conn, nextDungeonLevel, nextFloor);
    if (nextLocation) nextArea = nextLocation.name;

    if (nextHp <= 0) {
      nextAlive = 0;
      eventFeedback.message = "player_defeated";
    }

    await conn.query(
      `UPDATE players
       SET
        current_dungeon_level = ?,
        current_floor = ?,
        current_area = ?,
        level = ?,
        exp = ?,
        stat_points = ?,
        hp = ?,
        is_alive = ?,
        year_survived = ?,
        day_survived = ?,
        current_hour = ?
       WHERE id = ?`,
      [
        nextDungeonLevel,
        nextFloor,
        nextArea,
        nextLevel,
        nextExp,
        nextStatPoints,
        nextHp,
        nextAlive,
        time.year,
        time.day,
        time.hour,
        player.id
      ]
    );

    await conn.query(
      `UPDATE player_floor_states
       SET enemy_hp = ?, enemy_count = ?, last_event_json = ?
       WHERE player_id = ? AND dungeon_floor_id = ?`,
      [nextEnemyHp, nextEnemyCount, JSON.stringify(eventFeedback), player.id, floor.id]
    );

    await conn.query(
      `INSERT INTO player_memories (player_id, memory_type, summary, importance, metadata_json)
       VALUES (?, ?, ?, ?, ?)`,
      [
        player.id,
        defeatedEnemy ? "combat_victory" : "action",
        actionInterpretation.intent || actionInput,
        defeatedEnemy ? 3 : 1,
        JSON.stringify({
          action_key: actionKey,
          mechanic_key: mechanicKey,
          player_action: actionInput,
          interpretation: actionInterpretation,
          location: getLocationPayload(floor),
          enemy: defeatedEnemy ? getEnemySnapshot(defeatedEnemy, state.enemy_count, 0) : null
        })
      ]
    );

    const changedStats = await trackActionBehavior(conn, {
      playerId: player.id,
      actionKey: mechanicKey,
      actionInput,
      defeatedEnemy,
      textResolution: { resolution_type: "playable" },
      textInterpretation: {
        intent: mechanicKey,
        input: actionInput,
        approach: actionInterpretation.approach,
        risk_level: actionInterpretation.risk_level
      }
    });
    const skillProgression = await evaluateSkillProgression(conn, {
      playerId: player.id,
      playerLevel: nextLevel,
      changedStats
    });

    await conn.commit();

    const nextPlayer = {
      ...player,
      current_dungeon_level: nextDungeonLevel,
      current_floor: nextFloor,
      current_area: nextArea,
      level: nextLevel,
      exp: nextExp,
      stat_points: nextStatPoints,
      hp: nextHp,
      is_alive: nextAlive,
      year_survived: time.year,
      day_survived: time.day,
      current_hour: time.hour
    };
    const nextFloorData = await loadFloor(pool, nextPlayer);
    const nextEnemy = nextFloorData ? await loadSpawnEnemy(pool, nextFloorData) : null;
    const nextState = nextFloorData ? await loadOrCreateFloorState(pool, nextPlayer, nextFloorData, nextEnemy) : state;
    const response = await buildResponse(pool, nextPlayer, nextFloorData || floor, nextEnemy || enemy, nextState, {
      ...eventFeedback,
      skill_progression: skillProgression
    });

    return res.json(response);
  } catch (error) {
    if (conn && transactionStarted) await conn.rollback();
    console.error("play action error:", error);
    return res.status(500).json({ message: "Failed to resolve action" });
  } finally {
    if (conn) conn.release();
  }
});

// Resolves a player action submitted to the play router root.
router.post("/", authenticateToken, async function playAction(req, res) {
  req.url = "/action";
  return router.handle(req, res);
});

module.exports = router;
