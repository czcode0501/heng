import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const virtualPython = process.platform === "win32"
  ? resolve(".venv", "Scripts", "python.exe")
  : resolve(".venv", "bin", "python");
const executable = existsSync(virtualPython)
  ? virtualPython
  : process.platform === "win32" ? "python" : "python3";
const args = process.argv.slice(2);

if (!args.length) {
  console.error("Usage: node run-python.mjs <python arguments>");
  process.exit(2);
}

const child = spawn(executable, args, {
  cwd: process.cwd(),
  stdio: "inherit",
  windowsHide: true,
});

child.on("error", (error) => {
  console.error(`Unable to start ${executable}: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Python exited after signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
