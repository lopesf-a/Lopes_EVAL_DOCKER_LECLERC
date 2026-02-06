import express from "express";
import pg from "pg";
import fs from "fs";

const { Pool } = pg;

const app = express();
const port = process.env.PORT || 3000;

// 🔐 lecture du secret Docker
const password = fs
  .readFileSync(process.env.DB_PASSWORD_FILE, "utf8")
  .trim();

// ✅ construction CORRECTE (host = db)
const DATABASE_URL =
  `postgres://${process.env.POSTGRES_USER}:${password}` +
  `@db:5432/${process.env.POSTGRES_DB}`;

const pool = new Pool({
  connectionString: DATABASE_URL
});

app.get("/api/health", async (req, res) => {
  try {
    const r = await pool.query("SELECT 1 as ok");
    res.json({ status: "ok", db: r.rows[0].ok });
  } catch (e) {
    console.error(e);
    res.status(500).json({ status: "error", error: e.message });
  }
});

app.get("/api/message", async (req, res) => {
  res.json({ message: "Hello from API" });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`API listening on port ${port}`);
  console.log(`DATABASE_URL=${DATABASE_URL}`);
});
