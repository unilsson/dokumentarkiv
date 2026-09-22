import { randomUUID } from "node:crypto";
import path from "node:path";
import { rename, unlink } from "node:fs/promises";
import { Router } from "express";
import { config } from "../config.js";
import { getDatabase } from "../database.js";
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

type DocumentRecord = {
  id: number;
  title: string;
  original_filename: string;
  stored_filename: string;
  mime_type: string;
  document_date: string | null;
  description: string | null;
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

function documentJson(document: DocumentRecord) {
  return {
    id: document.id,
    title: document.title,
    originalFilename: document.original_filename,
    mimeType: document.mime_type,
    documentDate: document.document_date,
    description: document.description,
    sha256: document.sha256,
    createdAt: document.created_at,
    updatedAt: document.updated_at,
    category: document.category_id
      ? {
          id: document.category_id,
          name: document.category_name,
        }
      : null,
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
  const conditions: string[] = [];
  const parameters: Array<string | number> = [];

  if (query) {
    const search = `%${query}%`;
    conditions.push(
      "(d.title LIKE ? COLLATE NOCASE OR d.description LIKE ? COLLATE NOCASE OR d.original_filename LIKE ? COLLATE NOCASE)",
    );
    parameters.push(search, search, search);
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
        const result = getDatabase()
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

        const id = Number(result.lastInsertRowid);

        const document = getDatabase()
          .prepare(`${documentSelect} WHERE d.id = ?`)
          .get(id) as DocumentRecord;

        storedPath = undefined;

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
