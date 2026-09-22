import { DatabaseSync } from "node:sqlite";
import { config, ensureDataDirectories } from "./config.js";

let database: DatabaseSync | undefined;

const defaultCategories = [
  "Hus",
  "Försäkringar",
  "Kvitton",
  "Avtal",
  "Fordon",
  "Förening",
  "Manualer",
  "Övrigt",
];

export function getDatabase(): DatabaseSync {
  if (database) {
    return database;
  }

  ensureDataDirectories();

  database = new DatabaseSync(config.databasePath);
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA journal_mode = WAL;");

  database.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      stored_filename TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL,
      document_date TEXT,
      category_id INTEGER,
      description TEXT,
      sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS document_tags (
      document_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (document_id, tag_id),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_documents_document_date
      ON documents(document_date);

    CREATE INDEX IF NOT EXISTS idx_documents_category_id
      ON documents(category_id);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_sha256_unique
      ON documents(sha256);

    CREATE INDEX IF NOT EXISTS idx_document_tags_tag_id
      ON document_tags(tag_id);

    CREATE INDEX IF NOT EXISTS idx_tags_name_nocase
      ON tags(name COLLATE NOCASE);
  `);

  const insertCategory = database.prepare(
    "INSERT OR IGNORE INTO categories (name) VALUES (?)",
  );

  for (const category of defaultCategories) {
    insertCategory.run(category);
  }

  return database;
}
