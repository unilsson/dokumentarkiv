import express from "express";
import multer from "multer";
import { config } from "./config.js";
import { getDatabase } from "./database.js";
import { categoriesRouter } from "./routes/categories.js";
import { documentsRouter } from "./routes/documents.js";
import { tagsRouter } from "./routes/tags.js";
import { MAX_UPLOAD_BYTES } from "./upload.js";

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

app.use("/api/categories", categoriesRouter);
app.use("/api/tags", tagsRouter);
app.use("/api/documents", documentsRouter);

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({
          error: "file_too_large",
          message: `Filen är för stor. Maxstorlek är ${Math.round(
            MAX_UPLOAD_BYTES / 1024 / 1024,
          )} MB.`,
        });
        return;
      }

      res.status(400).json({
        error: "upload_error",
        message: "Uppladdningen kunde inte behandlas.",
      });
      return;
    }

    if (error instanceof Error) {
      if (error.message.startsWith("Filtypen stöds inte")) {
        res.status(400).json({
          error: "unsupported_file_type",
          message: error.message,
        });
        return;
      }

      console.error(error);
    }

    res.status(500).json({
      error: "internal_error",
      message: "Ett oväntat fel inträffade.",
    });
  },
);

app.listen(config.port, () => {
  console.log(`Dokumentarkiv backend listening on http://localhost:${config.port}`);
});
