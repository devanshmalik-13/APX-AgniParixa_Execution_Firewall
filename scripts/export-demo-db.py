"""Export one freshly run synthetic benchmark to a portable SQLite sample."""

from pathlib import Path
import hashlib
import json
import sqlite3


root = Path(__file__).resolve().parents[1]
state = root / ".wrangler" / "apx-db-verify" / "v3" / "d1" / "miniflare-D1DatabaseObject"
candidates = [item for item in state.glob("*.sqlite") if item.name != "metadata.sqlite"]
if len(candidates) != 1:
    raise SystemExit(f"Expected one synthetic D1 database in {state}; found {len(candidates)}")

target = root / "database" / "apx-seeded.sqlite"
if target.exists():
    raise SystemExit(f"Refusing to overwrite existing database: {target}")

with sqlite3.connect(f"file:{candidates[0].as_posix()}?mode=ro", uri=True) as source:
    prompts = source.execute("SELECT * FROM prompt_events ORDER BY rowid").fetchall()
    runs = source.execute("SELECT * FROM audit_runs ORDER BY rowid").fetchall()
    if len(prompts) != 16 or len(runs) != 16:
        raise SystemExit("Export requires one complete 16-case benchmark run")
    prompt_columns = [row[1] for row in source.execute("PRAGMA table_info(prompt_events)")]
    if any(row[prompt_columns.index("source")] != "benchmark" for row in prompts):
        raise SystemExit("Refusing to export non-benchmark prompt history")

    run_columns = [row[1] for row in source.execute("PRAGMA table_info(audit_runs)")]
    previous_hash = "GENESIS"
    for row in runs:
        values = dict(zip(run_columns, row))
        payload = {
            "id": values["id"],
            "promptId": values["prompt_id"],
            "timestamp": values["created_at"],
            "evaluation": json.loads(values["evaluation_json"]),
            "previousHash": previous_hash,
        }
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        digest = hashlib.sha256(encoded).hexdigest()
        if digest != values["receipt_hash"]:
            raise SystemExit(f"Receipt verification failed for run {values['id']}")
        previous_hash = digest

schema = (root / "database" / "apx-schema.sql").read_text(encoding="utf-8")
with sqlite3.connect(target) as output:
    output.executescript(schema)
    output.executemany(
        f"INSERT INTO prompt_events VALUES ({','.join('?' for _ in prompt_columns)})", prompts
    )
    output.executemany(
        f"INSERT INTO audit_runs VALUES ({','.join('?' for _ in run_columns)})", runs
    )
    if output.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise SystemExit("Exported SQLite integrity check failed")
    if output.execute("PRAGMA foreign_key_check").fetchall():
        raise SystemExit("Exported SQLite foreign-key check failed")

print(f"Exported {len(prompts)} synthetic prompts and {len(runs)} verified receipts to {target}")
