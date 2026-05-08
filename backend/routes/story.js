const router = require("express").Router();
const pool = require("../config/db");
const authenticateToken = require("../middleware/authMiddleware");

// Lists the player's Chronicle timeline with the newest story moments first.
router.get("/chronicle", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  function parseJson(value, fallback = null) {
    if (!value) return fallback;
    if (typeof value === "object") return value;

    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  try {
    const [[player]] = await pool.query(
      `SELECT id FROM players WHERE user_id = ? LIMIT 1`,
      [userId]
    );

    if (!player) {
      return res.status(404).json({ message: "Player not found" });
    }

    const [events] = await pool.query(
      `SELECT
        id,
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
        occurred_hour,
        created_at
       FROM player_story_events
       WHERE player_id = ?
       ORDER BY occurred_year DESC, occurred_day DESC, occurred_hour DESC, id DESC
       LIMIT ? OFFSET ?`,
      [player.id, limit, offset]
    );

    return res.json({
      events: events.map((event) => ({
        ...event,
        location: parseJson(event.location_json, null),
        combat: parseJson(event.combat_json, null),
        emotional_tags: parseJson(event.emotional_tags_json, []),
        identity_tags: parseJson(event.identity_tags_json, [])
      }))
    });
  } catch (error) {
    console.error("story chronicle error:", error);
    return res.status(500).json({ message: "Failed to load chronicle" });
  }
});

// Groups Chronicle events into readable story chapters.
router.get("/chapters", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const [[player]] = await pool.query(
      `SELECT id FROM players WHERE user_id = ? LIMIT 1`,
      [userId]
    );

    if (!player) {
      return res.status(404).json({ message: "Player not found" });
    }

    const [chapters] = await pool.query(
      `SELECT
        chapter_number,
        title,
        summary,
        importance,
        started_at,
        closed_at
       FROM player_story_chapters
       WHERE player_id = ?
       ORDER BY chapter_number ASC`,
      [player.id]
    );

    return res.json({ chapters });
  } catch (error) {
    console.error("story chapters error:", error);
    return res.status(500).json({ message: "Failed to load story chapters" });
  }
});

// Shows one Chronicle entry as a full archived scene.
router.get("/events/:id", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const eventId = Number(req.params.id);

  function parseJson(value, fallback = null) {
    if (!value) return fallback;
    if (typeof value === "object") return value;

    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  if (!Number.isInteger(eventId) || eventId <= 0) {
    return res.status(400).json({ message: "Valid story event id is required" });
  }

  try {
    const [[event]] = await pool.query(
      `SELECT
        pse.*
       FROM player_story_events pse
       INNER JOIN players p ON pse.player_id = p.id
       WHERE pse.id = ?
         AND p.user_id = ?
       LIMIT 1`,
      [eventId, userId]
    );

    if (!event) {
      return res.status(404).json({ message: "Story event not found" });
    }

    return res.json({
      event: {
        ...event,
        location: parseJson(event.location_json, null),
        combat: parseJson(event.combat_json, null),
        emotional_tags: parseJson(event.emotional_tags_json, []),
        identity_tags: parseJson(event.identity_tags_json, [])
      }
    });
  } catch (error) {
    console.error("story event error:", error);
    return res.status(500).json({ message: "Failed to load story event" });
  }
});

module.exports = router;
