import path from "node:path";
import fs from "node:fs";

const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR ?? "../data");

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  dataDir,
  databasePath: path.join(dataDir, "archive.db"),
  documentsDir: path.join(dataDir, "documents"),
  thumbnailsDir: path.join(dataDir, "thumbnails"),
  tempDir: path.join(dataDir, "tmp"),
  ocrEnabled: process.env.OCR_ENABLED !== "false",
  ocrLanguages: process.env.OCR_LANGUAGES?.trim() || "swe+eng",
  ocrMaxPdfPages: positiveInteger(process.env.OCR_MAX_PDF_PAGES, 30),
  ocrTimeoutMs: positiveInteger(process.env.OCR_TIMEOUT_MS, 120_000),
  ocrMaxChars: positiveInteger(process.env.OCR_MAX_CHARS, 500_000),
  ocrMinPdfTextChars: positiveInteger(
    process.env.OCR_MIN_PDF_TEXT_CHARS,
    80,
  ),
};

export function ensureDataDirectories(): void {
  for (const directory of [
    config.dataDir,
    config.documentsDir,
    config.thumbnailsDir,
    config.tempDir,
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }
}
