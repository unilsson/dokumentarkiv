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

type DocumentItem = {
  id: number;
  title: string;
  originalFilename: string;
  mimeType: string;
  documentDate: string | null;
  description: string | null;
  sha256: string;
  createdAt: string;
  updatedAt: string;
  category: Category | null;
};

type ApiError = {
  message?: string;
};

type View = "archive" | "upload" | "detail";

function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
}

function formatDate(value: string | null): string {
  if (!value) {
    return "Inget datum";
  }

  const [year, month, day] = value.split("-");
  return `${year}-${month}-${day}`;
}

function formatCreatedAt(value: string): string {
  const date = new Date(value.replace(" ", "T") + "Z");

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function fileTypeLabel(mimeType: string): string {
  switch (mimeType) {
    case "application/pdf":
      return "PDF";
    case "image/jpeg":
      return "JPG";
    case "image/png":
      return "PNG";
    case "text/markdown":
      return "MD";
    default:
      return mimeType;
  }
}

function MarkdownPreview({ documentId }: { documentId: number }) {
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/documents/${documentId}/content`)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Markdown-filen kunde inte hämtas.");
        }

        return response.text();
      })
      .then((text) => {
        if (!cancelled) {
          setContent(text);
        }
      })
      .catch((previewError: unknown) => {
        if (!cancelled) {
          setError(
            previewError instanceof Error
              ? previewError.message
              : "Markdown-filen kunde inte hämtas.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [documentId]);

  if (loading) {
    return <p className="previewMessage">Laddar Markdown…</p>;
  }

  if (error) {
    return <p className="previewMessage previewError">{error}</p>;
  }

  return <pre className="markdownPreview">{content}</pre>;
}

function DocumentPreview({ document }: { document: DocumentItem }) {
  const contentUrl = `/api/documents/${document.id}/content`;

  if (document.mimeType === "application/pdf") {
    return (
      <iframe
        className="pdfPreview"
        src={contentUrl}
        title={`Förhandsvisning av ${document.title}`}
      />
    );
  }

  if (
    document.mimeType === "image/jpeg" ||
    document.mimeType === "image/png"
  ) {
    return (
      <div className="imagePreview">
        <img src={contentUrl} alt={document.title} />
      </div>
    );
  }

  if (document.mimeType === "text/markdown") {
    return <MarkdownPreview documentId={document.id} />;
  }

  return (
    <p className="previewMessage">
      Förhandsvisning stöds inte för den här filtypen.
    </p>
  );
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [view, setView] = useState<View>("archive");

  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [archiveLoading, setArchiveLoading] = useState(true);
  const [archiveError, setArchiveError] = useState("");
  const [search, setSearch] = useState("");
  const [archiveCategoryId, setArchiveCategoryId] = useState("");
  const [selectedDocument, setSelectedDocument] =
    useState<DocumentItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [documentDate, setDocumentDate] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [uploadedDocument, setUploadedDocument] =
    useState<DocumentItem | null>(null);
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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDocuments();
    }, 200);

    return () => window.clearTimeout(timer);
  }, [search, archiveCategoryId]);

  async function loadDocuments() {
    setArchiveLoading(true);
    setArchiveError("");

    const params = new URLSearchParams();

    if (search.trim()) {
      params.set("q", search.trim());
    }

    if (archiveCategoryId) {
      params.set("categoryId", archiveCategoryId);
    }

    const query = params.toString();

    try {
      const response = await fetch(
        `/api/documents${query ? `?${query}` : ""}`,
      );

      if (!response.ok) {
        throw new Error("Arkivet kunde inte hämtas.");
      }

      const payload = (await response.json()) as {
        documents: DocumentItem[];
      };

      setDocuments(payload.documents);
    } catch (error) {
      setDocuments([]);
      setArchiveError(
        error instanceof Error ? error.message : "Arkivet kunde inte hämtas.",
      );
    } finally {
      setArchiveLoading(false);
    }
  }

  async function openDocument(id: number) {
    setDetailLoading(true);
    setSelectedDocument(null);
    setView("detail");

    try {
      const response = await fetch(`/api/documents/${id}`);
      const payload = (await response.json()) as
        | { document: DocumentItem }
        | ApiError;

      if (!response.ok || !("document" in payload)) {
        throw new Error(
          "message" in payload && payload.message
            ? payload.message
            : "Dokumentet kunde inte hämtas.",
        );
      }

      setSelectedDocument(payload.document);
    } catch (error) {
      setArchiveError(
        error instanceof Error
          ? error.message
          : "Dokumentet kunde inte hämtas.",
      );
      setView("archive");
    } finally {
      setDetailLoading(false);
    }
  }

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
        | { document: DocumentItem }
        | ApiError;

      if (!response.ok) {
        const apiError = payload as ApiError;
        throw new Error(
          apiError.message || "Dokumentet kunde inte sparas.",
        );
      }

      if (!("document" in payload)) {
        throw new Error("Dokumentet kunde inte sparas.");
      }

      setUploadedDocument(payload.document);
      setFile(null);
      setTitle("");
      setDocumentDate("");
      setCategoryId("");
      setDescription("");
      setFileInputKey((value) => value + 1);
      await loadDocuments();
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
        <header className="appHeader">
          <div>
            <p className="eyebrow">Dokumentarkiv</p>
            <h1>Mitt arkiv</h1>
          </div>

          <div className="headerActions">
            <nav className="mainNav" aria-label="Huvudnavigation">
              <button
                type="button"
                className={view === "archive" ? "navButton active" : "navButton"}
                onClick={() => setView("archive")}
              >
                Arkiv
              </button>
              <button
                type="button"
                className={view === "upload" ? "navButton active" : "navButton"}
                onClick={() => setView("upload")}
              >
                Ladda upp
              </button>
            </nav>

            <div className="status">
              <span className={health?.status === "ok" ? "dot ready" : "dot"} />
              {health?.status === "ok" ? "Redo" : "Offline"}
            </div>
          </div>
        </header>

        {view === "archive" && (
          <>
            <section className="sectionHeader">
              <div>
                <h2>Dokument</h2>
                <p>Sök, filtrera och öppna dokument i arkivet.</p>
              </div>
              <span className="countBadge">
                {archiveLoading
                  ? "Laddar…"
                  : `${documents.length} dokument`}
              </span>
            </section>

            <section className="filterBar">
              <label className="filterField searchField">
                <span>Sök</span>
                <input
                  type="search"
                  value={search}
                  placeholder="Titel, anteckning eller filnamn"
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>

              <label className="filterField">
                <span>Kategori</span>
                <select
                  value={archiveCategoryId}
                  onChange={(event) =>
                    setArchiveCategoryId(event.target.value)
                  }
                >
                  <option value="">Alla kategorier</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
            </section>

            {archiveError && (
              <section className="notice errorNotice" role="alert">
                {archiveError}
              </section>
            )}

            <section className="archiveCard">
              {!archiveLoading && documents.length === 0 ? (
                <div className="emptyState">
                  <strong>Inga dokument hittades.</strong>
                  <span>
                    Ändra sökningen eller ladda upp ditt första dokument.
                  </span>
                </div>
              ) : (
                <div className="documentList">
                  {documents.map((document) => (
                    <button
                      type="button"
                      className="documentRow"
                      key={document.id}
                      onClick={() => void openDocument(document.id)}
                    >
                      <div className="fileType">
                        {fileTypeLabel(document.mimeType)}
                      </div>

                      <div className="documentMain">
                        <strong>{document.title}</strong>
                        <span>{document.originalFilename}</span>
                      </div>

                      <div className="documentMeta">
                        <span>{document.category?.name ?? "Ingen kategori"}</span>
                        <span>{formatDate(document.documentDate)}</span>
                      </div>

                      <span className="rowArrow" aria-hidden="true">
                        →
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {view === "detail" && (
          <section>
            <button
              type="button"
              className="backButton"
              onClick={() => setView("archive")}
            >
              ← Till arkivet
            </button>

            {detailLoading && (
              <section className="archiveCard detailCard">
                <p>Laddar dokument…</p>
              </section>
            )}

            {selectedDocument && (
              <section className="archiveCard detailCard">
                <div className="detailHeading">
                  <div>
                    <span className="typeBadge">
                      {fileTypeLabel(selectedDocument.mimeType)}
                    </span>
                    <h2>{selectedDocument.title}</h2>
                  </div>
                  <span className="categoryBadge">
                    {selectedDocument.category?.name ?? "Ingen kategori"}
                  </span>
                </div>

                <div className="documentActions">
                  <a
                    className="secondaryLinkButton"
                    href={`/api/documents/${selectedDocument.id}/content`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Öppna original
                  </a>
                  <a
                    className="primaryLinkButton"
                    href={`/api/documents/${selectedDocument.id}/download`}
                  >
                    Ladda ner original
                  </a>
                </div>

                <dl className="detailGrid">
                  <div>
                    <dt>Dokumentdatum</dt>
                    <dd>{formatDate(selectedDocument.documentDate)}</dd>
                  </div>
                  <div>
                    <dt>Originalfil</dt>
                    <dd>{selectedDocument.originalFilename}</dd>
                  </div>
                  <div>
                    <dt>Filtyp</dt>
                    <dd>{selectedDocument.mimeType}</dd>
                  </div>
                  <div>
                    <dt>Arkiverad</dt>
                    <dd>{formatCreatedAt(selectedDocument.createdAt)}</dd>
                  </div>
                  <div className="detailWide">
                    <dt>SHA-256</dt>
                    <dd className="hashValue">{selectedDocument.sha256}</dd>
                  </div>
                  <div className="detailWide">
                    <dt>Anteckning</dt>
                    <dd>
                      {selectedDocument.description || "Ingen anteckning."}
                    </dd>
                  </div>
                </dl>

                <section className="previewSection">
                  <div className="previewHeading">
                    <h3>Förhandsvisning</h3>
                    <span>{fileTypeLabel(selectedDocument.mimeType)}</span>
                  </div>
                  <DocumentPreview document={selectedDocument} />
                </section>
              </section>
            )}
          </section>
        )}

        {view === "upload" && (
          <>
            <section className="sectionHeader">
              <div>
                <h2>Arkivera ett dokument</h2>
                <p>
                  PDF, JPG, PNG och Markdown lagras i den lokala datakatalogen.
                </p>
              </div>
            </section>

            <section className="card">
              <form className="uploadForm" onSubmit={handleSubmit}>
                <label className="fileDrop">
                  <span className="fileDropTitle">
                    {file ? file.name : "Välj ett dokument"}
                  </span>
                  <span className="fileDropHint">
                    PDF, JPG, PNG eller Markdown · max 25 MB
                  </span>
                  <input
                    key={fileInputKey}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.md,application/pdf,image/jpeg,image/png,text/markdown,text/plain"
                    onChange={(event) => {
                      const selectedFile =
                        event.target.files?.[0] ?? null;
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
                      onChange={(event) =>
                        setDocumentDate(event.target.value)
                      }
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
                      onChange={(event) =>
                        setDescription(event.target.value)
                      }
                    />
                  </label>
                </div>

                <div className="formFooter">
                  <p className="privacyNote">
                    Dokument och databas lagras endast under den lokala
                    datakatalogen och skickas aldrig till Git.
                  </p>
                  <button
                    className="primaryButton"
                    type="submit"
                    disabled={submitting}
                  >
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
                <button
                  type="button"
                  className="inlineButton"
                  onClick={() => void openDocument(uploadedDocument.id)}
                >
                  Visa dokumentet
                </button>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
