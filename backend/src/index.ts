import express from "express";
import { config } from "./config.js";
import { getDatabase } from "./database.js";

getDatabase();

const app = express();

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "dokumentarkiv-backend",
    database: "ready",
  });
});

app.listen(config.port, () => {
  console.log(`Dokumentarkiv backend listening on http://localhost:${config.port}`);
});
