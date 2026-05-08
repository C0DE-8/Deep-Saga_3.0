const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const playerRoutes = require("./routes/player");
const playRoutes = require("./routes/play");
const storyRoutes = require("./routes/story");


const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "Deep Saga 3.0 backend is running" });
});

app.use("/api/auth", authRoutes);
app.use("/api/player", playerRoutes);
app.use("/api/play", playRoutes);
app.use("/api/game", playRoutes);
app.use("/api/action", playRoutes);
app.use("/api/story", storyRoutes);



module.exports = app;
