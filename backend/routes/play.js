const router = require("express").Router();
const pool = require("../config/db");
const { model } = require("../config/gemini");
const { buildPrompt, buildActionInterpretationPrompt, buildWorldDirectorPrompt } = require("../config/prompts");
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
      stats: {
        strength: enemy.base_strength,
        dexterity: enemy.base_dexterity,
        stamina: enemy.base_stamina,
        intelligence: enemy.base_intelligence,
        wisdom: enemy.base_wisdom,
        charisma: enemy.base_charisma
      },
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
         AND ? BETWEEN et.min_dungeon_level AND et.max_dungeon_level
         AND et.base_level <= ?
       ORDER BY fes.is_boss_spawn DESC, (-LOG(GREATEST(RAND(), 0.000001)) / GREATEST(fes.spawn_weight, 1)) ASC
       LIMIT 1`,
      [
        floor.difficulty_rating,
        floor.difficulty_rating,
        floor.difficulty_rating,
        floor.difficulty_rating,
        floor.id,
        floor.level_number,
        floor.difficulty_rating + 5
      ]
    );

    return enemy || null;
  }

  async function loadEnemyForState(conn, floor, state, fallbackEnemy = null) {
    if (!state?.active_enemy_type_id) return fallbackEnemy;

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
       FROM enemy_types et
       LEFT JOIN floor_enemy_spawns fes
         ON fes.enemy_type_id = et.id
        AND fes.dungeon_floor_id = ?
       WHERE et.id = ?
       LIMIT 1`,
      [
        floor.difficulty_rating,
        floor.difficulty_rating,
        floor.difficulty_rating,
        floor.difficulty_rating,
        floor.id,
        state.active_enemy_type_id
      ]
    );

    return enemy || fallbackEnemy;
  }

  function isEncounterTooStrongForFloor(enemy, floor) {
    if (!enemy || enemy.is_boss || floor.is_boss_floor) return false;

    return Number(enemy.base_level || 1) > Number(floor.difficulty_rating || 1) + 5;
  }

  async function resetOverpoweredFloorState(conn, player, state) {
    if (state?.active_encounter_id) {
      await conn.query(
        `UPDATE player_encounters
         SET is_resolved = 1, resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP)
         WHERE id = ?`,
        [state.active_encounter_id]
      );
    }

    await conn.query(
      `DELETE FROM player_floor_states
       WHERE player_id = ? AND dungeon_floor_id = ?`,
      [player.id, state.dungeon_floor_id]
    );
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
        stats: {
          strength: member.strength_stat,
          dexterity: member.dexterity_stat,
          stamina: member.stamina_stat,
          intelligence: member.intelligence_stat,
          wisdom: member.wisdom_stat,
          charisma: member.charisma_stat
        },
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
      const encounterMembers = await loadEncounterMembers(existing.active_encounter_id);
      const activeMembers = encounterMembers.filter((member) => !member.is_defeated && member.hp > 0);
      const enemyHp = activeMembers.reduce((sum, member) => sum + Number(member.hp || 0), 0);
      const enemyCount = activeMembers.length;

      if (enemyHp !== Number(existing.enemy_hp || 0) || enemyCount !== Number(existing.enemy_count || 0)) {
        await conn.query(
          `UPDATE player_floor_states
           SET enemy_hp = ?, enemy_count = ?
           WHERE id = ?`,
          [enemyHp, enemyCount, existing.id]
        );
      }

      return {
        ...existing,
        enemy_hp: enemyHp,
        enemy_count: enemyCount,
        biome_hazard: parseJson(existing.biome_hazard_json, null),
        encounter_members: encounterMembers
      };
    }

    if (existing) {
      return {
        ...existing,
        biome_hazard: parseJson(existing.biome_hazard_json, null),
        encounter_members: []
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
            strength_stat,
            dexterity_stat,
            stamina_stat,
            intelligence_stat,
            wisdom_stat,
            charisma_stat,
            phase,
            status_json,
            resistance_json,
            weakness_json,
            ability_state_json,
            mutation_state_json,
            ai_behavior_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            spawnEnemy.base_strength || Math.max(4, Math.ceil(spawnEnemy.scaled_attack / 2)),
            spawnEnemy.base_dexterity || Math.max(4, Math.ceil(spawnEnemy.scaled_attack / 3)),
            spawnEnemy.base_stamina || Math.max(4, Math.ceil(spawnEnemy.scaled_hp / 10)),
            spawnEnemy.base_intelligence || 2,
            spawnEnemy.base_wisdom || 2,
            spawnEnemy.base_charisma || 1,
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
    const persistedFeedback = eventFeedback || parseJson(state?.last_event_json, null);
    const enemyPayload = state?.enemy_hp > 0
      ? getEnemySnapshot(enemy, state.enemy_count, state.enemy_hp)
      : null;
    if (enemyPayload) {
      const activeMembers = Array.isArray(state.encounter_members)
        ? state.encounter_members.filter((member) => !member.is_defeated && member.hp > 0)
        : [];
      if (activeMembers.length) {
        enemyPayload.count = activeMembers.length;
        enemyPayload.hp = activeMembers.reduce((sum, member) => sum + Number(member.hp || 0), 0);
        enemyPayload.max_hp = activeMembers.reduce((sum, member) => sum + Number(member.max_hp || 0), 0);
      }
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
      event_feedback: persistedFeedback
    };
    const sceneType = !player.is_alive || player.hp <= 0 ? "death" : "dungeon";
    const cachedScene = persistedFeedback?.scene_snapshot?.type === sceneType
      ? persistedFeedback.scene_snapshot
      : null;
    const ai = cachedScene?.text
      ? { narration: cachedScene.text, choices: cachedScene.choices || [] }
      : await narrateScene(context);
    const sceneChoices = sceneType === "death"
      ? ["Be reborn"]
      : ai.choices;
    const canType = sceneType !== "death";
    const scene = {
      title: sceneType === "death" ? "Death" : location.name,
      text: ai.narration,
      type: sceneType,
      choices: sceneChoices,
      can_type: canType
    };

    if (!cachedScene?.text && state?.player_id && state?.dungeon_floor_id) {
      const nextFeedback = {
        ...(persistedFeedback || {}),
        scene_snapshot: scene
      };
      await conn.query(
        `UPDATE player_floor_states
         SET last_event_json = ?
         WHERE player_id = ? AND dungeon_floor_id = ?`,
        [JSON.stringify(nextFeedback), state.player_id, state.dungeon_floor_id]
      );
    }

    return {
      message: persistedFeedback?.message || "play_state_ready",
      scene,
      world: {
        level: location.level,
        floor: location.floor,
        area: location.name,
        biome: location.biome,
        time_of_day: getTimeOfDay(player.current_hour)
      },
      player: getPlayerSnapshot(player),
      enemy: enemyPayload,
      event_feedback: persistedFeedback
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

    const spawnEnemy = await loadSpawnEnemy(conn, floor);
    let state = await loadOrCreateFloorState(conn, player, floor, spawnEnemy);
    let enemy = await loadEnemyForState(conn, floor, state, spawnEnemy);
    if (isEncounterTooStrongForFloor(enemy, floor)) {
      await resetOverpoweredFloorState(conn, player, state);
      state = await loadOrCreateFloorState(conn, player, floor, spawnEnemy);
      enemy = await loadEnemyForState(conn, floor, state, spawnEnemy);
    }

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
      stats: {
        strength: enemy.base_strength,
        dexterity: enemy.base_dexterity,
        stamina: enemy.base_stamina,
        intelligence: enemy.base_intelligence,
        wisdom: enemy.base_wisdom,
        charisma: enemy.base_charisma
      },
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
         AND ? BETWEEN et.min_dungeon_level AND et.max_dungeon_level
         AND et.base_level <= ?
       ORDER BY fes.is_boss_spawn DESC, (-LOG(GREATEST(RAND(), 0.000001)) / GREATEST(fes.spawn_weight, 1)) ASC
       LIMIT 1`,
      [
        floor.difficulty_rating,
        floor.difficulty_rating,
        floor.difficulty_rating,
        floor.difficulty_rating,
        floor.id,
        floor.level_number,
        floor.difficulty_rating + 5
      ]
    );

    return enemy || null;
  }

  async function loadEnemyForState(conn, floor, state, fallbackEnemy = null) {
    if (!state?.active_enemy_type_id) return fallbackEnemy;

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
       FROM enemy_types et
       LEFT JOIN floor_enemy_spawns fes
         ON fes.enemy_type_id = et.id
        AND fes.dungeon_floor_id = ?
       WHERE et.id = ?
       LIMIT 1`,
      [
        floor.difficulty_rating,
        floor.difficulty_rating,
        floor.difficulty_rating,
        floor.difficulty_rating,
        floor.id,
        state.active_enemy_type_id
      ]
    );

    return enemy || fallbackEnemy;
  }

  function isEncounterTooStrongForFloor(enemy, floor) {
    if (!enemy || enemy.is_boss || floor.is_boss_floor) return false;

    return Number(enemy.base_level || 1) > Number(floor.difficulty_rating || 1) + 5;
  }

  async function resetOverpoweredFloorState(conn, player, state) {
    if (state?.active_encounter_id) {
      await conn.query(
        `UPDATE player_encounters
         SET is_resolved = 1, resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP)
         WHERE id = ?`,
        [state.active_encounter_id]
      );
    }

    await conn.query(
      `DELETE FROM player_floor_states
       WHERE player_id = ? AND dungeon_floor_id = ?`,
      [player.id, state.dungeon_floor_id]
    );
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
        stats: {
          strength: member.strength_stat,
          dexterity: member.dexterity_stat,
          stamina: member.stamina_stat,
          intelligence: member.intelligence_stat,
          wisdom: member.wisdom_stat,
          charisma: member.charisma_stat
        },
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
      const encounterMembers = await loadEncounterMembers(existing.active_encounter_id);
      const activeMembers = encounterMembers.filter((member) => !member.is_defeated && member.hp > 0);
      const enemyHp = activeMembers.reduce((sum, member) => sum + Number(member.hp || 0), 0);
      const enemyCount = activeMembers.length;

      if (enemyHp !== Number(existing.enemy_hp || 0) || enemyCount !== Number(existing.enemy_count || 0)) {
        await conn.query(
          `UPDATE player_floor_states
           SET enemy_hp = ?, enemy_count = ?
           WHERE id = ?`,
          [enemyHp, enemyCount, existing.id]
        );
      }

      return {
        ...existing,
        enemy_hp: enemyHp,
        enemy_count: enemyCount,
        biome_hazard: parseJson(existing.biome_hazard_json, null),
        encounter_members: encounterMembers
      };
    }

    if (existing) {
      return {
        ...existing,
        biome_hazard: parseJson(existing.biome_hazard_json, null),
        encounter_members: []
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
            strength_stat,
            dexterity_stat,
            stamina_stat,
            intelligence_stat,
            wisdom_stat,
            charisma_stat,
            phase,
            status_json,
            resistance_json,
            weakness_json,
            ability_state_json,
            mutation_state_json,
            ai_behavior_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            spawnEnemy.base_strength || Math.max(4, Math.ceil(spawnEnemy.scaled_attack / 2)),
            spawnEnemy.base_dexterity || Math.max(4, Math.ceil(spawnEnemy.scaled_attack / 3)),
            spawnEnemy.base_stamina || Math.max(4, Math.ceil(spawnEnemy.scaled_hp / 10)),
            spawnEnemy.base_intelligence || 2,
            spawnEnemy.base_wisdom || 2,
            spawnEnemy.base_charisma || 1,
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
    const persistedFeedback = eventFeedback || parseJson(state?.last_event_json, null);
    const enemyPayload = state?.enemy_hp > 0
      ? getEnemySnapshot(enemy, state.enemy_count, state.enemy_hp)
      : null;
    if (enemyPayload) {
      const activeMembers = Array.isArray(state.encounter_members)
        ? state.encounter_members.filter((member) => !member.is_defeated && member.hp > 0)
        : [];
      if (activeMembers.length) {
        enemyPayload.count = activeMembers.length;
        enemyPayload.hp = activeMembers.reduce((sum, member) => sum + Number(member.hp || 0), 0);
        enemyPayload.max_hp = activeMembers.reduce((sum, member) => sum + Number(member.max_hp || 0), 0);
      }
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
      event_feedback: persistedFeedback
    };
    const sceneType = !player.is_alive || player.hp <= 0 ? "death" : "dungeon";
    const cachedScene = persistedFeedback?.scene_snapshot?.type === sceneType
      ? persistedFeedback.scene_snapshot
      : null;
    const ai = cachedScene?.text
      ? { narration: cachedScene.text, choices: cachedScene.choices || [] }
      : await narrateScene(context);
    const sceneChoices = sceneType === "death"
      ? ["Be reborn"]
      : ai.choices;
    const canType = sceneType !== "death";
    const scene = {
      title: sceneType === "death" ? "Death" : location.name,
      text: ai.narration,
      type: sceneType,
      choices: sceneChoices,
      can_type: canType
    };

    if (!cachedScene?.text && state?.player_id && state?.dungeon_floor_id) {
      const nextFeedback = {
        ...(persistedFeedback || {}),
        scene_snapshot: scene
      };
      await conn.query(
        `UPDATE player_floor_states
         SET last_event_json = ?
         WHERE player_id = ? AND dungeon_floor_id = ?`,
        [JSON.stringify(nextFeedback), state.player_id, state.dungeon_floor_id]
      );
    }

    return {
      message: persistedFeedback?.message || "play_state_ready",
      scene,
      world: {
        level: location.level,
        floor: location.floor,
        area: location.name,
        biome: location.biome,
        time_of_day: getTimeOfDay(player.current_hour)
      },
      player: getPlayerSnapshot(player),
      enemy: enemyPayload,
      event_feedback: persistedFeedback
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

    const spawnEnemy = await loadSpawnEnemy(conn, floor);
    let state = await loadOrCreateFloorState(conn, player, floor, spawnEnemy);
    let enemy = await loadEnemyForState(conn, floor, state, spawnEnemy);
    if (isEncounterTooStrongForFloor(enemy, floor)) {
      await resetOverpoweredFloorState(conn, player, state);
      state = await loadOrCreateFloorState(conn, player, floor, spawnEnemy);
      enemy = await loadEnemyForState(conn, floor, state, spawnEnemy);
    }

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
      stats: {
        strength: enemy.base_strength,
        dexterity: enemy.base_dexterity,
        stamina: enemy.base_stamina,
        intelligence: enemy.base_intelligence,
        wisdom: enemy.base_wisdom,
        charisma: enemy.base_charisma
      },
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
    function cleanString(value, fallback = "") {
      return String(value || fallback).trim();
    }

    function cleanNullableString(value) {
      const text = cleanString(value);
      return text ? text : null;
    }

    function normalizeComboPotential(value) {
      return ["none", "low", "medium", "high"].includes(value) ? value : "none";
    }

    function normalizeStringArray(value) {
      if (!Array.isArray(value)) return [];
      return value.map((item) => cleanString(item)).filter(Boolean).slice(0, 8);
    }

    function normalizeWeaponUsage(value) {
      if (!Array.isArray(value)) return [];

      return value.slice(0, 5).map((item) => ({
        source: cleanString(item?.source),
        purpose: cleanString(item?.purpose)
      })).filter((item) => item.source || item.purpose);
    }

    function normalizeComboChains(value) {
      if (!Array.isArray(value)) return [];

      return value.slice(0, 4).map((item) => ({
        from_step: Number(item?.from_step) || null,
        to_step: Number(item?.to_step) || null,
        dependency: cleanString(item?.dependency)
      })).filter((item) => item.from_step || item.to_step || item.dependency);
    }

    function normalizeCombatComponents(value) {
      if (!Array.isArray(value)) return [];

      return value.slice(0, 4).map((component, index) => {
        const actionType = cleanString(component?.action_type || component?.type, "attack");
        const damageProfile = cleanString(component?.damage_profile, "none");
        const comboRole = cleanString(component?.combo_role, index === 0 ? "primary" : "follow_up");
        const step = Number.isInteger(Number(component?.step)) ? Number(component.step) : index + 1;
        const staminaCost = clamp(Number(component?.stamina_cost) || 1, 1, 10);
        const requiresSuccessOfStep = component?.requires_success_of_step === null || component?.requires_success_of_step === undefined
          ? null
          : Number(component.requires_success_of_step) || null;

        return {
          step,
          action_type: ["attack", "status", "movement", "environment", "finisher", "setup"].includes(actionType) ? actionType : "attack",
          type: cleanString(component?.type || actionType, actionType),
          description: cleanString(component?.description, actionInput),
          target_area: cleanNullableString(component?.target_area),
          weapon_source: cleanNullableString(component?.weapon_source),
          intended_status_effect: cleanNullableString(component?.intended_status_effect || component?.effect),
          effect: cleanNullableString(component?.effect || component?.intended_status_effect),
          damage_profile: ["blunt", "slash", "pierce", "environment", "unarmed", "none"].includes(damageProfile) ? damageProfile : "none",
          stamina_cost: staminaCost,
          combo_role: ["primary", "secondary", "setup", "finisher", "follow_up"].includes(comboRole) ? comboRole : "follow_up",
          requires_success_of_step: requiresSuccessOfStep
        };
      });
    }

    function fallbackInterpretation(reason) {
      return {
        action_key: "typed_player_action",
        mechanic_key: "typed",
        playable: true,
        intent: actionInput,
        target: null,
        approach: "fallback",
        combat_family: null,
        combat_style: null,
        primary_action: actionInput,
        secondary_action: null,
        target_area: null,
        weapon_source: null,
        weapon_usage: [],
        intended_status_effect: null,
        status_attempts: [],
        finisher_attempt: false,
        finisher_detection: { is_finisher: false, condition: null },
        environmental_usage: null,
        stamina_cost: 2,
        combo_potential: "none",
        combo_chains: [],
        tactical_intent: actionInput,
        emotional_combat_state: null,
        combat_posture: null,
        adaptive_mastery_tags: [],
        procedural_skill_hooks: [],
        combat_components: [],
        risk_level: "medium",
        reason
      };
    }

    if (!process.env.GEMINI_API_KEY) {
      return fallbackInterpretation("Gemini is not configured");
    }

    try {
      const prompt = buildActionInterpretationPrompt({
        persona,
        context,
        action: actionInput
      });
      const result = await model.generateContent(prompt);
      const parsed = parseAiJson(result.response.text());
      const parsedComponents = normalizeCombatComponents(parsed.combat_components);
      const rawMechanicKey = String(parsed.mechanic_key || "typed");
      const mechanicKey = rawMechanicKey === "typed" && parsedComponents.length ? "attack" : rawMechanicKey;
      const parsedStatusAttempts = normalizeStringArray(parsed.status_attempts);

      return {
        action_key: String(parsed.action_key || "typed_player_action"),
        mechanic_key: ["look", "move", "attack", "defend", "rest", "hide", "appraise", "typed"].includes(mechanicKey) ? mechanicKey : "typed",
        playable: parsed.playable !== false,
        intent: String(parsed.intent || actionInput),
        target: parsed.target ? String(parsed.target) : null,
        approach: String(parsed.approach || ""),
        combat_family: cleanNullableString(parsed.combat_family),
        combat_style: cleanNullableString(parsed.combat_style),
        primary_action: cleanString(parsed.primary_action, parsed.intent || actionInput),
        secondary_action: cleanNullableString(parsed.secondary_action),
        target_area: cleanNullableString(parsed.target_area),
        weapon_source: cleanNullableString(parsed.weapon_source),
        weapon_usage: normalizeWeaponUsage(parsed.weapon_usage),
        intended_status_effect: cleanNullableString(parsed.intended_status_effect),
        status_attempts: parsedStatusAttempts,
        finisher_attempt: parsed.finisher_attempt === true,
        finisher_detection: {
          is_finisher: parsed.finisher_detection?.is_finisher === true || parsed.finisher_attempt === true,
          condition: cleanNullableString(parsed.finisher_detection?.condition)
        },
        environmental_usage: cleanNullableString(parsed.environmental_usage),
        stamina_cost: clamp(Number(parsed.stamina_cost) || 2, 1, 10),
        combo_potential: normalizeComboPotential(parsed.combo_potential),
        combo_chains: normalizeComboChains(parsed.combo_chains),
        tactical_intent: cleanString(parsed.tactical_intent, parsed.intent || actionInput),
        emotional_combat_state: cleanNullableString(parsed.emotional_combat_state),
        combat_posture: cleanNullableString(parsed.combat_posture),
        adaptive_mastery_tags: normalizeStringArray(parsed.adaptive_mastery_tags),
        procedural_skill_hooks: normalizeStringArray(parsed.procedural_skill_hooks),
        combat_components: parsedComponents,
        risk_level: ["low", "medium", "high"].includes(parsed.risk_level) ? parsed.risk_level : "medium",
        reason: String(parsed.reason || "")
      };
    } catch (error) {
      console.error("play interpretation error:", error.message);

      return fallbackInterpretation("Action interpretation fallback");
    }
  }

  async function directWorldOutcome({ persona, context, actionInterpretation }) {
    function cleanString(value, fallback = "") {
      return String(value || fallback).trim();
    }

    function cleanNullableString(value) {
      const text = cleanString(value);
      return text ? text : null;
    }

    const allowedOutcomes = [
      "advance_floor",
      "gateway_advance",
      "stay_in_area",
      "blocked",
      "discover",
      "rest_safe",
      "rest_uneasy",
      "rest_interrupted",
      "hide_success",
      "hide_partial",
      "hide_failed",
      "observe",
      "world_pressure"
    ];
    const allowedMovement = ["advance", "gateway", "stay", "blocked"];
    const allowedRest = ["safe", "uneasy", "interrupted", "none"];
    const allowedStealth = ["hidden", "partial", "failed", "none"];

    function fallbackDirective(reason) {
      return {
        outcome_key: actionInterpretation.mechanic_key === "move" ? "advance_floor" : "observe",
        world_state: "The dungeon holds to its current pressure.",
        route_result: {
          movement: actionInterpretation.mechanic_key === "move" ? "advance" : "stay",
          reason
        },
        rest_result: {
          state: actionInterpretation.mechanic_key === "rest" ? "safe" : "none",
          reason
        },
        stealth_result: {
          state: actionInterpretation.mechanic_key === "hide" ? "partial" : "none",
          reason
        },
        discovery: {
          found: false,
          name: null,
          description: null,
          useful_as: null
        },
        threat_posture: null,
        environment_shift: null,
        memory_summary: cleanString(actionInterpretation.intent || actionInterpretation.primary_action || reason, reason).slice(0, 240),
        risk_level: ["low", "medium", "high"].includes(actionInterpretation.risk_level) ? actionInterpretation.risk_level : "medium",
        backend_notes: reason
      };
    }

    if (!process.env.GEMINI_API_KEY) {
      return fallbackDirective("Gemini is not configured");
    }

    try {
      const prompt = buildWorldDirectorPrompt({
        persona,
        context,
        actionInterpretation
      });
      const result = await model.generateContent(prompt);
      const parsed = parseAiJson(result.response.text());
      const outcomeKey = cleanString(parsed.outcome_key, "observe");
      const movement = cleanString(parsed.route_result?.movement, "stay");
      const restState = cleanString(parsed.rest_result?.state, "none");
      const stealthState = cleanString(parsed.stealth_result?.state, "none");
      const riskLevel = cleanString(parsed.risk_level, "medium");

      return {
        outcome_key: allowedOutcomes.includes(outcomeKey) ? outcomeKey : "observe",
        world_state: cleanString(parsed.world_state, "The dungeon answers without revealing its full intent."),
        route_result: {
          movement: allowedMovement.includes(movement) ? movement : "stay",
          reason: cleanString(parsed.route_result?.reason)
        },
        rest_result: {
          state: allowedRest.includes(restState) ? restState : "none",
          reason: cleanString(parsed.rest_result?.reason)
        },
        stealth_result: {
          state: allowedStealth.includes(stealthState) ? stealthState : "none",
          reason: cleanString(parsed.stealth_result?.reason)
        },
        discovery: {
          found: parsed.discovery?.found === true,
          name: cleanNullableString(parsed.discovery?.name),
          description: cleanNullableString(parsed.discovery?.description),
          useful_as: cleanNullableString(parsed.discovery?.useful_as)
        },
        threat_posture: cleanNullableString(parsed.threat_posture),
        environment_shift: cleanNullableString(parsed.environment_shift),
        memory_summary: cleanString(parsed.memory_summary, actionInterpretation.intent || "The dungeon shifted.").slice(0, 240),
        risk_level: ["low", "medium", "high"].includes(riskLevel) ? riskLevel : "medium",
        backend_notes: cleanString(parsed.backend_notes)
      };
    } catch (error) {
      console.error("world director error:", error.message);
      return fallbackDirective("World director fallback");
    }
  }

  function buildFallbackCombatComponents(actionInterpretation, actionInput) {
    const damageProfile = actionInterpretation.action_key === "unarmed_attack"
      ? "unarmed"
      : actionInterpretation.weapon_source
        ? "blunt"
        : "none";

    return [{
      step: 1,
      action_type: actionInterpretation.finisher_attempt ? "finisher" : "attack",
      description: actionInterpretation.primary_action || actionInput,
      target_area: actionInterpretation.target_area,
      weapon_source: actionInterpretation.weapon_source,
      intended_status_effect: actionInterpretation.intended_status_effect,
      effect: actionInterpretation.intended_status_effect,
      damage_profile: damageProfile,
      stamina_cost: actionInterpretation.stamina_cost || 2,
      combo_role: actionInterpretation.finisher_attempt ? "finisher" : "primary",
      requires_success_of_step: null
    }];
  }

  function normalizeStatusSlug(value) {
    const text = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const aliases = {
      blindness: "blind",
      blinded: "blind",
      staggered: "stagger",
      bleeding: "bleed",
      broken_limb: "break_limb",
      limb_break: "break_limb",
      knocked_down: "knockdown",
      knocked_prone: "knockdown",
      pinned: "pin",
      disarmed: "disarm"
    };

    return aliases[text] || text || null;
  }

  function statusFromCombatComponent(component, damage, actionInterpretation) {
    const statusSlug = normalizeStatusSlug(component.intended_status_effect);
    if (!statusSlug || damage <= 0) return null;

    const durationMap = {
      blind: 2,
      stagger: 1,
      bleed: 3,
      break_limb: 4,
      disarm: 2,
      knockdown: 1,
      pin: 1,
      burn: 3,
      poison: 4
    };

    return {
      key: statusSlug,
      source: "player_action",
      target_area: component.target_area || actionInterpretation.target_area || null,
      duration: durationMap[statusSlug] || 2,
      intensity: actionInterpretation.risk_level === "high" ? 2 : 1,
      applied_at_step: component.step
    };
  }

  function mergeStatuses(existingStatuses, newStatuses) {
    const byKey = new Map();

    for (const status of Array.isArray(existingStatuses) ? existingStatuses : []) {
      if (!status?.key) continue;
      byKey.set(status.key, status);
    }

    for (const status of newStatuses) {
      if (!status?.key) continue;
      const current = byKey.get(status.key) || {};
      byKey.set(status.key, {
        ...current,
        ...status,
        duration: Math.max(Number(current.duration || 0), Number(status.duration || 0))
      });
    }

    return Array.from(byKey.values());
  }

  function getComponentDamageMultiplier(component, actionInterpretation) {
    let multiplier = 1;

    if (component.action_type === "environment") multiplier += 0.15;
    if (component.action_type === "status") multiplier -= 0.25;
    if (component.action_type === "setup") multiplier -= 0.45;
    if (component.action_type === "finisher") multiplier += actionInterpretation.finisher_attempt ? 0.35 : 0.1;
    if (component.damage_profile === "unarmed") multiplier += 0.05;
    if (component.damage_profile === "slash" || component.damage_profile === "pierce") multiplier += 0.15;
    if (component.damage_profile === "environment") multiplier += 0.1;
    if (component.combo_role === "follow_up" || component.combo_role === "secondary") multiplier -= 0.2;
    if (component.combo_role === "finisher") multiplier += 0.25;
    if (actionInterpretation.combo_potential === "high") multiplier += 0.1;
    if (actionInterpretation.risk_level === "high") multiplier += 0.15;
    if (actionInterpretation.risk_level === "low") multiplier -= 0.1;

    return clamp(multiplier, 0.35, 1.85);
  }

  function getRequiredExp(level) {
    return Math.max(25, (Number(level || 0) + 1) * 50);
  }

  function getMaxHpForStats(level, stamina) {
    const levelBonus = Math.max(0, Number(level || 0)) * 10;
    const staminaBonus = Math.max(0, Number(stamina || 0) - 4) * 5;

    return 40 + levelBonus + staminaBonus;
  }

  function getPlayerBaseDamage(player) {
    return Math.floor(
      (Number(player.strength_stat || 1) * 2.6)
      + (Number(player.dexterity_stat || 1) * 0.8)
      + (Number(player.level || 0) * 1.5)
    );
  }

  function getDamageVariance() {
    return 0.88 + (Math.random() * 0.24);
  }

  function getPlayerDamageMitigation(player) {
    return Math.floor(
      (Number(player.stamina_stat || 1) * 0.85)
      + (Number(player.dexterity_stat || 1) * 0.25)
      + (Number(player.wisdom_stat || 1) * 0.15)
    );
  }

  function getTargetStat(targetMember, statKey, fallback = 5) {
    return Number(targetMember?.stats?.[statKey] || fallback);
  }

  function getComponentAccuracy({ component, actionInterpretation, player, targetMember, stepIndex, staminaSpent }) {
    const enemyDexterity = getTargetStat(targetMember, "dexterity", 5);
    const enemyWisdom = getTargetStat(targetMember, "wisdom", 2);
    const playerDexterity = Number(player.dexterity_stat || 1);
    const enemyEvasion = enemyDexterity + Math.floor(enemyWisdom / 3);
    const targetArea = normalizeStatusSlug(component.target_area);
    let accuracy = 0.65 + ((playerDexterity - enemyEvasion) * 0.035);

    if (component.action_type === "setup") accuracy += 0.08;
    if (component.action_type === "status") accuracy -= 0.03;
    if (component.action_type === "finisher") accuracy -= 0.12;
    if (["eyes", "eye", "throat", "jaw", "hand", "hands", "knee", "knees"].includes(targetArea)) accuracy -= 0.08;
    if (actionInterpretation.combo_potential === "high") accuracy += 0.04;
    if (actionInterpretation.risk_level === "high") accuracy -= 0.06;
    if (actionInterpretation.risk_level === "low") accuracy += 0.05;

    accuracy -= stepIndex * 0.07;
    accuracy -= Math.max(0, staminaSpent - Number(player.stamina_stat || 1)) * 0.025;

    return clamp(accuracy, 0.15, 0.9);
  }

  function getInterruptionChance({ component, actionInterpretation, player, targetMember, stepIndex, hitQuality, statusEffectsApplied, staminaSpent }) {
    const enemyDexterity = getTargetStat(targetMember, "dexterity", 5);
    const enemyStrength = getTargetStat(targetMember, "strength", 5);
    const playerDexterity = Number(player.dexterity_stat || 1);
    const playerStamina = Number(player.stamina_stat || 1);
    const impairingStatuses = statusEffectsApplied.filter((status) => (
      ["blind", "stagger", "break_limb", "disarm", "knockdown", "pin"].includes(status.key)
    )).length;
    let chance = 0.1 + (stepIndex * 0.07) + ((enemyDexterity + enemyStrength - playerDexterity) * 0.015);

    if (hitQuality <= 0) chance += 0.18;
    if (component.action_type === "finisher") chance += 0.08;
    if (actionInterpretation.risk_level === "high") chance += 0.08;
    if (actionInterpretation.combat_posture === "reckless") chance += 0.08;
    chance += Math.max(0, staminaSpent - playerStamina) * 0.03;
    chance -= impairingStatuses * 0.09;

    return clamp(chance, 0.03, 0.65);
  }

  function resolveCombatChain({ player, targetMember, enemy, combatComponents, actionInterpretation, targetDefense }) {
    const damageInstances = [];
    const statusEffectsApplied = [];
    const stepResults = new Map();
    const baseDamage = getPlayerBaseDamage(player);
    const enemyMaxHp = Number(targetMember?.max_hp || enemy?.scaled_hp || 1);
    let nextTargetHp = Number(targetMember?.hp || 0);
    let playerDamage = 0;
    let staminaSpent = 0;
    let successfulSteps = 0;
    let interrupted = false;
    let interruptionStep = null;
    let interruptionReason = null;

    for (let index = 0; index < combatComponents.length; index += 1) {
      const component = combatComponents[index];
      const stepIndex = index + 1;
      const dependencyStep = component.requires_success_of_step;
      const dependencyResult = dependencyStep ? stepResults.get(Number(dependencyStep)) : null;

      if (nextTargetHp <= 0) break;

      if (dependencyStep && !dependencyResult?.landed) {
        damageInstances.push({
          step: component.step,
          action_type: component.action_type,
          type: component.type,
          description: component.description,
          target_area: component.target_area,
          weapon_source: component.weapon_source,
          damage_profile: component.damage_profile,
          accuracy: 0,
          roll: null,
          landed: false,
          interrupted: false,
          skipped: true,
          skip_reason: `requires_step_${dependencyStep}_success`,
          damage_dealt: 0,
          intended_status_effect: component.intended_status_effect,
          hp_after: nextTargetHp
        });
        stepResults.set(component.step, { landed: false, skipped: true });
        continue;
      }

      staminaSpent += clamp(Number(component.stamina_cost || 1), 1, 10);

      const accuracy = getComponentAccuracy({
        component,
        actionInterpretation,
        player,
        targetMember,
        stepIndex: index,
        staminaSpent
      });
      const roll = Math.random();
      const landed = roll <= accuracy;
      const glancing = !landed && roll <= accuracy + 0.16;
      const hitQuality = landed
        ? clamp(0.45 + (accuracy - roll), 0.35, 1)
        : glancing
          ? 0.22
          : 0;
      const multiplier = getComponentDamageMultiplier(component, actionInterpretation);
      const environmentBonus = component.action_type === "environment" || component.damage_profile === "environment"
        ? Math.floor(Number(player.intelligence_stat || 1) / 2)
        : 0;
      const stepPressureShare = clamp((0.9 / combatComponents.length) + (successfulSteps * 0.06), 0.18, 0.75);
      const statusFocusPenalty = component.action_type === "status" || component.intended_status_effect ? 0.65 : 1;
      const finisherAllowed = component.action_type !== "finisher" && component.combo_role !== "finisher"
        ? true
        : nextTargetHp <= Math.floor(enemyMaxHp * 0.35) || successfulSteps >= 2;
      const finisherPenalty = finisherAllowed ? 1 : 0.45;
      const canDamage = component.damage_profile !== "none" || ["attack", "environment", "finisher", "status"].includes(component.action_type);
      const variance = getDamageVariance();
      const rawDamage = canDamage
        ? Math.floor((baseDamage + environmentBonus) * multiplier * stepPressureShare * statusFocusPenalty * finisherPenalty * hitQuality * variance)
        : 0;
      const damage = hitQuality > 0
        ? Math.min(nextTargetHp, Math.max(0, rawDamage - Math.floor(Number(targetDefense || 0) * 0.25)))
        : 0;
      const status = hitQuality >= 0.35 ? statusFromCombatComponent(component, Math.max(damage, hitQuality > 0 ? 1 : 0), actionInterpretation) : null;
      const injuryArea = normalizeStatusSlug(component.target_area);
      const injuryKey = injuryArea && hitQuality >= 0.35
        ? `injured_${injuryArea}`
        : null;

      nextTargetHp = Math.max(0, nextTargetHp - damage);
      playerDamage += damage;
      if (landed) successfulSteps += 1;

      if (status) {
        statusEffectsApplied.push({
          ...status,
          partial: glancing && !landed
        });
      }
      if (injuryKey && damage > 0) {
        statusEffectsApplied.push({
          key: injuryKey,
          source: "targeted_player_action",
          target_area: component.target_area,
          duration: component.combo_role === "finisher" && finisherAllowed ? 4 : 2,
          intensity: damage >= Math.max(8, Math.floor(enemyMaxHp * 0.2)) ? 2 : 1,
          applied_at_step: component.step
        });
      }

      damageInstances.push({
        step: component.step,
        action_type: component.action_type,
        type: component.type,
        description: component.description,
        target_area: component.target_area,
        weapon_source: component.weapon_source,
        damage_profile: component.damage_profile,
        accuracy: Number(accuracy.toFixed(2)),
        roll: Number(roll.toFixed(2)),
        landed,
        glancing,
        hit_quality: Number(hitQuality.toFixed(2)),
        damage_variance: Number(variance.toFixed(2)),
        finisher_allowed: finisherAllowed,
        interrupted: false,
        damage_dealt: damage,
        intended_status_effect: component.intended_status_effect,
        hp_after: nextTargetHp
      });
      stepResults.set(component.step, { landed, glancing, damage });

      if (nextTargetHp > 0 && index < combatComponents.length - 1) {
        const interruptionChance = getInterruptionChance({
          component,
          actionInterpretation,
          player,
          targetMember,
          stepIndex: index,
          hitQuality,
          statusEffectsApplied,
          staminaSpent
        });

        if (Math.random() < interruptionChance) {
          interrupted = true;
          interruptionStep = component.step;
          interruptionReason = landed ? "enemy_recovered_between_combo_steps" : "enemy_countered_failed_sequence";
          damageInstances[damageInstances.length - 1].interrupted = true;
          damageInstances[damageInstances.length - 1].interruption_chance = Number(interruptionChance.toFixed(2));
          break;
        }
      }
    }

    return {
      damageInstances,
      statusEffectsApplied,
      nextTargetHp,
      playerDamage,
      staminaSpent,
      successfulSteps,
      interrupted,
      interruptionStep,
      interruptionReason
    };
  }

  async function saveStoryEvent(conn, { player, floor, enemy, response, eventFeedback, actionInterpretation }) {
    const narration = String(response?.scene?.text || "").trim();
    if (!narration) return;

    const combat = eventFeedback?.combat || null;
    const rankTier = enemy?.rank_tier || "";
    const isBoss = !!(enemy?.is_boss || floor?.is_boss_floor);
    const isRare = ["rare", "elite", "mini_boss", "world_boss"].includes(rankTier);
    const eventType = !player.is_alive || player.hp <= 0
      ? "death"
      : isBoss
        ? "boss_fight"
        : isRare
          ? "rare_enemy"
          : combat
            ? "combat"
            : eventFeedback?.skill_progression?.unlocked?.length
              ? "skill_evolution"
              : "world_event";
    const chapterNumber = Math.max(1, Number(player.current_dungeon_level || 1));
    const title = combat
      ? `${response.world.area}: ${actionInterpretation.action_key}`
      : `${response.world.area}: ${eventFeedback?.message || "Dungeon Event"}`;
    const summary = combat
      ? `${actionInterpretation.tactical_intent || actionInterpretation.intent || "A combat exchange"} against ${enemy?.name || "the dungeon threat"}.`
      : eventFeedback?.message || "A moment in the dungeon journey.";
    const importance = eventType === "death" || eventType === "boss_fight"
      ? 5
      : eventType === "rare_enemy" || eventFeedback?.skill_progression?.unlocked?.length
        ? 4
        : combat?.defeated
          ? 3
          : 2;
    const identityTags = [
      actionInterpretation.combat_family,
      actionInterpretation.combat_style,
      actionInterpretation.combat_posture,
      ...(actionInterpretation.adaptive_mastery_tags || []),
      ...(actionInterpretation.procedural_skill_hooks || [])
    ].filter(Boolean);
    const emotionalTags = [
      actionInterpretation.emotional_combat_state,
      combat?.player_chain_interrupted ? "interrupted" : null,
      combat?.defeated ? "victory" : null,
      player.hp <= 0 ? "death" : null
    ].filter(Boolean);

    try {
      await conn.query(
        `INSERT INTO player_story_chapters (
          player_id,
          chapter_number,
          title,
          summary,
          importance
        ) VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          title = VALUES(title),
          summary = COALESCE(summary, VALUES(summary)),
          importance = GREATEST(importance, VALUES(importance))`,
        [
          player.id,
          chapterNumber,
          `Chapter ${chapterNumber}: ${response.world.biome}`,
          `The journey through ${response.world.area} and the dangers of ${response.world.biome}.`,
          importance
        ]
      );

      const [result] = await conn.query(
        `INSERT INTO player_story_events (
          player_id,
          event_type,
          chapter_number,
          title,
          summary,
          narration,
          location_json,
          combat_json,
          emotional_tags_json,
          identity_tags_json,
          importance,
          is_legendary,
          occurred_year,
          occurred_day,
          occurred_hour
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          player.id,
          eventType,
          chapterNumber,
          title.slice(0, 180),
          summary,
          narration,
          JSON.stringify({
            level: response.world.level,
            floor: response.world.floor,
            area: response.world.area,
            biome: response.world.biome
          }),
          JSON.stringify({
            player_action: eventFeedback?.player_action,
            combat,
            world_reaction: eventFeedback?.world_reaction || null,
            ai_world_directive: eventFeedback?.ai_world_directive || null,
            enemy: response.enemy,
            interpretation: actionInterpretation
          }),
          JSON.stringify(emotionalTags),
          JSON.stringify(identityTags),
          importance,
          eventType === "death" || isBoss || rankTier === "world_boss" ? 1 : 0,
          player.year_survived,
          player.day_survived,
          player.current_hour
        ]
      );

      await conn.query(
        `UPDATE player_story_chapters
         SET opening_event_id = COALESCE(opening_event_id, ?),
             closing_event_id = ?,
             importance = GREATEST(importance, ?)
         WHERE player_id = ?
           AND chapter_number = ?`,
        [result.insertId, result.insertId, importance, player.id, chapterNumber]
      );
    } catch (error) {
      if (error.code === "ER_NO_SUCH_TABLE") {
        console.warn("story archive skipped: run migration 006_story_chronicle.sql");
        return;
      }

      console.error("story archive save error:", error);
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
         AND ? BETWEEN et.min_dungeon_level AND et.max_dungeon_level
         AND et.base_level <= ?
       ORDER BY fes.is_boss_spawn DESC, (-LOG(GREATEST(RAND(), 0.000001)) / GREATEST(fes.spawn_weight, 1)) ASC
       LIMIT 1`,
      [
        floor.difficulty_rating,
        floor.difficulty_rating,
        floor.difficulty_rating,
        floor.difficulty_rating,
        floor.id,
        floor.level_number,
        floor.difficulty_rating + 5
      ]
    );

    return enemy || null;
  }

  async function loadEnemyForState(conn, floor, state, fallbackEnemy = null) {
    if (!state?.active_enemy_type_id) return fallbackEnemy;

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
       FROM enemy_types et
       LEFT JOIN floor_enemy_spawns fes
         ON fes.enemy_type_id = et.id
        AND fes.dungeon_floor_id = ?
       WHERE et.id = ?
       LIMIT 1`,
      [
        floor.difficulty_rating,
        floor.difficulty_rating,
        floor.difficulty_rating,
        floor.difficulty_rating,
        floor.id,
        state.active_enemy_type_id
      ]
    );

    return enemy || fallbackEnemy;
  }

  function isEncounterTooStrongForFloor(enemy, floor) {
    if (!enemy || enemy.is_boss || floor.is_boss_floor) return false;

    return Number(enemy.base_level || 1) > Number(floor.difficulty_rating || 1) + 5;
  }

  async function resetOverpoweredFloorState(conn, player, state) {
    if (state?.active_encounter_id) {
      await conn.query(
        `UPDATE player_encounters
         SET is_resolved = 1, resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP)
         WHERE id = ?`,
        [state.active_encounter_id]
      );
    }

    await conn.query(
      `DELETE FROM player_floor_states
       WHERE player_id = ? AND dungeon_floor_id = ?`,
      [player.id, state.dungeon_floor_id]
    );
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
        stats: {
          strength: member.strength_stat,
          dexterity: member.dexterity_stat,
          stamina: member.stamina_stat,
          intelligence: member.intelligence_stat,
          wisdom: member.wisdom_stat,
          charisma: member.charisma_stat
        },
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
      const encounterMembers = await loadEncounterMembers(existing.active_encounter_id);
      const activeMembers = encounterMembers.filter((member) => !member.is_defeated && member.hp > 0);
      const enemyHp = activeMembers.reduce((sum, member) => sum + Number(member.hp || 0), 0);
      const enemyCount = activeMembers.length;

      if (enemyHp !== Number(existing.enemy_hp || 0) || enemyCount !== Number(existing.enemy_count || 0)) {
        await conn.query(
          `UPDATE player_floor_states
           SET enemy_hp = ?, enemy_count = ?
           WHERE id = ?`,
          [enemyHp, enemyCount, existing.id]
        );
      }

      return {
        ...existing,
        enemy_hp: enemyHp,
        enemy_count: enemyCount,
        biome_hazard: parseJson(existing.biome_hazard_json, null),
        encounter_members: encounterMembers
      };
    }

    if (existing) {
      return {
        ...existing,
        biome_hazard: parseJson(existing.biome_hazard_json, null),
        encounter_members: []
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
            strength_stat,
            dexterity_stat,
            stamina_stat,
            intelligence_stat,
            wisdom_stat,
            charisma_stat,
            phase,
            status_json,
            resistance_json,
            weakness_json,
            ability_state_json,
            mutation_state_json,
            ai_behavior_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            spawnEnemy.base_strength || Math.max(4, Math.ceil(spawnEnemy.scaled_attack / 2)),
            spawnEnemy.base_dexterity || Math.max(4, Math.ceil(spawnEnemy.scaled_attack / 3)),
            spawnEnemy.base_stamina || Math.max(4, Math.ceil(spawnEnemy.scaled_hp / 10)),
            spawnEnemy.base_intelligence || 2,
            spawnEnemy.base_wisdom || 2,
            spawnEnemy.base_charisma || 1,
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
    const persistedFeedback = eventFeedback || parseJson(state?.last_event_json, null);
    const enemyPayload = state?.enemy_hp > 0
      ? getEnemySnapshot(enemy, state.enemy_count, state.enemy_hp)
      : null;
    if (enemyPayload) {
      const activeMembers = Array.isArray(state.encounter_members)
        ? state.encounter_members.filter((member) => !member.is_defeated && member.hp > 0)
        : [];
      if (activeMembers.length) {
        enemyPayload.count = activeMembers.length;
        enemyPayload.hp = activeMembers.reduce((sum, member) => sum + Number(member.hp || 0), 0);
        enemyPayload.max_hp = activeMembers.reduce((sum, member) => sum + Number(member.max_hp || 0), 0);
      }
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
      event_feedback: persistedFeedback
    };
  }

  async function buildResponse(conn, player, floor, enemy, state, eventFeedback = null) {
    const context = await buildAiContext(conn, player, floor, enemy, state, eventFeedback);
    const sceneType = !player.is_alive || player.hp <= 0 ? "death" : "dungeon";
    const cachedScene = context.event_feedback?.scene_snapshot?.type === sceneType
      ? context.event_feedback.scene_snapshot
      : null;
    const ai = cachedScene?.text
      ? { narration: cachedScene.text, choices: cachedScene.choices || [] }
      : await narrateScene(context);
    const location = context.location;
    const sceneChoices = sceneType === "death"
      ? ["Be reborn"]
      : ai.choices;
    const canType = sceneType !== "death";
    const scene = {
      title: sceneType === "death" ? "Death" : location.name,
      text: ai.narration,
      type: sceneType,
      choices: sceneChoices,
      can_type: canType
    };

    return {
      message: context.event_feedback?.message || "play_state_ready",
      scene,
      world: {
        level: location.level,
        floor: location.floor,
        area: location.name,
        biome: location.biome,
        time_of_day: getTimeOfDay(player.current_hour)
      },
      player: getPlayerSnapshot(player),
      enemy: context.enemy,
      event_feedback: context.event_feedback
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

    const spawnEnemy = await loadSpawnEnemy(conn, floor);
    let state = await loadOrCreateFloorState(conn, player, floor, spawnEnemy);
    let enemy = await loadEnemyForState(conn, floor, state, spawnEnemy);
    if (isEncounterTooStrongForFloor(enemy, floor)) {
      await resetOverpoweredFloorState(conn, player, state);
      state = await loadOrCreateFloorState(conn, player, floor, spawnEnemy);
      enemy = await loadEnemyForState(conn, floor, state, spawnEnemy);
    }
    const actionContext = await buildAiContext(conn, player, floor, enemy, state, {
      player_action: actionInput
    });
    const actionInterpretation = await interpretPlayerAction({
      persona: player.persona,
      context: actionContext,
      actionInput
    });
    const aiWorldDirective = await directWorldOutcome({
      persona: player.persona,
      context: actionContext,
      actionInterpretation
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
      ai_world_directive: aiWorldDirective,
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
    let nextMaxHp = Math.max(Number(player.max_hp || 0), getMaxHpForStats(nextLevel, player.stamina_stat));

    if (mechanicKey === "attack" && enemy && state.enemy_hp > 0) {
      const activeMembers = Array.isArray(state.encounter_members)
        ? state.encounter_members.filter((member) => !member.is_defeated && member.hp > 0)
        : [];
      const targetMember = activeMembers[0] || null;
      const targetDefense = targetMember ? targetMember.defense : enemy.scaled_defense;
      const combatComponents = actionInterpretation.combat_components.length
        ? actionInterpretation.combat_components
        : buildFallbackCombatComponents(actionInterpretation, actionInput);
      const damageInstances = [];
      const statusEffectsApplied = [];
      let chainResolution = null;
      let playerDamage = 0;
      let enemyDamage = 0;
      let remainingMembers = activeMembers;

      if (targetMember) {
        chainResolution = resolveCombatChain({
          player,
          targetMember,
          enemy,
          combatComponents,
          actionInterpretation,
          targetDefense
        });
        damageInstances.push(...chainResolution.damageInstances);
        statusEffectsApplied.push(...chainResolution.statusEffectsApplied);
        playerDamage = chainResolution.playerDamage;

        const nextStatuses = mergeStatuses(targetMember.statuses, statusEffectsApplied);
        const nextTargetHp = chainResolution.nextTargetHp;

        await conn.query(
          `UPDATE player_encounter_enemies
           SET current_hp = ?,
               status_json = ?,
               is_defeated = ?,
               defeated_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE defeated_at END
           WHERE id = ?`,
          [
            nextTargetHp,
            JSON.stringify(nextStatuses),
            nextTargetHp <= 0 ? 1 : 0,
            nextTargetHp <= 0 ? 1 : 0,
            targetMember.id
          ]
        );

        remainingMembers = activeMembers.map((member) => (
          member.id === targetMember.id
            ? { ...member, hp: nextTargetHp, statuses: nextStatuses, is_defeated: nextTargetHp <= 0 ? 1 : 0 }
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
        playerDamage = combatComponents.reduce((sum, component) => {
          const multiplier = getComponentDamageMultiplier(component, actionInterpretation);
          const pressureShare = clamp(0.8 / combatComponents.length, 0.18, 0.8);
          const accuracy = getComponentAccuracy({
            component,
            actionInterpretation,
            player,
            targetMember: null,
            stepIndex: damageInstances.length,
            staminaSpent: damageInstances.reduce((total, hit) => total + Number(hit.stamina_cost || 0), 0)
          });
          const roll = Math.random();
          const landed = roll <= accuracy;
          const glancing = !landed && roll <= accuracy + 0.16;
          const hitQuality = landed ? clamp(0.45 + (accuracy - roll), 0.35, 1) : glancing ? 0.22 : 0;
          const variance = getDamageVariance();
          const damage = hitQuality > 0
            ? Math.max(0, Math.floor(getPlayerBaseDamage(player) * multiplier * pressureShare * hitQuality * variance) - Math.floor(targetDefense * 0.25))
            : 0;

          damageInstances.push({
            step: component.step,
            action_type: component.action_type,
            type: component.type,
            description: component.description,
            target_area: component.target_area,
            weapon_source: component.weapon_source,
            damage_profile: component.damage_profile,
            accuracy: Number(accuracy.toFixed(2)),
            roll: Number(roll.toFixed(2)),
            landed,
            glancing,
            hit_quality: Number(hitQuality.toFixed(2)),
            damage_variance: Number(variance.toFixed(2)),
            damage_dealt: damage,
            intended_status_effect: component.intended_status_effect,
            stamina_cost: component.stamina_cost
          });

          return sum + damage;
        }, 0);
        nextEnemyHp = Math.max(0, state.enemy_hp - playerDamage);
      }

      if (nextEnemyHp > 0) {
        const activeAfterAttack = remainingMembers.length ? remainingMembers : activeMembers;
        const groupAttack = activeAfterAttack.length
          ? activeAfterAttack.reduce((sum, member) => sum + Number(member.attack || 0), 0)
          : enemy.scaled_attack * Math.max(1, state.enemy_count);
        const impairmentPenalty = statusEffectsApplied.reduce((sum, status) => (
          ["blind", "stagger", "break_limb", "disarm", "knockdown", "pin"].includes(status.key) ? sum + 2 : sum
        ), 0);
        const interruptionPenalty = chainResolution?.interrupted ? 0 : impairmentPenalty;

        enemyDamage = Math.max(0, groupAttack - getPlayerDamageMitigation(player) - interruptionPenalty);
      }

      if (nextEnemyHp <= 0) {
        defeatedEnemy = enemy;
        const expGained = enemy.scaled_xp * Math.max(1, state.enemy_count);
        nextExp += expGained;
        eventFeedback.combat = {
          player_attempt: actionInput,
          target_member: targetMember,
          damage_instances: damageInstances,
          status_effects_applied: statusEffectsApplied,
          stamina_cost: chainResolution?.staminaSpent || actionInterpretation.stamina_cost,
          combo_potential: actionInterpretation.combo_potential,
          chain_resolution: {
            successful_steps: chainResolution?.successfulSteps || damageInstances.filter((hit) => hit.landed).length,
            attempted_steps: combatComponents.length,
            interrupted: chainResolution?.interrupted || false,
            interruption_step: chainResolution?.interruptionStep || null,
            interruption_reason: chainResolution?.interruptionReason || null
          },
          combat_identity: {
            family: actionInterpretation.combat_family,
            style: actionInterpretation.combat_style,
            posture: actionInterpretation.combat_posture,
            emotion: actionInterpretation.emotional_combat_state,
            weapon_usage: actionInterpretation.weapon_usage,
            status_attempts: actionInterpretation.status_attempts,
            mastery_tags: actionInterpretation.adaptive_mastery_tags,
            skill_hooks: actionInterpretation.procedural_skill_hooks
          },
          positional_advantage: statusEffectsApplied.some((status) => ["blind", "stagger", "knockdown", "pin"].includes(status.key)),
          player_chain_interrupted: chainResolution?.interrupted || false,
          interrupted_enemy_action: true,
          player_damage_dealt: playerDamage,
          enemy_damage_dealt: 0,
          remaining_enemy_count: 0,
          defeated: true,
          exp_gained: expGained
        };

        const levelUps = [];
        while (nextExp >= getRequiredExp(nextLevel)) {
          const requiredExp = getRequiredExp(nextLevel);
          nextExp -= requiredExp;
          nextLevel += 1;
          nextStatPoints += 3;
          const previousMaxHp = nextMaxHp;
          nextMaxHp = getMaxHpForStats(nextLevel, player.stamina_stat);
          nextHp = Math.min(nextMaxHp, nextHp + Math.max(0, nextMaxHp - previousMaxHp));
          levelUps.push({
            level: nextLevel,
            required_exp: requiredExp,
            stat_points_gained: 3,
            max_hp: nextMaxHp
          });
        }
        if (levelUps.length) {
          eventFeedback.level_up = levelUps[levelUps.length - 1];
          eventFeedback.level_ups = levelUps;
        }
      } else {
        nextHp = Math.max(0, player.hp - enemyDamage);
        eventFeedback.combat = {
          player_attempt: actionInput,
          target_member: targetMember,
          enemy_reaction_code: "counterattack",
          damage_instances: damageInstances,
          status_effects_applied: statusEffectsApplied,
          stamina_cost: chainResolution?.staminaSpent || actionInterpretation.stamina_cost,
          combo_potential: actionInterpretation.combo_potential,
          chain_resolution: {
            successful_steps: chainResolution?.successfulSteps || damageInstances.filter((hit) => hit.landed).length,
            attempted_steps: combatComponents.length,
            interrupted: chainResolution?.interrupted || false,
            interruption_step: chainResolution?.interruptionStep || null,
            interruption_reason: chainResolution?.interruptionReason || null
          },
          combat_identity: {
            family: actionInterpretation.combat_family,
            style: actionInterpretation.combat_style,
            posture: actionInterpretation.combat_posture,
            emotion: actionInterpretation.emotional_combat_state,
            weapon_usage: actionInterpretation.weapon_usage,
            status_attempts: actionInterpretation.status_attempts,
            mastery_tags: actionInterpretation.adaptive_mastery_tags,
            skill_hooks: actionInterpretation.procedural_skill_hooks
          },
          positional_advantage: statusEffectsApplied.some((status) => ["blind", "stagger", "knockdown", "pin"].includes(status.key)),
          player_chain_interrupted: chainResolution?.interrupted || false,
          interrupted_enemy_action: statusEffectsApplied.some((status) => ["blind", "stagger", "break_limb", "disarm", "knockdown", "pin"].includes(status.key)),
          player_damage_dealt: playerDamage,
          enemy_damage_dealt: enemyDamage,
          remaining_enemy_count: nextEnemyCount,
          defeated: false
        };
      }
    } else if (mechanicKey === "move") {
      if (state.enemy_hp > 0) {
        const enemyDamage = enemy ? Math.max(1, enemy.scaled_attack - Math.floor(Number(player.dexterity_stat || 1) * 0.65)) : 0;
        nextHp = Math.max(0, player.hp - enemyDamage);
        eventFeedback.world_reaction = {
          code: "blocked_by_active_enemy",
          blocked: true,
          ai_world_directive: aiWorldDirective
        };
        eventFeedback.combat = {
          player_attempt: actionInput,
          enemy_reaction_code: "opportunity_attack",
          player_damage_dealt: 0,
          enemy_damage_dealt: enemyDamage,
          defeated: false
        };
      } else if (aiWorldDirective.route_result.movement === "blocked" || aiWorldDirective.outcome_key === "blocked") {
        eventFeedback.world_reaction = {
          code: "route_blocked",
          blocked: true,
          ai_world_directive: aiWorldDirective
        };
      } else if (aiWorldDirective.route_result.movement === "stay" || aiWorldDirective.outcome_key === "stay_in_area") {
        eventFeedback.world_reaction = {
          code: "area_held",
          ai_world_directive: aiWorldDirective
        };
      } else if (player.current_floor >= 10 || aiWorldDirective.route_result.movement === "gateway" || aiWorldDirective.outcome_key === "gateway_advance") {
        nextDungeonLevel = Math.min(100, nextDungeonLevel + 1);
        nextFloor = nextDungeonLevel >= 100 && player.current_floor >= 10 ? 10 : 1;
        eventFeedback.world_reaction = {
          code: "level_gateway_opened",
          next_dungeon_level: nextDungeonLevel,
          next_floor: nextFloor,
          ai_world_directive: aiWorldDirective
        };
      } else {
        nextFloor += 1;
        eventFeedback.world_reaction = {
          code: "floor_advanced",
          next_floor: nextFloor,
          ai_world_directive: aiWorldDirective
        };
      }
    } else if (mechanicKey === "rest") {
      const restState = aiWorldDirective.rest_result.state;
      const recoveryMultiplier = restState === "interrupted"
        ? 0
        : restState === "uneasy"
          ? 0.5
          : 1;
      const recovery = Math.floor(Math.max(4, player.stamina_stat * 2) * recoveryMultiplier);
      nextHp = Math.min(nextMaxHp, player.hp + recovery);
      eventFeedback.recovery = {
        hp_recovered: nextHp - player.hp,
        recovery_complete: nextHp === nextMaxHp,
        interrupted: restState === "interrupted",
        rest_state: restState,
        ai_world_directive: aiWorldDirective
      };
      eventFeedback.world_reaction = {
        code: restState === "interrupted" ? "rest_interrupted" : restState === "uneasy" ? "rest_uneasy" : "rest_safe",
        ai_world_directive: aiWorldDirective
      };
    } else if (mechanicKey === "defend") {
      if (enemy && state.enemy_hp > 0) {
        const enemyDamage = Math.max(0, Math.floor(enemy.scaled_attack / 2) - getPlayerDamageMitigation(player));
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
        threat_present: !!(enemy && state.enemy_hp > 0),
        stealth_state: aiWorldDirective.stealth_result.state,
        ai_world_directive: aiWorldDirective
      };
    } else if (mechanicKey === "appraise" || mechanicKey === "look" || mechanicKey === "typed") {
      eventFeedback.world_reaction = {
        code: aiWorldDirective.discovery.found ? "discovery" : aiWorldDirective.outcome_key === "world_pressure" ? "world_pressure" : "observation",
        source_action_key: actionKey,
        source_mechanic_key: mechanicKey,
        discovery: aiWorldDirective.discovery,
        ai_world_directive: aiWorldDirective
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
        max_hp = ?,
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
        nextMaxHp,
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
        aiWorldDirective.memory_summary || actionInterpretation.intent || actionInput,
        defeatedEnemy ? 3 : 1,
        JSON.stringify({
          action_key: actionKey,
          mechanic_key: mechanicKey,
          player_action: actionInput,
          interpretation: actionInterpretation,
          ai_world_directive: aiWorldDirective,
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
        intent: actionKey,
        input: actionInput,
        mechanic_key: mechanicKey,
        combat_family: actionInterpretation.combat_family,
        combat_style: actionInterpretation.combat_style,
        tactical_intent: actionInterpretation.tactical_intent,
        combat_posture: actionInterpretation.combat_posture,
        adaptive_mastery_tags: actionInterpretation.adaptive_mastery_tags,
        procedural_skill_hooks: actionInterpretation.procedural_skill_hooks,
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
      max_hp: nextMaxHp,
      is_alive: nextAlive,
      year_survived: time.year,
      day_survived: time.day,
      current_hour: time.hour
    };
    const nextFloorData = await loadFloor(pool, nextPlayer);
    const nextSpawnEnemy = nextFloorData ? await loadSpawnEnemy(pool, nextFloorData) : null;
    const nextState = nextFloorData ? await loadOrCreateFloorState(pool, nextPlayer, nextFloorData, nextSpawnEnemy) : state;
    const nextEnemy = nextFloorData ? await loadEnemyForState(pool, nextFloorData, nextState, nextSpawnEnemy) : enemy;
    const response = await buildResponse(pool, nextPlayer, nextFloorData || floor, nextEnemy || enemy, nextState, {
      ...eventFeedback,
      skill_progression: skillProgression
    });
    const responseFeedback = {
      ...eventFeedback,
      skill_progression: skillProgression,
      scene_snapshot: response.scene
    };
    if (nextState?.player_id && nextState?.dungeon_floor_id) {
      await pool.query(
        `UPDATE player_floor_states
         SET last_event_json = ?
         WHERE player_id = ? AND dungeon_floor_id = ?`,
        [JSON.stringify(responseFeedback), nextState.player_id, nextState.dungeon_floor_id]
      );
    }
    await saveStoryEvent(pool, {
      player: nextPlayer,
      floor: nextFloorData || floor,
      enemy,
      response,
      eventFeedback: responseFeedback,
      actionInterpretation
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
