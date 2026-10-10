# APX database

APX uses Cloudflare D1 (SQLite) through the `DB` binding. The application stores prompts in `prompt_events` and tool decisions/results in `audit_runs`. The final Drizzle schema is in [`db/schema.ts`](../db/schema.ts), with versioned migrations in [`drizzle/`](../drizzle/).

This directory includes:

- `apx-schema.sql` — portable, idempotent SQL for the current two-table schema.
- `apx-demo.sqlite` — a clean SQLite database with that schema and no private or fabricated audit events. Open it with any SQLite viewer.
- `apx-seeded.sqlite` — one real run of the 16-case synthetic attack bench, exported from an isolated local D1 instance with all receipt hashes verified. It contains no user or company data.

From a fresh clone, initialize the app's local D1 database:

```bash
npm ci
npm run build
npm run db:local:init
npm run dev
```

The `db:local:init` script executes the SQL against Wrangler's project-local D1 state at `.wrangler/state`. It is safe to repeat. The standalone `.sqlite` files are inspectable samples; the running app uses Wrangler's local D1 state, not either file directly. Start the app and click **Run 16-case attack bench** to create real, reproducible synthetic audit rows and receipts. Do not commit `.wrangler/state` or copy local audit history into this repository.

The populated sample is for offline review, not a replacement for the app's live D1 binding. Its 16 prompts and 16 associated runs came from the real gateway's benchmark route in a separate, fresh local state. The exporter in [`scripts/export-demo-db.py`](../scripts/export-demo-db.py) refuses to include non-benchmark history or a broken receipt chain.

For a real Cloudflare deployment, configure a D1 database as binding `DB` and apply the versioned migrations using the deployment environment. The placeholder ID in the local build config is not a production database ID.
