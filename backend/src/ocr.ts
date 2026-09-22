import { execFile } from "node:child_process";
import path from "node:path";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { config } from "./config.js";
import { getDatabase } from "./database.js";

type OcrDocument = {
  id: number;
  stored_filename: string;
  mime_type: string;
};

const supportedMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

const queue: number[] = [];
const queued = new Set<number>();
let workerRunning = false;

function runCommand(
  command: string,
  args: string[],
  timeoutMs = config.ocrTimeoutMs,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
        timeout: timeoutMs,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail =
            typeof stderr === "string" && stderr.trim()
              ? `: ${stderr.trim().slice(0, 500)}`
              : "";
          reject(new Error(`${command} failed${detail}`));
          return;
        }

        resolve(stdout);
      },
    );
  });
}

function normalizeText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, config.ocrMaxChars);
}

function documentPath(storedFilename: string): string {
  if (path.basename(storedFilename) !== storedFilename) {
    throw new Error("Invalid stored document filename");
  }

  const root = path.resolve(config.documentsDir);
  const filePath = path.resolve(root, storedFilename);

  if (!filePath.startsWith(root + path.sep)) {
    throw new Error("Document path escaped the document directory");
  }

  return filePath;
}

async function ocrImage(filePath: string): Promise<string> {
  const text = await runCommand("tesseract", [
    filePath,
    "stdout",
    "-l",
    config.ocrLanguages,
    "--psm",
    "3",
  ]);

  return normalizeText(text);
}

async function textFromPdf(filePath: string): Promise<string> {
  try {
    const embeddedText = normalizeText(
      await runCommand("pdftotext", [
        "-f",
        "1",
        "-l",
        String(config.ocrMaxPdfPages),
        "-layout",
        "-enc",
        "UTF-8",
        filePath,
        "-",
      ]),
    );

    if (embeddedText.length >= config.ocrMinPdfTextChars) {
      return embeddedText;
    }
  } catch {
    // A missing pdftotext binary or a PDF without extractable text falls
    // through to rasterization + Tesseract OCR.
  }

  const tempDir = await mkdtemp(path.join(config.tempDir, "ocr-"));

  try {
    const prefix = path.join(tempDir, "page");

    await runCommand(
      "pdftoppm",
      [
        "-jpeg",
        "-r",
        "200",
        "-f",
        "1",
        "-l",
        String(config.ocrMaxPdfPages),
        filePath,
        prefix,
      ],
      Math.max(config.ocrTimeoutMs, 180_000),
    );

    const pageFiles = (await readdir(tempDir))
      .filter((filename) => /^page-\d+\.jpg$/i.test(filename))
      .sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
      );

    if (pageFiles.length === 0) {
      throw new Error("PDF rasterization produced no pages");
    }

    const pageTexts: string[] = [];

    for (const pageFile of pageFiles) {
      const pageText = await ocrImage(path.join(tempDir, pageFile));

      if (pageText) {
        pageTexts.push(pageText);
      }

      if (pageTexts.join("\n\n").length >= config.ocrMaxChars) {
        break;
      }
    }

    return normalizeText(pageTexts.join("\n\n"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function extractText(document: OcrDocument): Promise<string> {
  const filePath = documentPath(document.stored_filename);

  if (
    document.mime_type === "image/jpeg" ||
    document.mime_type === "image/png"
  ) {
    return ocrImage(filePath);
  }

  if (document.mime_type === "application/pdf") {
    return textFromPdf(filePath);
  }

  return "";
}

async function processDocument(documentId: number): Promise<void> {
  const database = getDatabase();
  const document = database
    .prepare(
      "SELECT id, stored_filename, mime_type FROM documents WHERE id = ?",
    )
    .get(documentId) as OcrDocument | undefined;

  if (!document) {
    return;
  }

  if (!supportedMimeTypes.has(document.mime_type)) {
    database
      .prepare(
        `UPDATE documents
         SET ocr_status = 'skipped',
             ocr_error = NULL,
             ocr_updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(document.id);
    return;
  }

  database
    .prepare(
      `UPDATE documents
       SET ocr_status = 'processing',
           ocr_error = NULL
       WHERE id = ?`,
    )
    .run(document.id);

  try {
    const text = await extractText(document);

    database
      .prepare(
        `UPDATE documents
         SET ocr_text = ?,
             ocr_status = 'completed',
             ocr_error = NULL,
             ocr_updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(text || null, document.id);

    console.log(
      `OCR completed for document ${document.id} (${text.length} characters)`,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown OCR error";

    database
      .prepare(
        `UPDATE documents
         SET ocr_status = 'error',
             ocr_error = ?,
             ocr_updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(message.slice(0, 1000), document.id);

    console.error(`OCR failed for document ${document.id}: ${message}`);
  }
}

async function drainQueue(): Promise<void> {
  if (workerRunning || !config.ocrEnabled) {
    return;
  }

  workerRunning = true;

  try {
    while (queue.length > 0) {
      const documentId = queue.shift();

      if (documentId === undefined) {
        continue;
      }

      queued.delete(documentId);
      await processDocument(documentId);
    }
  } finally {
    workerRunning = false;
  }
}

export function enqueueOcr(documentId: number): void {
  if (!config.ocrEnabled || queued.has(documentId)) {
    return;
  }

  queued.add(documentId);
  queue.push(documentId);
  void drainQueue();
}

export function startOcrWorker(): void {
  const database = getDatabase();

  if (!config.ocrEnabled) {
    console.log("OCR worker disabled by OCR_ENABLED=false");
    return;
  }

  database
    .prepare(
      `UPDATE documents
       SET ocr_status = 'pending'
       WHERE ocr_status = 'processing'`,
    )
    .run();

  const documents = database
    .prepare(
      `SELECT id
       FROM documents
       WHERE mime_type IN ('application/pdf', 'image/jpeg', 'image/png')
         AND ocr_status IN ('pending', 'error')
       ORDER BY id`,
    )
    .all() as Array<{ id: number }>;

  if (documents.length > 0) {
    console.log(`OCR worker queued ${documents.length} document(s)`);
  }

  for (const document of documents) {
    enqueueOcr(document.id);
  }
}
