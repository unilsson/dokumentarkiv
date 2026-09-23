import { randomUUID } from "node:crypto";
import path from "node:path";
import { rename, unlink } from "node:fs/promises";
import { Router } from "express";
import { config } from "../config.js";
import { getDatabase } from "../database.js";
import { enqueueOcr } from "../ocr.js";
import {
  documentUpload,
  extensionForMimeType,
  hasValidFileSignature,
  normalizeMimeType,
  sha256File,
} from "../upload.js";

export const documentsRouter = Router();

type ExistingDocument = {
  id: number;
  title: string;
  original_filename: string;
};

type DocumentFileRecord = {
  id: number;
  original_filename: string;
  stored_filename: string;
  mime_type: string;
};

type TagRecord = {
  id: number;
  name: string;
};

type DocumentRecord = {
  id: number;
  title: string;
  original_filename: string;
  stored_filename: string;
  mime_type: string;
  document_date: string | null;
  description: string | null;
  paid_at: string | null;
  sha256: string;
  created_at: string;
  updated_at: string;
  category_id: number | null;
  category_name: string | null;
};

function textField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function tagsForDocument(documentId: number): TagRecord[] {
  return getDatabase()
    .prepare(
      `SELECT t.id, t.name
       FROM tags t
       JOIN document_tags dt ON dt.tag_id = t.id
       WHERE dt.document_id = ?
       ORDER BY t.name COLLATE NOCASE`,
    )
    .all(documentId) as TagRecord[];
}

function parseTagNames(value: unknown): string[] | null {
  let rawTags: string[];

  if (value === undefined || value === null || value === "") {
    rawTags = [];
  } else if (Array.isArray(value)) {
    if (!value.every((item) => typeof item === "string")) {
      return null;
    }
    rawTags = value as string[];
  } else if (typeof value === "string") {
    rawTags = value.split(",");
  } else {
    return null;
  }

  const tags: string[] = [];
  const seen = new Set<string>();

  for (const rawTag of rawTags) {
    const tag = rawTag.trim().replace(/\s+/g, " ");

    if (!tag) {
      continue;
    }

    if (tag.length > 50) {
      return null;
    }

    const key = tag.toLocaleLowerCase("sv-SE");

    if (!seen.has(key)) {
      seen.add(key);
      tags.push(tag);
    }
  }

  return tags.length <= 20 ? tags : null;
}

function replaceDocumentTags(documentId: number, tagNames: string[]): void {
  const database = getDatabase();
  const findTag = database.prepare(
    "SELECT id, name FROM tags WHERE name = ? COLLATE NOCASE LIMIT 1",
  );
  const insertTag = database.prepare("INSERT INTO tags (name) VALUES (?)");
  const linkTag = database.prepare(
    "INSERT OR IGNORE INTO document_tags (document_id, tag_id) VALUES (?, ?)",
  );

  database
    .prepare("DELETE FROM document_tags WHERE document_id = ?")
    .run(documentId);

  for (const tagName of tagNames) {
    let tag = findTag.get(tagName) as TagRecord | undefined;

    if (!tag) {
      const result = insertTag.run(tagName);
      tag = { id: Number(result.lastInsertRowid), name: tagName };
    }

    linkTag.run(documentId, tag.id);
  }

  database.exec(
    `DELETE FROM tags
     WHERE NOT EXISTS (
       SELECT 1 FROM document_tags dt WHERE dt.tag_id = tags.id
     )`,
  );
}

function documentJson(document: DocumentRecord) {
  return {
    id: document.id,
    title: document.title,
    originalFilename: document.original_filename,
    mimeType: document.mime_type,
    documentDate: document.document_date,
    description: document.description,
    paid: document.paid_at !== null,
    paidAt: document.paid_at,
    sha256: document.sha256,
    createdAt: document.created_at,
    updatedAt: document.updated_at,
    category: document.category_id
      ? {
          id: document.category_id,
          name: document.category_name,
        }
      : null,
    tags: tagsForDocument(document.id),
  };
}

async function safeUnlink(filePath: string | undefined): Promise<void> {
  if (!filePath) {
    return;
  }

  try {
    await unlink(filePath);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";

    if (code !== "ENOENT") {
      throw error;
    }
  }
}

function safeOriginalFilename(filename: string): string {
  return filename.replace(/^.*[\\/]/, "").slice(0, 255) || "document";
}

function documentId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function getDocumentFile(id: number): DocumentFileRecord | undefined {
  return getDatabase()
    .prepare(
      "SELECT id, original_filename, stored_filename, mime_type FROM documents WHERE id = ?",
    )
    .get(id) as DocumentFileRecord | undefined;
}

function storedDocumentPath(storedFilename: string): string | null {
  if (path.basename(storedFilename) !== storedFilename) {
    return null;
  }

  const documentsRoot = path.resolve(config.documentsDir);
  const filePath = path.resolve(documentsRoot, storedFilename);

  if (!filePath.startsWith(documentsRoot + path.sep)) {
    return null;
  }

  return filePath;
}

const documentSelect = `
  SELECT
    d.id,
    d.title,
    d.original_filename,
    d.stored_filename,
    d.mime_type,
    d.document_date,
    d.description,
    d.paid_at,
    d.sha256,
    d.created_at,
    d.updated_at,
    c.id AS category_id,
    c.name AS category_name
  FROM documents d
  LEFT JOIN categories c ON c.id = d.category_id
`;

documentsRouter.get("/", (req, res) => {
  const query = textField(req.query.q);
  const categoryIdText = textField(req.query.categoryId);
  const tagIdText = textField(req.query.tagId);
  const paymentStatus = textField(req.query.paymentStatus);
  const conditions: string[] = [];
  const parameters: Array<string | number> = [];

  if (query) {
    const search = `%${query}%`;
    conditions.push(
      `(
        d.title LIKE ? COLLATE NOCASE
        OR d.description LIKE ? COLLATE NOCASE
        OR d.original_filename LIKE ? COLLATE NOCASE
        OR d.ocr_text LIKE ? COLLATE NOCASE
        OR EXISTS (
          SELECT 1
          FROM document_tags dt
          JOIN tags t ON t.id = dt.tag_id
          WHERE dt.document_id = d.id
            AND t.name LIKE ? COLLATE NOCASE
        )
      )`,
    );
    parameters.push(search, search, search, search, search);
  }

  if (categoryIdText) {
    const categoryId = Number(categoryIdText);

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      res.status(400).json({
        error: "invalid_category",
        message: "Ogiltigt kategorifilter.",
      });
      return;
    }

    conditions.push("d.category_id = ?");
    parameters.push(categoryId);
  }

  if (paymentStatus) {
    if (paymentStatus !== "paid" && paymentStatus !== "unpaid") {
      res.status(400).json({
        error: "invalid_payment_status",
        message: "Ogiltigt betalstatusfilter.",
      });
      return;
    }

    conditions.push(
      paymentStatus === "paid"
        ? "(c.name = 'Räkningar' AND d.paid_at IS NOT NULL)"
        : "(c.name = 'Räkningar' AND d.paid_at IS NULL)",
    );
  }

  if (tagIdText) {
    const tagId = Number(tagIdText);

    if (!Number.isInteger(tagId) || tagId <= 0) {
      res.status(400).json({
        error: "invalid_tag",
        message: "Ogiltigt taggfilter.",
      });
      return;
    }

    conditions.push(
      `EXISTS (
        SELECT 1
        FROM document_tags dt
        WHERE dt.document_id = d.id AND dt.tag_id = ?
      )`,
    );
    parameters.push(tagId);
  }

  const where =
    conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";

  const documents = getDatabase()
    .prepare(
      `${documentSelect}
       ${where}
       ORDER BY COALESCE(d.document_date, d.created_at) DESC, d.created_at DESC`,
    )
    .all(...parameters) as DocumentRecord[];

  res.json({
    documents: documents.map(documentJson),
    count: documents.length,
  });
});

documentsRouter.get("/:id/content", (req, res) => {
  const id = documentId(req.params.id);

  if (!id) {
    res.status(400).json({
      error: "invalid_document_id",
      message: "Ogiltigt dokument-id.",
    });
    return;
  }

  const document = getDocumentFile(id);

  if (!document) {
    res.status(404).json({
      error: "document_not_found",
      message: "Dokumentet finns inte.",
    });
    return;
  }

  const filePath = storedDocumentPath(document.stored_filename);

  if (!filePath) {
    res.status(500).json({
      error: "invalid_stored_filename",
      message: "Dokumentets lagrade filnamn är ogiltigt.",
    });
    return;
  }

  res.setHeader("Content-Type", document.mime_type);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(document.original_filename)}`,
  );

  res.sendFile(filePath, (error) => {
    if (!error || res.headersSent) {
      return;
    }

    const status =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      Number(error.statusCode) === 404
        ? 404
        : 500;

    res.status(status).json({
      error: status === 404 ? "document_file_not_found" : "file_delivery_error",
      message:
        status === 404
          ? "Dokumentfilen saknas på disken."
          : "Dokumentfilen kunde inte öppnas.",
    });
  });
});

documentsRouter.get("/:id/download", (req, res) => {
  const id = documentId(req.params.id);

  if (!id) {
    res.status(400).json({
      error: "invalid_document_id",
      message: "Ogiltigt dokument-id.",
    });
    return;
  }

  const document = getDocumentFile(id);

  if (!document) {
    res.status(404).json({
      error: "document_not_found",
      message: "Dokumentet finns inte.",
    });
    return;
  }

  const filePath = storedDocumentPath(document.stored_filename);

  if (!filePath) {
    res.status(500).json({
      error: "invalid_stored_filename",
      message: "Dokumentets lagrade filnamn är ogiltigt.",
    });
    return;
  }

  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  res.download(filePath, document.original_filename, (error) => {
    if (!error || res.headersSent) {
      return;
    }

    const status =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      Number(error.statusCode) === 404
        ? 404
        : 500;

    res.status(status).json({
      error: status === 404 ? "document_file_not_found" : "file_delivery_error",
      message:
        status === 404
          ? "Dokumentfilen saknas på disken."
          : "Dokumentfilen kunde inte hämtas.",
    });
  });
});

documentsRouter.get("/:id", (req, res) => {
  const id = documentId(req.params.id);

  if (!id) {
    res.status(400).json({
      error: "invalid_document_id",
      message: "Ogiltigt dokument-id.",
    });
    return;
  }

  const document = getDatabase()
    .prepare(`${documentSelect} WHERE d.id = ?`)
    .get(id) as DocumentRecord | undefined;

  if (!document) {
    res.status(404).json({
      error: "document_not_found",
      message: "Dokumentet finns inte.",
    });
    return;
  }

  res.json({ document: documentJson(document) });
});

documentsRouter.patch("/:id/payment", (req, res) => {
  const id = documentId(req.params.id);

  if (!id) {
    res.status(400).json({
      error: "invalid_document_id",
      message: "Ogiltigt dokument-id.",
    });
    return;
  }

  if (typeof req.body.paid !== "boolean") {
    res.status(400).json({
      error: "invalid_paid_status",
      message: "Betalstatus måste vara true eller false.",
    });
    return;
  }

  const database = getDatabase();
  const existing = database
    .prepare(`${documentSelect} WHERE d.id = ?`)
    .get(id) as DocumentRecord | undefined;

  if (!existing) {
    res.status(404).json({
      error: "document_not_found",
      message: "Dokumentet finns inte.",
    });
    return;
  }

  if (existing.category_name !== "Räkningar") {
    res.status(400).json({
      error: "not_a_bill",
      message: "Betalstatus kan bara ändras för dokument i kategorin Räkningar.",
    });
    return;
  }

  database
    .prepare(
      `UPDATE documents
       SET paid_at = CASE
         WHEN ? = 1 THEN COALESCE(paid_at, CURRENT_TIMESTAMP)
         ELSE NULL
       END,
       updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .run(req.body.paid ? 1 : 0, id);

  const document = database
    .prepare(`${documentSelect} WHERE d.id = ?`)
    .get(id) as DocumentRecord;

  res.json({ document: documentJson(document) });
});

documentsRouter.patch("/:id", (req, res) => {
  const id = documentId(req.params.id);

  if (!id) {
    res.status(400).json({
      error: "invalid_document_id",
      message: "Ogiltigt dokument-id.",
    });
    return;
  }

  const existing = getDatabase()
    .prepare("SELECT id FROM documents WHERE id = ?")
    .get(id);

  if (!existing) {
    res.status(404).json({
      error: "document_not_found",
      message: "Dokumentet finns inte.",
    });
    return;
  }

  const title = textField(req.body.title);
  const documentDate = textField(req.body.documentDate);
  const description = textField(req.body.description);
  const categoryValue = req.body.categoryId;
  const tagNames = parseTagNames(req.body.tags);

  if (tagNames === null) {
    res.status(400).json({
      error: "invalid_tags",
      message: "Ange högst 20 taggar, högst 50 tecken per tagg.",
    });
    return;
  }

  if (!title || title.length > 200) {
    res.status(400).json({
      error: "invalid_title",
      message: "Titel måste anges och får vara högst 200 tecken.",
    });
    return;
  }

  if (documentDate && !isValidDate(documentDate)) {
    res.status(400).json({
      error: "invalid_document_date",
      message: "Dokumentdatum måste vara ett giltigt datum.",
    });
    return;
  }

  if (description.length > 4000) {
    res.status(400).json({
      error: "description_too_long",
      message: "Beskrivningen får vara högst 4000 tecken.",
    });
    return;
  }

  let categoryId: number | null = null;
  let categoryName: string | null = null;

  if (categoryValue !== null && categoryValue !== undefined && categoryValue !== "") {
    categoryId =
      typeof categoryValue === "number"
        ? categoryValue
        : Number(String(categoryValue));

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      res.status(400).json({
        error: "invalid_category",
        message: "Ogiltig kategori.",
      });
      return;
    }

    const category = getDatabase()
      .prepare("SELECT id, name FROM categories WHERE id = ?")
      .get(categoryId) as { id: number; name: string } | undefined;

    if (!category) {
      res.status(400).json({
        error: "invalid_category",
        message: "Den valda kategorin finns inte.",
      });
      return;
    }

    categoryName = category.name;
  }

  const database = getDatabase();
  database.exec("BEGIN IMMEDIATE;");

  try {
    database
      .prepare(
        `UPDATE documents
         SET title = ?,
             document_date = ?,
             category_id = ?,
             description = ?,
             paid_at = CASE WHEN ? = 1 THEN paid_at ELSE NULL END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(
        title,
        documentDate || null,
        categoryId,
        description || null,
        categoryName === "Räkningar" ? 1 : 0,
        id,
      );

    replaceDocumentTags(id, tagNames);
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }

  const document = database
    .prepare(`${documentSelect} WHERE d.id = ?`)
    .get(id) as DocumentRecord;

  res.json({ document: documentJson(document) });
});

documentsRouter.delete("/:id", async (req, res) => {
  const id = documentId(req.params.id);

  if (!id) {
    res.status(400).json({
      error: "invalid_document_id",
      message: "Ogiltigt dokument-id.",
    });
    return;
  }

  const document = getDocumentFile(id);

  if (!document) {
    res.status(404).json({
      error: "document_not_found",
      message: "Dokumentet finns inte.",
    });
    return;
  }

  const filePath = storedDocumentPath(document.stored_filename);

  if (!filePath) {
    res.status(500).json({
      error: "invalid_stored_filename",
      message: "Dokumentets lagrade filnamn är ogiltigt.",
    });
    return;
  }

  const trashPath = path.join(
    config.tempDir,
    `${randomUUID()}-${path.basename(document.stored_filename)}.deleted`,
  );
  let movedToTrash = false;

  try {
    try {
      await rename(filePath, trashPath);
      movedToTrash = true;
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String(error.code)
          : "";

      if (code !== "ENOENT") {
        throw error;
      }
    }

    try {
      const database = getDatabase();
      database.exec("BEGIN IMMEDIATE;");

      try {
        database
          .prepare("DELETE FROM documents WHERE id = ?")
          .run(id);
        database.exec(
          `DELETE FROM tags
           WHERE NOT EXISTS (
             SELECT 1 FROM document_tags dt WHERE dt.tag_id = tags.id
           )`,
        );
        database.exec("COMMIT;");
      } catch (error) {
        database.exec("ROLLBACK;");
        throw error;
      }
    } catch (error) {
      if (movedToTrash) {
        try {
          await rename(trashPath, filePath);
          movedToTrash = false;
        } catch (restoreError) {
          console.error("Could not restore document after delete failure", restoreError);
        }
      }

      throw error;
    }

    if (movedToTrash) {
      try {
        await safeUnlink(trashPath);
      } catch (cleanupError) {
        console.error("Could not remove deleted document from tmp", cleanupError);
      }
    }

    res.status(204).end();
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "document_delete_failed",
      message: "Dokumentet kunde inte tas bort.",
    });
  }
});

documentsRouter.post(
  "/",
  documentUpload.single("file"),
  async (req, res) => {
    const file = req.file;

    if (!file) {
      res.status(400).json({
        error: "missing_file",
        message: "Välj en PDF-, JPG-, PNG- eller Markdown-fil att ladda upp.",
      });
      return;
    }

    let tempPath: string | undefined = file.path;
    let storedPath: string | undefined;

    try {
      const title = textField(req.body.title);
      const documentDate = textField(req.body.documentDate);
      const categoryIdText = textField(req.body.categoryId);
      const description = textField(req.body.description);
      const tagNames = parseTagNames(req.body.tags);

      if (tagNames === null) {
        res.status(400).json({
          error: "invalid_tags",
          message: "Ange högst 20 taggar, högst 50 tecken per tagg.",
        });
        return;
      }

      if (!title || title.length > 200) {
        res.status(400).json({
          error: "invalid_title",
          message: "Titel måste anges och får vara högst 200 tecken.",
        });
        return;
      }

      if (documentDate && !isValidDate(documentDate)) {
        res.status(400).json({
          error: "invalid_document_date",
          message: "Dokumentdatum måste vara ett giltigt datum.",
        });
        return;
      }

      if (description.length > 4000) {
        res.status(400).json({
          error: "description_too_long",
          message: "Beskrivningen får vara högst 4000 tecken.",
        });
        return;
      }

      let categoryId: number | null = null;

      if (categoryIdText) {
        categoryId = Number(categoryIdText);

        if (!Number.isInteger(categoryId) || categoryId <= 0) {
          res.status(400).json({
            error: "invalid_category",
            message: "Ogiltig kategori.",
          });
          return;
        }

        const category = getDatabase()
          .prepare("SELECT id FROM categories WHERE id = ?")
          .get(categoryId);

        if (!category) {
          res.status(400).json({
            error: "invalid_category",
            message: "Den valda kategorin finns inte.",
          });
          return;
        }
      }

      const mimeType = normalizeMimeType(file.mimetype, file.originalname);

      if (!(await hasValidFileSignature(file.path, mimeType))) {
        res.status(400).json({
          error: "invalid_file_content",
          message: "Filens innehåll stämmer inte med filtypen.",
        });
        return;
      }

      const sha256 = await sha256File(file.path);

      const existing = getDatabase()
        .prepare(
          "SELECT id, title, original_filename FROM documents WHERE sha256 = ? LIMIT 1",
        )
        .get(sha256) as ExistingDocument | undefined;

      if (existing) {
        res.status(409).json({
          error: "duplicate_document",
          message: "Samma fil finns redan i arkivet.",
          existingDocument: {
            id: existing.id,
            title: existing.title,
            originalFilename: existing.original_filename,
          },
        });
        return;
      }

      const storedFilename =
        randomUUID() + extensionForMimeType(mimeType);
      storedPath = path.join(config.documentsDir, storedFilename);

      await rename(file.path, storedPath);
      tempPath = undefined;

      const originalFilename = safeOriginalFilename(file.originalname);

      try {
        const database = getDatabase();
        database.exec("BEGIN IMMEDIATE;");

        let id: number;

        try {
          const result = database
            .prepare(
              `INSERT INTO documents (
                title,
                original_filename,
                stored_filename,
                mime_type,
                document_date,
                category_id,
                description,
                sha256
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              title,
              originalFilename,
              storedFilename,
              mimeType,
              documentDate || null,
              categoryId,
              description || null,
              sha256,
            );

          id = Number(result.lastInsertRowid);
          replaceDocumentTags(id, tagNames);
          database.exec("COMMIT;");
        } catch (error) {
          database.exec("ROLLBACK;");
          throw error;
        }

        const document = database
          .prepare(`${documentSelect} WHERE d.id = ?`)
          .get(id) as DocumentRecord;

        storedPath = undefined;
        enqueueOcr(id);

        res.status(201).json({ document: documentJson(document) });
      } catch (error) {
        await safeUnlink(storedPath);
        storedPath = undefined;
        throw error;
      }
    } finally {
      await safeUnlink(tempPath);
    }
  },
);
