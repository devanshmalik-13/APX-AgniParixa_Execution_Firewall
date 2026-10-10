import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = path.join(root, "services", "observer");
const python = path.join(directory, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
if (!existsSync(python)) throw new Error("Create services/observer/.venv and install its pinned development requirements. See services/observer/README.md.");

// Run from the package directory so imports work regardless of the caller's cwd.
const child = spawn(python, ["-m", "pytest", "-q", ...process.argv.slice(2)], {
  cwd: directory, stdio: "inherit", windowsHide: true,
});
child.on("error", () => { console.error("The observer test process could not start. Check its isolated Python runtime."); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { child.kill(signal); });
