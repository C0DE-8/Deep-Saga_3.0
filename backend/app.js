const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const rpgRoutes = require("./routes/rpg");


const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "Deep Saga 3.0 backend is running" });
});

app.use("/api/auth", authRoutes);
app.use("/api/rpg", rpgRoutes);



module.exports = app;
