# OREON Frontend ↔ Backend Integration

The frontend (TanStack Start + Vite, in `oreon/frontend`) now talks to the FastAPI
backend (`oreon/backend`) for **all** data. Mock arrays were removed and replaced
with React Query hooks.

## How it's wired

```
src/lib/api/
  client.ts      # fetch wrapper, base URL = VITE_API_URL (default http://localhost:8000)
  types.ts       # TS mirrors of the backend Pydantic schemas
  endpoints.ts   # one typed fn per backend route
  hooks.ts       # React Query hooks (useDashboard, useAssets, useInvestigate, ...)
src/lib/oreon-data.ts   # toUiAsset() adapter: backend AssetSummary -> UI Asset shape
```

| Route | Backend data source |
|-------|---------------------|
| `/command` | `GET /dashboard`, `GET /incidents` |
| `/assets` | `GET /assets` |
| `/assets/$id` | `GET /assets/{id}`, `GET /assets/{id}/impact` |
| `/alerts` | `GET /dashboard` (predicted failures + spare shortages) |
| `/twin` | `GET /assets` |
| `/simulator` | `GET /assets`, `POST /decision/scenario` |
| `/investigations` | `POST /investigate`, `GET /investigate/timeline` |
| `/decisions` | `GET /priority-assets`, `/business-risks`, `/maintenance-actions`, `/procurement-risks` |

### Notes / known gaps
- The backend exposes asset **state** (health, failure probability, RUL, status) but
  **no live per-sensor feed endpoint**. `temperature / vibration / load` shown in the
  UI are **derived deterministically** from real asset state in `toUiAsset()`. Wire
  them to a real sensor endpoint when one exists.
- `/app/ask` (Ask OREON chat) is still a demo — there is **no chat/LLM-ask endpoint**
  in the backend yet. Add one (e.g. `POST /ask`) and point the page at it.
- `/` (landing) and `/login` are static marketing/auth screens by design.

## Run locally

```bash
# backend (separate terminal) — see oreon/CLAUDE.md / SETUP.md
cd oreon/backend && uvicorn app.main:app --reload   # http://localhost:8000

# frontend
cd oreon/frontend
cp .env.example .env.local      # sets VITE_API_URL=http://localhost:8000
npm install --legacy-peer-deps  # (or: bun install)
npm run dev                     # vite dev server
```

---

## What you (the user) need to provide — deployment checklist

These are **backend-side** secrets. The frontend itself needs only `VITE_API_URL`
(no keys ship to the browser).

### Required
1. **PostgreSQL database** — the system of record (assets, incidents, spares, sensors).
   - Set `DATABASE_URL` in `oreon/backend/.env`.
   - **Supabase works perfectly**: create a project, copy the Postgres connection
     string (Settings → Database → Connection string → URI), and paste it as
     `DATABASE_URL`. Use the **session pooler** URI for serverless deploys.
   - Format: `postgresql://USER:PASSWORD@HOST:5432/DBNAME`
2. **Frontend → backend URL** — `VITE_API_URL` in `oreon/frontend/.env.local`
   (and in your host's env for prod, e.g. `https://api.your-domain.com`).

### Required for AI features (investigation explanations, decision narratives)
3. **Google Gemini API key** — `GEMINI_API_KEY` (backend). Get it from
   https://aistudio.google.com/apikey . Optional `GEMINI_MODEL` (default
   `gemini-1.5-flash`). Without it, deterministic engines still work; only the
   natural-language `llm_explanation` is skipped.

### Required for RAG / semantic evidence (manuals, SOPs)
4. **ChromaDB** (vector store) — runs locally via Docker, **no external key needed**.
   - `CHROMADB_HOST`, `CHROMADB_PORT` (default `localhost:8000`),
     `CHROMADB_PERSIST_DIR`. If you host Chroma elsewhere, point these at it.
   - Alternative if you prefer Supabase: enable the **pgvector** extension and store
     embeddings in the same Postgres — would require a small backend change.

### Optional
5. **Redis caching** — *not currently used by the codebase.* Add only if you
   introduce response caching / rate limiting / background jobs. If you want it, I can
   wire `fastapi-cache2` + Redis and you'd then provide a `REDIS_URL`
   (Upstash/Redis Cloud give a free `rediss://` URL).

### Summary of env vars to hand over
```
# backend (.env)
DATABASE_URL=postgresql://...        # REQUIRED  (Supabase or any Postgres)
GEMINI_API_KEY=...                   # for AI explanations
GEMINI_MODEL=gemini-1.5-flash        # optional
CHROMADB_HOST=localhost              # for RAG (local Docker by default)
CHROMADB_PORT=8000
# REDIS_URL=rediss://...             # optional, only if caching is added

# frontend (.env.local)
VITE_API_URL=http://localhost:8000   # REQUIRED
```
