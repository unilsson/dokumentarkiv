import { useEffect, useState } from "react";

type Health = {
  status: string;
  service: string;
  database: string;
};

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);

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
  }, []);

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Dokumentarkiv</p>
        <h1>Ditt digitala arkiv, utan onödig komplexitet.</h1>
        <p className="intro">
          Sprint 1 lägger grunden: separerad persistent data, SQLite och en
          enkel webbapplikation redo för dokumentuppladdning i nästa sprint.
        </p>

        <div className="status">
          <span className={health?.status === "ok" ? "dot ready" : "dot"} />
          {health?.status === "ok"
            ? "Backend och databas är redo"
            : "Väntar på backend"}
        </div>
      </section>
    </main>
  );
}
