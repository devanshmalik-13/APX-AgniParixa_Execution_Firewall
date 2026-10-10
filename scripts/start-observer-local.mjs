import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = path.join(root, "services", "observer");
const python = path.join(directory, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
if (!existsSync(python)) throw new Error("Create services/observer/.venv and install its pinned requirements first. See services/observer/README.md.");
const modelKeys = ["piguard", "prompt-guard-22m", "prompt-guard-86m"];
const envFile = path.join(root, ".env.observer.local");
const env = {};
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
}
const key = process.env.OBSERVER_MODEL_KEY ?? env.OBSERVER_MODEL_KEY ?? "piguard";
if (!modelKeys.includes(key)) throw new Error("OBSERVER_MODEL_KEY must be piguard, prompt-guard-22m, or prompt-guard-86m.");
const token = env.OBSERVER_SERVICE_TOKEN ?? randomBytes(32).toString("hex");
if (!/^[A-Za-z0-9_-]{32,512}$/.test(token)) throw new Error("The ignored observer env file contains an invalid service token.");
const writeEntries = (file, entries) => {
  const existing = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean) : [];
  const kept = existing.filter((line) => !Object.keys(entries).some((name) => line.startsWith(`${name}=`)));
  writeFileSync(file, [...kept, ...Object.entries(entries).map(([name, value]) => `${name}=${value}`), ""].join("\n"), { mode: 0o600 });
};
writeEntries(envFile, { OBSERVER_SERVICE_TOKEN: token, OBSERVER_MODEL_KEY: key });
writeEntries(path.join(root, ".dev.vars"), { OBSERVER_URL: "http://127.0.0.1:8091", OBSERVER_TOKEN: token, OBSERVER_MODEL: key, OBSERVER_ALLOW_LOCAL: "true", OBSERVER_TIMEOUT_MS: "15000" });
console.log(`Starting ${key} on loopback port 8091. Local bearer credentials stay in ignored env files.`);
console.log("Restart the local app after changing the selected model. Hosted inference needs its own HTTPS service configuration.");
const child = spawn(python, ["-m", "observer_service"], {
  cwd: directory, stdio: "inherit", windowsHide: true,
  env: { ...process.env, ...env, OBSERVER_SERVICE_TOKEN: token, OBSERVER_MODEL_KEY: key, OBSERVER_DEVICE: process.env.OBSERVER_DEVICE ?? "cpu", OBSERVER_PRECISION: process.env.OBSERVER_PRECISION ?? "bfloat16", OBSERVER_CPU_THREADS: "2", HF_HOME: path.join(directory, ".models"), HF_HUB_DISABLE_XET: "1", HF_HUB_DISABLE_TELEMETRY: "1", HF_HUB_DISABLE_PROGRESS_BARS: "1", PYTHONUNBUFFERED: "1" },
});
child.on("error", () => { console.error("The observer process could not start. Check the isolated Python runtime."); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { child.kill(signal); });
