import { Router } from "express";
import { getDatabase } from "../database.js";

export const categoriesRouter = Router();

categoriesRouter.get("/", (_req, res) => {
  const categories = getDatabase()
    .prepare("SELECT id, name FROM categories ORDER BY name COLLATE NOCASE")
    .all();

  res.json({ categories });
});
