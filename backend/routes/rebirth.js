const router = require("express").Router();
const pool = require("../config/db");
const GAME_CONFIG = require("../config/gameConfig");
const authenticateToken = require("../middleware/authMiddleware");

function completedOneHundredLevels(player) {
  return Number(player?.current_dungeon_level || 1) >= 100;
}

async function loadPlayer(conn, userId) {
  const [[player]] = await conn.query(
    `SELECT *
     FROM players
     WHERE user_id = ?
     LIMIT 1`,
    [userId]
  );

  return player || null;
}

async function loadStartArea(conn) {
  const [[floor]] = await conn.query(
    `SELECT df.name
     FROM dungeon_floors df
     INNER JOIN dungeon_levels dl ON df.level_id = dl.id
     WHERE dl.level_number = 1 AND df.floor_number = 1
     LIMIT 1`
  );

  return floor?.name || GAME_CONFIG.START_AREA;
}

async function resetLife(conn, player, recap, wish = null) {
  const startArea = await loadStartArea(conn);
  const nextLifeNumber = Number(player.life_number || 1) + 1;

  await conn.query(
    `UPDATE player_encounters
     SET is_resolved = 1, resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP)
     WHERE player_id = ?`,
    [player.id]
  );

  await conn.query(
    `DELETE FROM player_floor_states
     WHERE player_id = ?`,
    [player.id]
  );

  await conn.query(
    `UPDATE players
     SET current_dungeon_level = 1,
         current_floor = ?,
         current_area = ?,
         level = ?,
         exp = ?,
         stat_points = ?,
         hp = ?,
         max_hp = ?,
         strength_stat = ?,
         dexterity_stat = ?,
         stamina_stat = ?,
         intelligence_stat = ?,
         charisma_stat = ?,
         wisdom_stat = ?,
         life_number = life_number + 1,
         is_alive = 1,
         year_survived = ?,
         day_survived = ?,
         current_hour = ?
     WHERE id = ?`,
    [
      GAME_CONFIG.START_FLOOR,
      startArea,
      GAME_CONFIG.START_LEVEL,
      GAME_CONFIG.START_EXP,
      GAME_CONFIG.START_STAT_POINTS,
      GAME_CONFIG.START_HP,
      GAME_CONFIG.START_MAX_HP,
      GAME_CONFIG.START_STRENGTH,
      GAME_CONFIG.START_DEXTERITY,
      GAME_CONFIG.START_STAMINA,
      GAME_CONFIG.START_INTELLIGENCE,
      GAME_CONFIG.START_CHARISMA,
      GAME_CONFIG.START_WISDOM,
      GAME_CONFIG.START_YEAR,
      GAME_CONFIG.START_DAY,
      GAME_CONFIG.START_HOUR,
      player.id
    ]
  );

  await conn.query(
    `INSERT INTO player_memories (player_id, memory_type, summary, importance, metadata_json)
     VALUES (?, ?, ?, ?, ?)`,
    [
      player.id,
      "rebirth_recap",
      recap,
      5,
      JSON.stringify({
        previous_life: player.life_number,
        previous_level: player.current_dungeon_level,
        previous_floor: player.current_floor,
        death_area: player.current_area,
        wish
      })
    ]
  );

  await conn.query(
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
      "reincarnation",
      1,
      `Book ${nextLifeNumber}: Rebirth`,
      `Life ${player.life_number} ended. Life ${nextLifeNumber} begins in ${startArea}.`,
      recap,
      JSON.stringify({
        level: 1,
        floor: GAME_CONFIG.START_FLOOR,
        area: startArea,
        previous_area: player.current_area || null
      }),
      JSON.stringify({
        previous_life: player.life_number,
        new_life: nextLifeNumber,
        wish
      }),
      JSON.stringify(["death", "rebirth"]),
      JSON.stringify(["reincarnation"]),
      5,
      1,
      GAME_CONFIG.START_YEAR,
      GAME_CONFIG.START_DAY,
      GAME_CONFIG.START_HOUR
    ]
  );

  return {
    current_floor: GAME_CONFIG.START_FLOOR,
    current_area: startArea,
    life_number: nextLifeNumber
  };
}

router.get("/status", authenticateToken, async function getRebirthStatus(req, res) {
  let conn;

  try {
    conn = await pool.getConnection();
    const player = await loadPlayer(conn, req.user.userId);
    if (!player) return res.status(404).json({ message: "Player not found" });

    return res.json({
      is_alive: !!player.is_alive && Number(player.hp || 0) > 0,
      can_rebirth: !player.is_alive || Number(player.hp || 0) <= 0,
      can_rebirth_wish: completedOneHundredLevels(player),
      wish_requirement: "Complete dungeon level 100 to use a rebirth wish.",
      life_number: player.life_number,
      death_area: player.current_area
    });
  } catch (error) {
    console.error("rebirth status error:", error);
    return res.status(500).json({ message: "Failed to load rebirth status" });
  } finally {
    if (conn) conn.release();
  }
});

router.post("/restart", authenticateToken, async function restartRebirth(req, res) {
  let conn;

  try {
    conn = await pool.getConnection();
    const player = await loadPlayer(conn, req.user.userId);
    if (!player) return res.status(404).json({ message: "Player not found" });
    if (player.is_alive && Number(player.hp || 0) > 0) {
      return res.status(400).json({ message: "Rebirth is only available after death" });
    }

    await conn.beginTransaction();
    const recap = `Life ${player.life_number} ended in ${player.current_area || "the dungeon"}. The next life opens with the dungeon aware that the player has already died once.`;
    const start = await resetLife(conn, player, recap);
    await conn.commit();

    return res.json({
      message: "reborn_after_death",
      recap,
      player: {
        is_alive: 1,
        hp: GAME_CONFIG.START_HP,
        max_hp: GAME_CONFIG.START_MAX_HP,
        current_dungeon_level: 1,
        current_floor: start.current_floor,
        current_area: start.current_area,
        life_number: start.life_number
      }
    });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error("rebirth restart error:", error);
    return res.status(500).json({ message: "Failed to rebirth" });
  } finally {
    if (conn) conn.release();
  }
});

router.post("/wish", authenticateToken, async function submitRebirthWish(req, res) {
  const wish = String(req.body?.wish || "").trim();
  if (!wish) return res.status(400).json({ message: "Wish is required" });

  let conn;

  try {
    conn = await pool.getConnection();
    const player = await loadPlayer(conn, req.user.userId);
    if (!player) return res.status(404).json({ message: "Player not found" });
    if (player.is_alive && Number(player.hp || 0) > 0) {
      return res.status(400).json({ message: "Rebirth wishes are only available after death" });
    }
    if (!completedOneHundredLevels(player)) {
      return res.status(403).json({ message: "Complete dungeon level 100 before using a rebirth wish" });
    }

    await conn.beginTransaction();
    const recap = `Life ${player.life_number} ended in ${player.current_area || "the dungeon"}. The rebirth wish was recorded: ${wish.slice(0, 240)}. The AI should remember the death and open the next life with a direct recap.`;
    const start = await resetLife(conn, player, recap, wish.slice(0, 240));
    await conn.commit();

    return res.json({
      message: "reborn_after_death",
      recap,
      player: {
        is_alive: 1,
        hp: GAME_CONFIG.START_HP,
        max_hp: GAME_CONFIG.START_MAX_HP,
        current_dungeon_level: 1,
        current_floor: start.current_floor,
        current_area: start.current_area,
        life_number: start.life_number
      }
    });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error("rebirth wish error:", error);
    return res.status(500).json({ message: "Failed to apply rebirth wish" });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
