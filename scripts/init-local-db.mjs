import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
if (!existsSync("dist/server/wrangler.json")) throw new Error("Run npm run build before initializing the local database.");
for (const schema of ["database/apx-schema.sql", "database/support-schema.sql"]) {
  const result = spawnSync(process.execPath, [wrangler, "d1", "execute", "DB", "--local", "--config", "dist/server/wrangler.json", "--persist-to", ".wrangler/state", "--file", schema, "--yes"], { stdio: "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false", CLOUDFLARE_CF_FETCH_ENABLED: "false" } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
