import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readFile } from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import { config, ensureDataDirectories } from "./config.js";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const allowedMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "text/markdown",
]);

const extensionByMimeType: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "text/markdown": ".md",
};

function isMarkdownFilename(filename: string): boolean {
  return path.extname(filename).toLowerCase() === ".md";
}

export function normalizeMimeType(
  mimeType: string,
  originalFilename: string,
): string {
  if (
    isMarkdownFilename(originalFilename) &&
    (mimeType === "text/markdown" || mimeType === "text/plain")
  ) {
    return "text/markdown";
  }

  return mimeType;
}

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    ensureDataDirectories();
    callback(null, config.tempDir);
  },
  filename: (_req, _file, callback) => {
    callback(null, `${randomUUID()}.upload`);
  },
});

export const documentUpload = multer({
  storage,
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    fields: 5,
  },
  fileFilter: (_req, file, callback) => {
    const mimeType = normalizeMimeType(file.mimetype, file.originalname);

    if (!allowedMimeTypes.has(mimeType)) {
      callback(
        new Error("Filtypen stöds inte. Använd PDF, JPG, PNG eller Markdown."),
      );
      return;
    }

    callback(null, true);
  },
});

export function extensionForMimeType(mimeType: string): string {
  const extension = extensionByMimeType[mimeType];

  if (!extension) {
    throw new Error("Filtypen stöds inte.");
  }

  return extension;
}

export async function hasValidFileSignature(
  filePath: string,
  mimeType: string,
): Promise<boolean> {
  if (mimeType === "text/markdown") {
    try {
      const content = await readFile(filePath);

      if (content.includes(0)) {
        return false;
      }

      new TextDecoder("utf-8", { fatal: true }).decode(content);
      return true;
    } catch {
      return false;
    }
  }

  const handle = await open(filePath, "r");

  try {
    const buffer = Buffer.alloc(1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead);

    if (mimeType === "application/pdf") {
      return header.includes(Buffer.from("%PDF-"));
    }

    if (mimeType === "image/png") {
      const pngSignature = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      return header.subarray(0, pngSignature.length).equals(pngSignature);
    }

    if (mimeType === "image/jpeg") {
      return (
        header.length >= 3 &&
        header[0] === 0xff &&
        header[1] === 0xd8 &&
        header[2] === 0xff
      );
    }

    return false;
  } finally {
    await handle.close();
  }
}

export async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
