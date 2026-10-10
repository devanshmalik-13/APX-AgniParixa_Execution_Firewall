"""Create a clean, inspectable APX SQLite sample from the committed schema."""

from pathlib import Path
import sqlite3


root = Path(__file__).resolve().parents[1]
schema = (root / "database" / "apx-schema.sql").read_text(encoding="utf-8")
target = root / "database" / "apx-demo.sqlite"

if target.exists():
    raise SystemExit(f"Refusing to overwrite existing database: {target}")

with sqlite3.connect(target) as db:
    db.executescript(schema)
    if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise SystemExit("SQLite integrity check failed")

print(f"Created {target} with an empty APX schema. Run the attack bench to generate genuine audit records.")
