const router = require("express").Router();
const pool = require("../config/db");
const authenticateToken = require("../middleware/authMiddleware");
const { generateAiText, getConfiguredProvider } = require("../config/ai");
const { buildMonsterRpgNarrationPrompt } = require("../config/prompts");
const {
  applyAction,
  createStartState,
  makeScene,
  serializeRun,
  toDbPayload
} = require("../services/monsterRpgEngine");

async function loadRun(conn, userId) {
  const [[run]] = await conn.query(
    `SELECT *
     FROM rpg_reincarnations
     WHERE user_id = ?
     ORDER BY
       CASE difficulty
         WHEN 'medium' THEN 0
         ELSE 1
       END,
       id ASC
     LIMIT 1`,
    [userId]
  );

  return run || null;
}

async function loadUser(conn, userId) {
  const [[user]] = await conn.query(
    `SELECT id, username
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [userId]
  );

  return user || null;
}

function stateResponse(run, event = null) {
  const character = serializeRun(run);
  return {
    character,
    scene: makeScene(character, event)
  };
}

function parseAiJson(raw) {
  if (!raw) return null;
  const cleaned = String(raw)
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;

    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function normalizeAiChoice(choice, index) {
  const fallbackKey = `ai_choice_${index + 1}`;

  if (typeof choice === "string") {
    return {
      key: fallbackKey,
      label: choice.trim(),
      detail: ""
    };
  }

  if (!choice || typeof choice !== "object") return null;

  const label = String(choice.label || choice.text || choice.action || "").trim();
  if (!label) return null;

  return {
    key: String(choice.key || fallbackKey),
    label,
    detail: String(choice.detail || choice.description || "").trim()
  };
}

function compactRpgContext(state) {
  return {
    character: {
      name: state.name,
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
      deaths: state.death_count,
      reincarnations: state.reincarnation_count,
      stats: state.stats,
      derived: state.derived,
      active_skills: state.active_skills,
      passive_skills: state.passive_skills,
      traits: state.traits,
      titles: state.titles,
      status_effects: state.status_effects,
      inventory: state.inventory,
      quests: state.quests,
      evolution_progress: state.evolution_progress
    },
    world: {
      area_key: state.area_key,
      current_floor: state.current_floor,
      reputation: state.reputation,
      relationships: state.relationships,
      achievements: state.achievements,
      world_flags: state.world_flags
    }
  };
}

async function narrateResolvedEvent(state, actionText, event) {
  if (!getConfiguredProvider()) return event;

  try {
    const prompt = buildMonsterRpgNarrationPrompt({
      context: compactRpgContext(state),
      action: actionText,
      resolution: event
    });
    const raw = await generateAiText(prompt);
    const parsed = parseAiJson(raw);
    const narration = String(parsed?.narration || "").trim();
    const choices = Array.isArray(parsed?.choices)
      ? parsed.choices.map(normalizeAiChoice).filter(Boolean).slice(0, 4)
      : [];

    return {
      ...event,
      text: narration || event.text,
      choices: choices.length > 0 ? choices : event.choices
    };
  } catch (error) {
    console.warn("rpg ai narration fallback:", error.message);
    return event;
  }
}

router.get("/state", authenticateToken, async (req, res) => {
  let conn;

  try {
    conn = await pool.getConnection();
    const run = await loadRun(conn, req.user.userId);
    if (!run) {
      return res.status(404).json({ message: "No reincarnation exists yet" });
    }

    return res.json(stateResponse(run));
  } catch (error) {
    console.error("rpg state error:", error);
    return res.status(500).json({ message: "Failed to load RPG state" });
  } finally {
    if (conn) conn.release();
  }
});

router.post("/start", authenticateToken, async (req, res) => {
  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const existing = await loadRun(conn, req.user.userId);
    if (existing && !req.body?.restart) {
      await conn.commit();
      return res.json(stateResponse(existing));
    }

    const user = await loadUser(conn, req.user.userId);
    if (!user) {
      await conn.rollback();
      return res.status(404).json({ message: "User not found" });
    }

    if (existing && req.body?.restart) {
      await conn.query(
        `DELETE FROM rpg_reincarnations
         WHERE user_id = ?`,
        [req.user.userId]
      );
    }

    const start = createStartState();

    await conn.query(
      `INSERT INTO rpg_reincarnations (
        user_id, difficulty, name, species, evolution_stage, level, xp, xp_to_next,
        hp, max_hp, mp, max_mp, stamina, max_stamina, hunger, soul_level,
        death_count, reincarnation_count, currency, reputation, area_key, current_floor,
        scene_title, scene_text, stats_json, derived_json, skills_json,
        passive_skills_json, active_skills_json, traits_json, titles_json,
        status_effects_json, equipment_json, inventory_json, relationships_json,
        achievements_json, quests_json, evolution_json, world_flags_json, is_alive
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.userId,
        start.difficulty,
        start.name,
        start.species,
        start.evolution_stage,
        start.level,
        start.xp,
        start.xp_to_next,
        start.hp,
        start.max_hp,
        start.mp,
        start.max_mp,
        start.stamina,
        start.max_stamina,
        start.hunger,
        start.soul_level,
        start.death_count,
        start.reincarnation_count,
        start.currency,
        start.reputation,
        start.area_key,
        start.current_floor,
        start.scene_title,
        start.scene_text,
        JSON.stringify(start.stats),
        JSON.stringify(start.derived),
        JSON.stringify(start.skills),
        JSON.stringify(start.passive_skills),
        JSON.stringify(start.active_skills),
        JSON.stringify(start.traits),
        JSON.stringify(start.titles),
        JSON.stringify(start.status_effects),
        JSON.stringify(start.equipment),
        JSON.stringify(start.inventory),
        JSON.stringify(start.relationships),
        JSON.stringify(start.achievements),
        JSON.stringify(start.quests),
        JSON.stringify(start.evolution_progress),
        JSON.stringify(start.world_flags),
        start.is_alive ? 1 : 0
      ]
    );

    const run = await loadRun(conn, req.user.userId);
    await conn.commit();
    return res.status(201).json(stateResponse(run));
  } catch (error) {
    if (conn) await conn.rollback();
    console.error("rpg start error:", error);
    return res.status(500).json({ message: "Failed to start reincarnation" });
  } finally {
    if (conn) conn.release();
  }
});

router.post("/action", authenticateToken, async (req, res) => {
  const actionText = String(req.body?.action_text || req.body?.action_key || req.body?.action || "").trim();
  let conn;
  let transactionStarted = false;

  if (!actionText) {
    return res.status(400).json({ message: "Action text is required" });
  }

  try {
    conn = await pool.getConnection();

    const run = await loadRun(conn, req.user.userId);
    if (!run) {
      return res.status(404).json({ message: "Start a reincarnation before acting" });
    }

    const { state, event } = applyAction(run, actionText);
    const narratedEvent = await narrateResolvedEvent(state, actionText, event);
    const payload = toDbPayload(state, narratedEvent);

    await conn.beginTransaction();
    transactionStarted = true;

    await conn.query(
      `UPDATE rpg_reincarnations
       SET species = ?,
           evolution_stage = ?,
           level = ?,
           xp = ?,
           xp_to_next = ?,
           hp = ?,
           max_hp = ?,
           mp = ?,
           max_mp = ?,
           stamina = ?,
           max_stamina = ?,
           hunger = ?,
           soul_level = ?,
           death_count = ?,
           reincarnation_count = ?,
           currency = ?,
           reputation = ?,
           area_key = ?,
           current_floor = ?,
           scene_title = ?,
           scene_text = ?,
           stats_json = ?,
           derived_json = ?,
           skills_json = ?,
           passive_skills_json = ?,
           active_skills_json = ?,
           traits_json = ?,
           titles_json = ?,
           status_effects_json = ?,
           equipment_json = ?,
           inventory_json = ?,
           relationships_json = ?,
           achievements_json = ?,
           quests_json = ?,
           evolution_json = ?,
           world_flags_json = ?,
           is_alive = ?
       WHERE id = ?`,
      [
        payload.species,
        payload.evolution_stage,
        payload.level,
        payload.xp,
        payload.xp_to_next,
        payload.hp,
        payload.max_hp,
        payload.mp,
        payload.max_mp,
        payload.stamina,
        payload.max_stamina,
        payload.hunger,
        payload.soul_level,
        payload.death_count,
        payload.reincarnation_count,
        payload.currency,
        payload.reputation,
        payload.area_key,
        payload.current_floor,
        payload.scene_title,
        payload.scene_text,
        payload.stats_json,
        payload.derived_json,
        payload.skills_json,
        payload.passive_skills_json,
        payload.active_skills_json,
        payload.traits_json,
        payload.titles_json,
        payload.status_effects_json,
        payload.equipment_json,
        payload.inventory_json,
        payload.relationships_json,
        payload.achievements_json,
        payload.quests_json,
        payload.evolution_json,
        payload.world_flags_json,
        payload.is_alive,
        run.id
      ]
    );

    await conn.query(
      `INSERT INTO rpg_action_log (reincarnation_id, action_key, summary, consequences_json)
       VALUES (?, ?, ?, ?)`,
      [run.id, actionText.slice(0, 100), narratedEvent.text, JSON.stringify(event.log)]
    );

    const updated = await loadRun(conn, req.user.userId);
    await conn.commit();
    transactionStarted = false;

    return res.json(stateResponse(updated, narratedEvent));
  } catch (error) {
    if (conn && transactionStarted) await conn.rollback();
    console.error("rpg action error:", error);
    return res.status(500).json({ message: "Failed to resolve RPG action" });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
