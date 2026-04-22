const router = require("express").Router();
const pool = require("../config/db");
const authenticateToken = require("../middleware/authMiddleware");
const { getTimeOfDay } = require("../services/timeEngine");
const {
  ensurePlayerConditionStats,
  getPlayerConditionStats,
  getPlayerSkills
} = require("../services/skillEngine");

// api/player/profile
router.get("/profile", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const [[player]] = await pool.query(
      `SELECT
        p.id,
        p.user_id,
        p.persona,
        p.name,
        p.current_race,
        p.current_title,
        p.level,
        p.exp,
        p.stat_points,
        p.hp,
        p.max_hp,
        p.strength_stat,
        p.dexterity_stat,
        p.stamina_stat,
        p.intelligence_stat,
        p.charisma_stat,
        p.wisdom_stat,
        p.current_floor,
        p.current_area,
        p.life_number,
        p.is_alive,
        p.year_survived,
        p.day_survived,
        p.current_hour,
        u.username,
        u.email
      FROM players p
      INNER JOIN users u ON p.user_id = u.id
      WHERE p.user_id = ?
      LIMIT 1`,
      [userId]
    );

    if (!player) {
      return res.status(404).json({ message: "Player not found" });
    }

    return res.json({
      player: {
        ...player,
        time_of_day: getTimeOfDay(player.current_hour)
      }
    });
  } catch (error) {
    console.error("player profile error:", error);
    return res.status(500).json({ message: "Failed to fetch player profile" });
  }
});

// api/player/skills
router.get("/skills", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const [[player]] = await pool.query(
      `SELECT id FROM players WHERE user_id = ? LIMIT 1`,
      [userId]
    );

    if (!player) {
      return res.status(404).json({ message: "Player not found" });
    }

    await ensurePlayerConditionStats(pool, player.id);

    const skills = await getPlayerSkills(pool, player.id);
    const conditionStats = await getPlayerConditionStats(pool, player.id);

    return res.json({
      skills,
      condition_stats: conditionStats
    });
  } catch (error) {
    console.error("player skills error:", error);
    return res.status(500).json({ message: "Failed to fetch player skills" });
  }
});

// api/player/allocate-stats
router.post("/allocate-stats", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const {
    strength = 0,
    dexterity = 0,
    stamina = 0,
    intelligence = 0,
    charisma = 0,
    wisdom = 0
  } = req.body || {};

  const spendMap = {
    strength: Number(strength) || 0,
    dexterity: Number(dexterity) || 0,
    stamina: Number(stamina) || 0,
    intelligence: Number(intelligence) || 0,
    charisma: Number(charisma) || 0,
    wisdom: Number(wisdom) || 0
  };

  const values = Object.values(spendMap);

  if (values.some((v) => v < 0)) {
    return res.status(400).json({ message: "Stat allocation cannot be negative" });
  }

  if (values.some((v) => !Number.isInteger(v))) {
    return res.status(400).json({ message: "Stat allocation must be whole numbers" });
  }

  const totalSpent = values.reduce((sum, v) => sum + v, 0);

  if (totalSpent <= 0) {
    return res.status(400).json({ message: "At least one stat point must be allocated" });
  }

  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[player]] = await conn.query(
      `SELECT
        id,
        stat_points,
        hp,
        max_hp,
        strength_stat,
        dexterity_stat,
        stamina_stat,
        intelligence_stat,
        charisma_stat,
        wisdom_stat
      FROM players
      WHERE user_id = ?
      LIMIT 1`,
      [userId]
    );

    if (!player) {
      await conn.rollback();
      return res.status(404).json({ message: "Player not found" });
    }

    if (totalSpent > player.stat_points) {
      await conn.rollback();
      return res.status(400).json({ message: "Not enough stat points" });
    }

    const nextStrength = player.strength_stat + spendMap.strength;
    const nextDexterity = player.dexterity_stat + spendMap.dexterity;
    const nextStamina = player.stamina_stat + spendMap.stamina;
    const nextIntelligence = player.intelligence_stat + spendMap.intelligence;
    const nextCharisma = player.charisma_stat + spendMap.charisma;
    const nextWisdom = player.wisdom_stat + spendMap.wisdom;
    const nextStatPoints = player.stat_points - totalSpent;

    // Keep your current formula for now
    const nextMaxHp = 20 + (nextStamina * 5);

    // Keep current HP, but do not allow it to exceed new max HP
    const nextHp = Math.min(player.hp, nextMaxHp);

    await conn.query(
      `UPDATE players
       SET
         strength_stat = ?,
         dexterity_stat = ?,
         stamina_stat = ?,
         intelligence_stat = ?,
         charisma_stat = ?,
         wisdom_stat = ?,
         stat_points = ?,
         max_hp = ?,
         hp = ?
       WHERE id = ?`,
      [
        nextStrength,
        nextDexterity,
        nextStamina,
        nextIntelligence,
        nextCharisma,
        nextWisdom,
        nextStatPoints,
        nextMaxHp,
        nextHp,
        player.id
      ]
    );

    await conn.commit();

    return res.json({
      message: "Stats allocated successfully",
      spent: {
        strength: spendMap.strength,
        dexterity: spendMap.dexterity,
        stamina: spendMap.stamina,
        intelligence: spendMap.intelligence,
        charisma: spendMap.charisma,
        wisdom: spendMap.wisdom,
        total: totalSpent
      },
      player: {
        strength_stat: nextStrength,
        dexterity_stat: nextDexterity,
        stamina_stat: nextStamina,
        intelligence_stat: nextIntelligence,
        charisma_stat: nextCharisma,
        wisdom_stat: nextWisdom,
        stat_points: nextStatPoints,
        hp: nextHp,
        max_hp: nextMaxHp
      }
    });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error("allocate stats error:", error);
    return res.status(500).json({ message: "Failed to allocate stats" });
  } finally {
    if (conn) conn.release();
  }
});

// api/player/persona
router.post("/persona", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { persona } = req.body || {};

  const allowed = ["ADMIN", "TRICKSTER", "SENSEI"];

  if (!persona || !allowed.includes(persona)) {
    return res.status(400).json({
      message: "Valid persona is required"
    });
  }

  try {
    const [result] = await pool.query(
      `UPDATE players
       SET persona = ?
       WHERE user_id = ?`,
      [persona, userId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: "Player not found" });
    }

    return res.json({
      message: "Persona updated successfully",
      persona
    });
  } catch (error) {
    console.error("persona update error:", error);
    return res.status(500).json({ message: "Failed to update persona" });
  }
});

module.exports = router;
