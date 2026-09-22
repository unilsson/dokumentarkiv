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
  sha256File,
} from "../upload.js";

export const documentsRouter = Router();

type ExistingDocument = {
  id: number;
  title: string;
  original_filename: string;
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

documentsRouter.post(
  "/",
  documentUpload.single("file"),
  async (req, res) => {
    const file = req.file;

    if (!file) {
      res.status(400).json({
        error: "missing_file",
        message: "Välj en PDF-, JPG- eller PNG-fil att ladda upp.",
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

      if (!(await hasValidFileSignature(file.path, file.mimetype))) {
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
        randomUUID() + extensionForMimeType(file.mimetype);
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
            file.mimetype,
            documentDate || null,
            categoryId,
            description || null,
            sha256,
          );

        const id = Number(result.lastInsertRowid);

        const document = getDatabase()
          .prepare(
            `SELECT
              d.id,
              d.title,
              d.original_filename,
              d.stored_filename,
              d.mime_type,
              d.document_date,
              d.description,
              d.sha256,
              d.created_at,
              c.id AS category_id,
              c.name AS category_name
            FROM documents d
            LEFT JOIN categories c ON c.id = d.category_id
            WHERE d.id = ?`,
          )
          .get(id) as DocumentRecord;

        storedPath = undefined;

        res.status(201).json({
          document: {
            id: document.id,
            title: document.title,
            originalFilename: document.original_filename,
            storedFilename: document.stored_filename,
            mimeType: document.mime_type,
            documentDate: document.document_date,
            description: document.description,
            sha256: document.sha256,
            createdAt: document.created_at,
            category: document.category_id
              ? {
                  id: document.category_id,
                  name: document.category_name,
                }
              : null,
          },
        });
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
