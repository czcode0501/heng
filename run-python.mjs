import { spawn } from "node:child_process";
import { resolvePythonExecutable } from "./scripts/python-runtime.mjs";

const executable = resolvePythonExecutable();
const args = process.argv.slice(2);

if (!args.length) {
  console.error("Usage: node run-python.mjs <python arguments>");
  process.exit(2);
}

if (!executable) {
  console.error("No working Python interpreter was found. Re-run setup-windows.cmd, activate a valid .venv, or set QUANT_DESK_PYTHON to a Python 3 executable.");
  process.exit(1);
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
