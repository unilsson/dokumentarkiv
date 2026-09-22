# Dokumentarkiv

Ett enkelt digitalt arkiv för skannade dokument.

Målet är medvetet smalt: ladda upp, kategorisera, hitta, visa och hämta dokument utan den komplexitet som följer med större dokumenthanteringssystem.

## Principer

- Applikationskod och privat data hålls strikt separerade.
- All persistent runtime-data ligger under en enda datakatalog.
- Databasen och uppladdade dokument får aldrig versionshanteras.
- Projektet ska vara enkelt att köra lokalt nu och enkelt att paketera i Docker senare.
- Funktioner läggs till när de förenklar arkivering eller återfinnande.

## Struktur

```text
dokumentarkiv/
├── backend/
├── frontend/
├── data/              # persistent data, ignoreras av Git
├── .env.example
├── .gitignore
└── package.json
```

Runtime-strukturen skapas automatiskt:

```text
data/
├── archive.db
├── documents/
├── thumbnails/
└── tmp/
```

I en framtida container motsvarar detta en persistent volym monterad som `/data`.

## Funktioner

Sprint 1 lade grunden med React/Vite/TypeScript, Express/TypeScript, SQLite, `DATA_DIR`, `GET /api/health` och strikt separerad runtime-data.

Sprint 2 lägger till dokumentuppladdning:

- PDF, JPG, PNG och Markdown (.md)
- max 25 MB per fil
- titel, dokumentdatum, kategori och anteckning
- standardkategorier som skapas automatiskt
- staging under `DATA_DIR/tmp`
- kontroll av faktisk filsignatur för PDF/bilder och giltig UTF-8 för Markdown
- SHA-256 för varje dokument
- skydd mot identiska dubbletter
- säkert internt filnamn
- slutlig lagring under `DATA_DIR/documents`
- metadata i SQLite

Sprint 3 lägger till arkivvyn:

- startsida med lista över arkiverade dokument
- textsökning i titel, anteckning och originalfilnamn
- filtrering på kategori
- sortering med nyaste dokument först
- klickbar detaljvy med metadata, kategori och SHA-256
- uppladdningsvyn finns kvar som separat vy

## API

```text
GET  /api/health
GET  /api/categories
GET  /api/documents
GET  /api/documents/:id
POST /api/documents
```

`POST /api/documents` använder `multipart/form-data` med fälten:

```text
file
title
documentDate
categoryId
description
```

## Krav

- Node.js 24 eller senare
- npm

Backend använder Node.js inbyggda `node:sqlite`.

## Kom igång

Installera beroenden från repository-roten:

```bash
npm install
```

Starta backend:

```bash
npm run dev:backend
```

Starta frontend i en andra terminal:

```bash
npm run dev:frontend
```

Frontend körs normalt på:

```text
http://localhost:5173
```

Backend körs normalt på:

```text
http://localhost:3001
```

Vite proxar `/api` till backend under lokal utveckling.

## Konfiguration

Standardvärden under lokal utveckling:

```text
PORT=3001
DATA_DIR=../data
```

För Docker är den tänkta modellen:

```text
DATA_DIR=/data
```

`.env.example` dokumenterar de variabler som används. Lokala `.env`-filer ignoreras av Git och ska aldrig checkas in.

## Datasäkerhet

Följande ska aldrig finnas i Git:

- SQLite-databaser
- uppladdade dokument
- thumbnails
- temporära filer
- `.env`
- credentials, tokens eller andra hemligheter

Kontrollera reglerna med:

```bash
git check-ignore -v data/archive.db
git check-ignore -v data/documents/test.pdf
git check-ignore -v .env
```

Alla tre ska matcha en regel i `.gitignore`.

## Backupprincip

När Docker-stödet är infört ska hela persistent state finnas under en enda volym:

```text
/data
```

Det gör backupprincipen enkel:

> Backup av Dokumentarkiv = backup av datavolymen.

## Nästa steg

Nästa naturliga steg är att kunna öppna eller hämta själva originalfilen från dokumentdetaljen och därefter lägga till förhandsvisning för PDF, bilder och Markdown.
