import { FormEvent, useEffect, useState } from "react";

type Health = {
  status: string;
  service: string;
  database: string;
};

type Category = {
  id: number;
  name: string;
};

type UploadedDocument = {
  id: number;
  title: string;
  originalFilename: string;
  mimeType: string;
  documentDate: string | null;
  description: string | null;
  sha256: string;
  category: Category | null;
};

type ApiError = {
  message?: string;
};

function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [documentDate, setDocumentDate] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [uploadedDocument, setUploadedDocument] =
    useState<UploadedDocument | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  useEffect(() => {
    fetch("/api/health")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Backend svarade inte korrekt");
        }

        return response.json() as Promise<Health>;
      })
      .then(setHealth)
      .catch(() => setHealth(null));

    fetch("/api/categories")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Kategorier kunde inte hämtas");
        }

        return response.json() as Promise<{ categories: Category[] }>;
      })
      .then((payload) => setCategories(payload.categories))
      .catch(() => setCategories([]));
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setUploadedDocument(null);

    if (!file) {
      setMessage("Välj ett dokument att ladda upp.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", title);
    formData.append("documentDate", documentDate);
    formData.append("categoryId", categoryId);
    formData.append("description", description);

    setSubmitting(true);

    try {
      const response = await fetch("/api/documents", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as
        | { document: UploadedDocument }
        | ApiError;

      if (!response.ok || !("document" in payload)) {
        throw new Error(payload.message || "Dokumentet kunde inte sparas.");
      }

      setUploadedDocument(payload.document);
      setFile(null);
      setTitle("");
      setDocumentDate("");
      setCategoryId("");
      setDescription("");
      setFileInputKey((value) => value + 1);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Dokumentet kunde inte sparas.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="shell">
      <div className="page">
        <header className="pageHeader">
          <div>
            <p className="eyebrow">Dokumentarkiv</p>
            <h1>Arkivera ett dokument</h1>
            <p className="intro">
              Ladda upp ett skannat dokument, lägg till den metadata du behöver
              och spara originalet tryggt i arkivet.
            </p>
          </div>

          <div className="status">
            <span className={health?.status === "ok" ? "dot ready" : "dot"} />
            {health?.status === "ok"
              ? "Backend och databas är redo"
              : "Väntar på backend"}
          </div>
        </header>

        <section className="card">
          <form className="uploadForm" onSubmit={handleSubmit}>
            <label className="fileDrop">
              <span className="fileDropTitle">
                {file ? file.name : "Välj ett dokument"}
              </span>
              <span className="fileDropHint">
                PDF, JPG eller PNG · max 25 MB
              </span>
              <input
                key={fileInputKey}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                onChange={(event) => {
                  const selectedFile = event.target.files?.[0] ?? null;
                  setFile(selectedFile);

                  if (selectedFile && !title.trim()) {
                    setTitle(titleFromFilename(selectedFile.name));
                  }
                }}
              />
            </label>

            <div className="formGrid">
              <label className="field fieldWide">
                <span>Titel</span>
                <input
                  type="text"
                  value={title}
                  maxLength={200}
                  required
                  placeholder="Till exempel Villahemförsäkring 2026"
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>

              <label className="field">
                <span>Dokumentdatum</span>
                <input
                  type="date"
                  value={documentDate}
                  onChange={(event) => setDocumentDate(event.target.value)}
                />
              </label>

              <label className="field">
                <span>Kategori</span>
                <select
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                >
                  <option value="">Ingen kategori</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field fieldWide">
                <span>Anteckning</span>
                <textarea
                  value={description}
                  maxLength={4000}
                  rows={4}
                  placeholder="Valfri kort beskrivning av dokumentet"
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
            </div>

            <div className="formFooter">
              <p className="privacyNote">
                Dokument och databas lagras endast under den lokala
                datakatalogen och skickas aldrig till Git.
              </p>
              <button type="submit" disabled={submitting}>
                {submitting ? "Sparar…" : "Spara dokument"}
              </button>
            </div>
          </form>
        </section>

        {message && (
          <section className="notice errorNotice" role="alert">
            {message}
          </section>
        )}

        {uploadedDocument && (
          <section className="notice successNotice">
            <strong>Dokumentet sparades.</strong>
            <span>
              {uploadedDocument.title}
              {uploadedDocument.category
                ? ` · ${uploadedDocument.category.name}`
                : ""}
            </span>
            <small>
              {uploadedDocument.originalFilename} · SHA-256{" "}
              {uploadedDocument.sha256.slice(0, 12)}…
            </small>
          </section>
        )}
      </div>
    </main>
  );
}
