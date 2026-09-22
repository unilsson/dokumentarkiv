import { Router } from "express";
import { getDatabase } from "../database.js";

export const tagsRouter = Router();

type TagListRecord = {
  id: number;
  name: string;
  document_count: number;
};

tagsRouter.get("/", (_req, res) => {
  const tags = getDatabase()
    .prepare(
      `SELECT
         t.id,
         t.name,
         COUNT(dt.document_id) AS document_count
       FROM tags t
       LEFT JOIN document_tags dt ON dt.tag_id = t.id
       GROUP BY t.id, t.name
       HAVING COUNT(dt.document_id) > 0
       ORDER BY t.name COLLATE NOCASE`,
    )
    .all() as TagListRecord[];

  res.json({
    tags: tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      documentCount: Number(tag.document_count),
    })),
  });
});
