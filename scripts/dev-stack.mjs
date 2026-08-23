import { spawn } from "node:child_process";

const children = new Set();
let stopping = false;

const commands = {
  "dev:api": [process.execPath, ["run-python.mjs", "api_server.py"]],
  "dev:web": [process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"]],
};

function start(script, label) {
  const [executable, args] = commands[script];
  const child = spawn(executable, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    windowsHide: true,
  });
  children.add(child);
  child.on("error", (error) => {
    console.error(`${label} failed to start: ${error.message}`);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (!stopping) {
      console.error(`${label} stopped unexpectedly${signal ? ` (${signal})` : ` (code ${code ?? 1})`}.`);
      stop(code ?? 1);
    }
  });
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 250).unref();
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
process.on("exit", () => {
  for (const child of children) child.kill("SIGTERM");
});

start("dev:api", "Data API");
start("dev:web", "Web app");
