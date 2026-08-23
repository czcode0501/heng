import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const virtualPython = process.platform === "win32"
  ? resolve(".venv", "Scripts", "python.exe")
  : resolve(".venv", "bin", "python");

export function canRunPython(executable) {
  if (!executable || (executable === virtualPython && !existsSync(executable))) return false;
  const probe = spawnSync(executable, ["--version"], { windowsHide: true, encoding: "utf8" });
  return !probe.error && probe.status === 0;
}

export function resolvePythonExecutable() {
  const configured = process.env.QUANT_DESK_PYTHON?.trim();
  const systemPython = process.platform === "win32" ? "python" : "python3";
  return [configured, virtualPython, systemPython].find(canRunPython) || "";
}
