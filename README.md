# Personal Health & Training Tracker

A private, single-user health tracker that unifies Apple Watch data, powerlifting logs, food diary, and pantry into one private app.

See [docs/project-brief.md](docs/project-brief.md) for full project vision and architecture specifications.

## Architecture

This project is organized as an **npm workspaces** monorepo:

* **`shared/`**: Browser-safe domain logic and TypeScript types (readiness score math, 5-week block progression, allergy rules engine, points/step-debt ledger). Pure logic with zero Node or DOM dependencies.
* **`backend/`**: Fastify REST API running on Node/TS with SQLite (`better-sqlite3`). Handles health data ingestion, persistent database operations, and external food lookup APIs.
* **`frontend/`**: Dark-mode React + TypeScript Progressive Web App (PWA) bundled with Vite. Designed for iPhone with offline-first logging backed by IndexedDB.
* **`scripts/`**: Utility scripts (database seeding, backups).

## Requirements

* **Node.js**: >= 18.0.0
* **npm**: >= 7.0.0 (npm workspaces support)

## Getting Started

1. **Install dependencies across all workspaces:**
   ```bash
   npm install
   ```

2. **Run Backend (development):**
   ```bash
   npm run dev --workspace=backend
   ```

3. **Run Frontend (development):**
   ```bash
   npm run dev --workspace=frontend
   ```

4. **Build all packages:**
   ```bash
   npm run build
   ```

