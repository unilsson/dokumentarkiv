import path from "node:path";
import fs from "node:fs";

const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR ?? "../data");

export const config = {
  port: Number(process.env.PORT ?? 3001),
  dataDir,
  databasePath: path.join(dataDir, "archive.db"),
  documentsDir: path.join(dataDir, "documents"),
  thumbnailsDir: path.join(dataDir, "thumbnails"),
  tempDir: path.join(dataDir, "tmp"),
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
