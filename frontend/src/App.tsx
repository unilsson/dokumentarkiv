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

type Tag = {
  id: number;
  name: string;
  documentCount?: number;
};

type DocumentItem = {
  id: number;
  title: string;
  originalFilename: string;
  mimeType: string;
  documentDate: string | null;
  description: string | null;
  paid: boolean;
  paidAt: string | null;
  sha256: string;
  createdAt: string;
  updatedAt: string;
  category: Category | null;
  tags: Tag[];
};

type ApiError = {
  message?: string;
};

type View = "home" | "archive" | "upload" | "detail";

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
  const [tags, setTags] = useState<Tag[]>([]);
  const [view, setView] = useState<View>("home");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [homeDocuments, setHomeDocuments] = useState<DocumentItem[]>([]);
  const [homeLoading, setHomeLoading] = useState(true);

  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [archiveLoading, setArchiveLoading] = useState(true);
  const [archiveError, setArchiveError] = useState("");
  const [search, setSearch] = useState("");
  const [archiveCategoryId, setArchiveCategoryId] = useState("");
  const [archiveTagId, setArchiveTagId] = useState("");
  const [archivePaymentStatus, setArchivePaymentStatus] = useState("");
  const [selectedDocument, setSelectedDocument] =
    useState<DocumentItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDocumentDate, setEditDocumentDate] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [detailMessage, setDetailMessage] = useState("");
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [documentDate, setDocumentDate] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [uploadTags, setUploadTags] = useState("");
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

    void loadTags();
  }, []);

  useEffect(() => {
    void loadHomeDocuments();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDocuments();
    }, 200);

    return () => window.clearTimeout(timer);
  }, [search, archiveCategoryId, archiveTagId, archivePaymentStatus]);

  async function loadTags() {
    try {
      const response = await fetch("/api/tags");

      if (!response.ok) {
        throw new Error("Taggar kunde inte hämtas.");
      }

      const payload = (await response.json()) as { tags: Tag[] };
      setTags(payload.tags);
    } catch {
      setTags([]);
    }
  }

  async function loadHomeDocuments() {
    setHomeLoading(true);

    try {
      const response = await fetch("/api/documents");

      if (!response.ok) {
        throw new Error("Översikten kunde inte hämtas.");
      }

      const payload = (await response.json()) as {
        documents: DocumentItem[];
      };

      setHomeDocuments(payload.documents);
    } catch {
      setHomeDocuments([]);
    } finally {
      setHomeLoading(false);
    }
  }

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

    if (archiveTagId) {
      params.set("tagId", archiveTagId);
    }

    if (archivePaymentStatus) {
      params.set("paymentStatus", archivePaymentStatus);
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
    setIsEditing(false);
    setDeleteConfirming(false);
    setDetailMessage("");
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

  function startEditing() {
    if (!selectedDocument) {
      return;
    }

    setEditTitle(selectedDocument.title);
    setEditDocumentDate(selectedDocument.documentDate ?? "");
    setEditCategoryId(
      selectedDocument.category ? String(selectedDocument.category.id) : "",
    );
    setEditTags(selectedDocument.tags.map((tag) => tag.name).join(", "));
    setEditDescription(selectedDocument.description ?? "");
    setDetailMessage("");
    setDeleteConfirming(false);
    setIsEditing(true);
  }

  function cancelEditing() {
    setIsEditing(false);
    setDetailMessage("");
  }

  async function saveMetadata(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedDocument) {
      return;
    }

    setMetadataSaving(true);
    setDetailMessage("");

    try {
      const response = await fetch(
        `/api/documents/${selectedDocument.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: editTitle,
            documentDate: editDocumentDate || null,
            categoryId: editCategoryId ? Number(editCategoryId) : null,
            tags: editTags,
            description: editDescription,
          }),
        },
      );

      const payload = (await response.json()) as
        | { document: DocumentItem }
        | ApiError;

      if (!response.ok || !("document" in payload)) {
        throw new Error(
          "message" in payload && payload.message
            ? payload.message
            : "Metadata kunde inte sparas.",
        );
      }

      setSelectedDocument(payload.document);
      setIsEditing(false);
      setDetailMessage("Metadata sparades.");
      await loadDocuments();
      await loadHomeDocuments();
      await loadTags();
    } catch (error) {
      setDetailMessage(
        error instanceof Error ? error.message : "Metadata kunde inte sparas.",
      );
    } finally {
      setMetadataSaving(false);
    }
  }

  async function setPaymentStatus(paid: boolean) {
    if (!selectedDocument || selectedDocument.category?.name !== "Räkningar") {
      return;
    }

    setPaymentSaving(true);
    setDetailMessage("");

    try {
      const response = await fetch(
        `/api/documents/${selectedDocument.id}/payment`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ paid }),
        },
      );

      const payload = (await response.json()) as
        | { document: DocumentItem }
        | ApiError;

      if (!response.ok || !("document" in payload)) {
        throw new Error(
          "message" in payload && payload.message
            ? payload.message
            : "Betalstatus kunde inte sparas.",
        );
      }

      setSelectedDocument(payload.document);
      setDetailMessage(paid ? "Räkningen markerades som betald." : "Räkningen markerades som obetald.");
      await loadDocuments();
      await loadHomeDocuments();
    } catch (error) {
      setDetailMessage(
        error instanceof Error
          ? error.message
          : "Betalstatus kunde inte sparas.",
      );
    } finally {
      setPaymentSaving(false);
    }
  }

  async function deleteDocument() {
    if (!selectedDocument) {
      return;
    }

    setDeleting(true);
    setDetailMessage("");

    try {
      const response = await fetch(
        `/api/documents/${selectedDocument.id}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        let message = "Dokumentet kunde inte tas bort.";

        try {
          const payload = (await response.json()) as ApiError;
          if (payload.message) {
            message = payload.message;
          }
        } catch {
          // Keep the generic message if the response has no JSON body.
        }

        throw new Error(message);
      }

      setSelectedDocument(null);
      setDeleteConfirming(false);
      setIsEditing(false);
      setView("archive");
      await loadDocuments();
      await loadHomeDocuments();
      await loadTags();
    } catch (error) {
      setDetailMessage(
        error instanceof Error
          ? error.message
          : "Dokumentet kunde inte tas bort.",
      );
    } finally {
      setDeleting(false);
    }
  }

  function showHome() {
    setSearch("");
    setArchiveCategoryId("");
    setArchiveTagId("");
    setArchivePaymentStatus("");
    setView("home");
    setSidebarOpen(false);
    void loadHomeDocuments();
  }

  function showAllDocuments() {
    setSearch("");
    setArchiveCategoryId("");
    setArchiveTagId("");
    setArchivePaymentStatus("");
    setView("archive");
    setSidebarOpen(false);
  }

  function showCategory(categoryId: number) {
    setSearch("");
    setArchiveTagId("");
    setArchivePaymentStatus("");
    setArchiveCategoryId(String(categoryId));
    setView("archive");
    setSidebarOpen(false);
  }

  function showTag(tagId: number) {
    setSearch("");
    setArchiveCategoryId("");
    setArchivePaymentStatus("");
    setArchiveTagId(String(tagId));
    setView("archive");
    setSidebarOpen(false);
  }

  function showUpload() {
    setView("upload");
    setSidebarOpen(false);
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
    formData.append("tags", uploadTags);
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
      setUploadTags("");
      setDescription("");
      setFileInputKey((value) => value + 1);
      await loadDocuments();
      await loadHomeDocuments();
      await loadTags();
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

  const activeCategory = categories.find(
    (category) => String(category.id) === archiveCategoryId,
  );
  const activeTag = tags.find((tag) => String(tag.id) === archiveTagId);

  return (
    <div className="appShell">
      <button
        type="button"
        className={sidebarOpen ? "sidebarBackdrop visible" : "sidebarBackdrop"}
        aria-label="Stäng meny"
        onClick={() => setSidebarOpen(false)}
      />

      <aside className={sidebarOpen ? "sidebar open" : "sidebar"}>
        <div className="sidebarBrand">
          <span className="brandMark">D</span>
          <div>
            <strong>Dokumentarkiv</strong>
            <span>Mitt digitala arkiv</span>
          </div>
        </div>

        <nav className="sidebarNav" aria-label="Huvudnavigation">
          <button
            type="button"
            className={view === "home" ? "sidebarItem active" : "sidebarItem"}
            onClick={showHome}
          >
            <span className="sidebarIcon">⌂</span>
            Hem
          </button>
          <button
            type="button"
            className={
              view === "archive" && !archiveCategoryId
                ? "sidebarItem active"
                : "sidebarItem"
            }
            onClick={showAllDocuments}
          >
            <span className="sidebarIcon">▤</span>
            Alla dokument
          </button>
          <button
            type="button"
            className={view === "upload" ? "sidebarItem active" : "sidebarItem"}
            onClick={showUpload}
          >
            <span className="sidebarIcon">＋</span>
            Ladda upp
          </button>
        </nav>

        <div className="sidebarSection">
          <span className="sidebarSectionTitle">Kategorier</span>
          <div className="categoryNav">
            {categories.map((category) => (
              <button
                type="button"
                key={category.id}
                className={
                  view === "archive" &&
                  archiveCategoryId === String(category.id)
                    ? "categoryNavItem active"
                    : "categoryNavItem"
                }
                onClick={() => showCategory(category.id)}
              >
                <span>{category.name}</span>
              </button>
            ))}
          </div>
        </div>

        {tags.length > 0 && (
          <div className="sidebarSection">
            <span className="sidebarSectionTitle">Taggar</span>
            <div className="categoryNav">
              {tags.map((tag) => (
                <button
                  type="button"
                  key={tag.id}
                  className={
                    view === "archive" && archiveTagId === String(tag.id)
                      ? "categoryNavItem active"
                      : "categoryNavItem"
                  }
                  onClick={() => showTag(tag.id)}
                >
                  <span>{tag.name}</span>
                  <small className="tagNavCount">{tag.documentCount ?? 0}</small>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="sidebarStatus">
          <span className={health?.status === "ok" ? "dot ready" : "dot"} />
          <div>
            <strong>{health?.status === "ok" ? "Systemet är redo" : "Offline"}</strong>
            <span>Lokalt dokumentarkiv</span>
          </div>
        </div>
      </aside>

      <main className="contentShell">
        <header className="mobileHeader">
          <button
            type="button"
            className="menuButton"
            aria-label="Öppna meny"
            onClick={() => setSidebarOpen(true)}
          >
            ☰
          </button>
          <strong>Dokumentarkiv</strong>
          <span className={health?.status === "ok" ? "dot ready" : "dot"} />
        </header>

        <div className="page">
          {view === "home" && (
            <>
              <section className="homeHero">
                <p className="eyebrow">Dokumentarkiv</p>
                <h1>Hem</h1>
                <p>
                  En snabb överblick över arkivet och de senast tillagda
                  dokumenten.
                </p>
              </section>

              <section className="summaryGrid">
                <button
                  type="button"
                  className="summaryCard"
                  onClick={showAllDocuments}
                >
                  <span>Dokument</span>
                  <strong>{homeLoading ? "–" : homeDocuments.length}</strong>
                  <small>Totalt i arkivet</small>
                </button>
                <div className="summaryCard">
                  <span>Kategorier</span>
                  <strong>{categories.length}</strong>
                  <small>Tillgängliga kategorier</small>
                </div>
                <button
                  type="button"
                  className="summaryCard"
                  onClick={showUpload}
                >
                  <span>Arkivera</span>
                  <strong>＋</strong>
                  <small>Ladda upp nytt dokument</small>
                </button>
              </section>

              <section className="homeSection">
                <div className="sectionHeader">
                  <div>
                    <h2>Senaste dokument</h2>
                    <p>De senast arkiverade dokumenten.</p>
                  </div>
                  <button
                    type="button"
                    className="textButton"
                    onClick={showAllDocuments}
                  >
                    Visa alla →
                  </button>
                </div>

                <div className="archiveCard">
                  {!homeLoading && homeDocuments.length === 0 ? (
                    <div className="emptyState">
                      <strong>Arkivet är tomt.</strong>
                      <span>Ladda upp ditt första dokument för att komma igång.</span>
                    </div>
                  ) : (
                    <div className="documentList">
                      {homeDocuments.slice(0, 5).map((document) => (
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
                            <span>
                              {document.category?.name ?? "Ingen kategori"}
                            </span>
                            <span>{formatDate(document.documentDate)}</span>
                            {document.category?.name === "Räkningar" && (
                              <span
                                className={
                                  document.paid
                                    ? "paymentBadge paid"
                                    : "paymentBadge unpaid"
                                }
                              >
                                {document.paid ? "Betald" : "Obetald"}
                              </span>
                            )}
                          </div>
                          <span className="rowArrow" aria-hidden="true">
                            →
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </>
          )}

        {view === "archive" && (
          <>
            <section className="sectionHeader">
              <div>
                <h2>
                  {activeTag?.name ?? activeCategory?.name ?? "Alla dokument"}
                </h2>
                <p>
                  {activeTag
                    ? `Dokument med taggen ${activeTag.name}.`
                    : activeCategory
                      ? `Dokument i kategorin ${activeCategory.name}.`
                      : "Sök, filtrera och öppna dokument i arkivet."}
                </p>
              </div>
              <span className="countBadge">
                {archiveLoading
                  ? "Laddar…"
                  : `${documents.length} dokument`}
              </span>
            </section>

            <section
              className={
                activeCategory?.name === "Räkningar"
                  ? "filterBar billFilters"
                  : "filterBar"
              }
            >
              <label className="filterField searchField">
                <span>Sök</span>
                <input
                  type="search"
                  value={search}
                  placeholder="Titel, anteckning, filnamn, tagg eller dokumentinnehåll"
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>

              <label className="filterField">
                <span>Kategori</span>
                <select
                  value={archiveCategoryId}
                  onChange={(event) => {
                    setArchiveTagId("");
                    setArchivePaymentStatus("");
                    setArchiveCategoryId(event.target.value);
                  }}
                >
                  <option value="">Alla kategorier</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="filterField">
                <span>Tagg</span>
                <select
                  value={archiveTagId}
                  onChange={(event) => {
                    setArchiveCategoryId("");
                    setArchivePaymentStatus("");
                    setArchiveTagId(event.target.value);
                  }}
                >
                  <option value="">Alla taggar</option>
                  {tags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </select>
              </label>

              {activeCategory?.name === "Räkningar" && (
                <label className="filterField">
                  <span>Betalstatus</span>
                  <select
                    value={archivePaymentStatus}
                    onChange={(event) =>
                      setArchivePaymentStatus(event.target.value)
                    }
                  >
                    <option value="">Alla</option>
                    <option value="unpaid">Obetalda</option>
                    <option value="paid">Betalda</option>
                  </select>
                </label>
              )}
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
                        {document.category?.name === "Räkningar" && (
                          <span
                            className={
                              document.paid
                                ? "paymentBadge paid"
                                : "paymentBadge unpaid"
                            }
                          >
                            {document.paid ? "Betald" : "Obetald"}
                          </span>
                        )}
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
                  <button
                    type="button"
                    className="secondaryActionButton"
                    onClick={startEditing}
                    disabled={metadataSaving || deleting}
                  >
                    Redigera metadata
                  </button>
                  <button
                    type="button"
                    className="dangerActionButton"
                    onClick={() => {
                      setDeleteConfirming(true);
                      setIsEditing(false);
                      setDetailMessage("");
                    }}
                    disabled={metadataSaving || deleting}
                  >
                    Ta bort
                  </button>
                </div>

                {selectedDocument.category?.name === "Räkningar" && (
                  <div
                    className={
                      selectedDocument.paid
                        ? "billPaymentPanel paid"
                        : "billPaymentPanel"
                    }
                  >
                    <label className="billPaidToggle">
                      <input
                        type="checkbox"
                        checked={selectedDocument.paid}
                        disabled={paymentSaving}
                        onChange={(event) =>
                          void setPaymentStatus(event.target.checked)
                        }
                      />
                      <span>Betald</span>
                    </label>
                    <span className="billPaymentInfo">
                      {paymentSaving
                        ? "Sparar…"
                        : selectedDocument.paidAt
                          ? `Betald ${formatCreatedAt(selectedDocument.paidAt)}`
                          : "Räkningen är inte betald."}
                    </span>
                  </div>
                )}

                {detailMessage && (
                  <div className="detailNotice" role="status">
                    {detailMessage}
                  </div>
                )}

                {isEditing && (
                  <form className="editPanel" onSubmit={saveMetadata}>
                    <div className="editPanelHeading">
                      <div>
                        <h3>Redigera metadata</h3>
                        <p>Originalfilen påverkas inte av dessa ändringar.</p>
                      </div>
                    </div>

                    <div className="formGrid">
                      <label className="field fieldWide">
                        <span>Titel</span>
                        <input
                          type="text"
                          value={editTitle}
                          maxLength={200}
                          required
                          onChange={(event) => setEditTitle(event.target.value)}
                        />
                      </label>

                      <label className="field">
                        <span>Dokumentdatum</span>
                        <input
                          type="date"
                          value={editDocumentDate}
                          onChange={(event) =>
                            setEditDocumentDate(event.target.value)
                          }
                        />
                      </label>

                      <label className="field">
                        <span>Kategori</span>
                        <select
                          value={editCategoryId}
                          onChange={(event) =>
                            setEditCategoryId(event.target.value)
                          }
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
                        <span>Taggar</span>
                        <input
                          type="text"
                          value={editTags}
                          placeholder="Till exempel: volvo, försäkring, 2026"
                          onChange={(event) => setEditTags(event.target.value)}
                        />
                        <small className="fieldHint">
                          Separera flera taggar med kommatecken.
                        </small>
                      </label>

                      <label className="field fieldWide">
                        <span>Anteckning</span>
                        <textarea
                          value={editDescription}
                          maxLength={4000}
                          rows={4}
                          onChange={(event) =>
                            setEditDescription(event.target.value)
                          }
                        />
                      </label>
                    </div>

                    <div className="editActions">
                      <button
                        type="button"
                        className="secondaryActionButton"
                        onClick={cancelEditing}
                        disabled={metadataSaving}
                      >
                        Avbryt
                      </button>
                      <button
                        type="submit"
                        className="primaryButton"
                        disabled={metadataSaving}
                      >
                        {metadataSaving ? "Sparar…" : "Spara ändringar"}
                      </button>
                    </div>
                  </form>
                )}

                {deleteConfirming && (
                  <div className="deletePanel">
                    <div>
                      <strong>Ta bort dokumentet permanent?</strong>
                      <p>
                        Både originalfilen och all metadata för dokumentet tas
                        bort från arkivet. Åtgärden kan inte ångras.
                      </p>
                    </div>
                    <div className="deleteActions">
                      <button
                        type="button"
                        className="secondaryActionButton"
                        onClick={() => setDeleteConfirming(false)}
                        disabled={deleting}
                      >
                        Avbryt
                      </button>
                      <button
                        type="button"
                        className="dangerConfirmButton"
                        onClick={() => void deleteDocument()}
                        disabled={deleting}
                      >
                        {deleting ? "Tar bort…" : "Ja, ta bort permanent"}
                      </button>
                    </div>
                  </div>
                )}

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
                    <dt>Taggar</dt>
                    <dd>
                      {selectedDocument.tags.length > 0 ? (
                        <div className="tagList">
                          {selectedDocument.tags.map((tag) => (
                            <button
                              type="button"
                              className="tagChip"
                              key={tag.id}
                              onClick={() => showTag(tag.id)}
                            >
                              {tag.name}
                            </button>
                          ))}
                        </div>
                      ) : (
                        "Inga taggar."
                      )}
                    </dd>
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
                    <span>Taggar</span>
                    <input
                      type="text"
                      value={uploadTags}
                      placeholder="Till exempel: skatt, 2026, viktigt"
                      onChange={(event) => setUploadTags(event.target.value)}
                    />
                    <small className="fieldHint">
                      Separera flera taggar med kommatecken.
                    </small>
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
    </div>
  );
}
