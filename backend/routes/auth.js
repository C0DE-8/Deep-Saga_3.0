const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");

function signAuthToken(user) {
  const role = user.role || "player";

  return jwt.sign(
    {
      userId: user.id,
      username: user.username,
      email: user.email,
      role
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function serializeUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role || "player"
  };
}

// api/auth/register
router.post("/register", async (req, res) => {
  const { username, email, password } = req.body || {};

  if (!username || !email || !password) {
    return res.status(400).json({
      message: "username, email, and password are required"
    });
  }

  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[existingUsername]] = await conn.query(
      "SELECT id FROM users WHERE username = ? LIMIT 1",
      [username]
    );

    if (existingUsername) {
      await conn.rollback();
      return res.status(400).json({ message: "Username already exists" });
    }

    const [[existingEmail]] = await conn.query(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [email]
    );

    if (existingEmail) {
      await conn.rollback();
      return res.status(400).json({ message: "Email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [userResult] = await conn.query(
      `INSERT INTO users (username, email, password)
       VALUES (?, ?, ?)`,
      [username, email, hashedPassword]
    );

    const userId = userResult.insertId;

    await conn.commit();

    const user = {
      id: userId,
      username,
      email,
      role: "player"
    };

    const token = signAuthToken(user);

    return res.status(201).json({
      message: "Register successful",
      token,
      user: serializeUser(user)
    });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error("register error:", error);
    return res.status(500).json({ message: "Registration failed" });
  } finally {
    if (conn) conn.release();
  }
});

// api/auth/login
router.post("/login", async (req, res) => {
  const { identifier, email, username, password } = req.body || {};
  const loginIdentifier = String(identifier || email || username || "").trim();

  if (!loginIdentifier || !password) {
    return res.status(400).json({
      message: "identifier and password are required"
    });
  }

  try {
    const [[user]] = await pool.query(
      `SELECT id, username, email, password
       FROM users
       WHERE email = ? OR username = ?
       LIMIT 1`,
      [loginIdentifier, loginIdentifier]
    );

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const authUser = {
      ...user,
      role: "player"
    };

    const token = signAuthToken(authUser);

    return res.json({
      message: "Login successful",
      token,
      user: serializeUser(authUser)
    });
  } catch (error) {
    console.error("login error:", error);
    return res.status(500).json({ message: "Login failed" });
  }
});

module.exports = router;
