const router = require("express").Router();
const pool = require("../config/db");
const authenticateToken = require("../middleware/authMiddleware");

router.get("/status", authenticateToken, async function getAscensionStatus(req, res) {
  try {
    const [[player]] = await pool.query(
      `SELECT current_dungeon_level, current_floor, is_alive, hp
       FROM players
       WHERE user_id = ?
       LIMIT 1`,
      [req.user.userId]
    );

    if (!player) return res.status(404).json({ message: "Player not found" });

    const awaitingFinalWish = !!player.is_alive
      && Number(player.hp || 0) > 0
      && Number(player.current_dungeon_level || 1) >= 100
      && Number(player.current_floor || 1) >= 10;

    return res.json({
      awaiting_final_wish: awaitingFinalWish,
      prompt: awaitingFinalWish
        ? "You completed 100 dungeon levels. State the final wish."
        : null
    });
  } catch (error) {
    console.error("ascension status error:", error);
    return res.status(500).json({ message: "Failed to load ascension status" });
  }
});

router.post("/wish", authenticateToken, async function submitFinalWish(req, res) {
  const wish = String(req.body?.wish || "").trim();
  if (!wish) return res.status(400).json({ message: "Wish is required" });

  try {
    const [[player]] = await pool.query(
      `SELECT id, current_dungeon_level, current_floor, is_alive, hp
       FROM players
       WHERE user_id = ?
       LIMIT 1`,
      [req.user.userId]
    );

    if (!player) return res.status(404).json({ message: "Player not found" });
    if (!player.is_alive || Number(player.hp || 0) <= 0) {
      return res.status(400).json({ message: "Final wish is not available after death. Use rebirth." });
    }
    if (Number(player.current_dungeon_level || 1) < 100 || Number(player.current_floor || 1) < 10) {
      return res.status(403).json({ message: "Complete all 100 dungeon levels before using a wish" });
    }

    await pool.query(
      `INSERT INTO player_memories (player_id, memory_type, summary, importance, metadata_json)
       VALUES (?, ?, ?, ?, ?)`,
      [
        player.id,
        "final_wish",
        wish.slice(0, 240),
        5,
        JSON.stringify({ wish: wish.slice(0, 1000) })
      ]
    );

    return res.json({
      message: "final_wish_recorded",
      narration: `The final wish is recorded: ${wish.slice(0, 240)}`,
      world_state: {
        region_name: "World Beyond the Dungeon",
        phase: "ascended"
      },
      choices: ["Enter World Mode"]
    });
  } catch (error) {
    console.error("ascension wish error:", error);
    return res.status(500).json({ message: "Failed to record final wish" });
  }
});

module.exports = router;
