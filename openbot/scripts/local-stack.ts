#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Start the local stack without Docker.
 *
 * The repository's `scripts/start.sh` is the container-oriented path: it expects Docker for
 * Postgres and the computer, and it starts the server, worker and app around them. This is the
 * same stack for a machine that already has Bun and a local Postgres, which is what the local
 * OpenDuet evaluation runs on.
 *
 * It is intentionally a process supervisor, not a second server: every service is the real entry
 * point (`server/src/index.ts`, `worker/src/index.ts`, Vite, the agent computer), with the same
 * environment `.env` gives them. The only extra work here is migrations, health waits, log files
 * and PIDs so `local:down` can stop what `local:up` started.
 *
 * Postgres is deliberately not started here. A local Postgres is already a prerequisite for the
 * local mode, and guessing whether it is Docker, Homebrew, a Windows service or a remote URL is how
 * a launcher becomes a second deployment system. The migration step failing is the clear answer:
 * point DATABASE_URL at a running database.
 */

const root = join(import.meta.dir, "..");
const runDirectory = join(root, ".run");
const logDirectory = join(runDirectory, "logs");
const pidFile = join(runDirectory, "local-stack.json");

type StackProcess = {
  name: string;
  pid: number;
  log: string;
};

type StackFile = {
  startedAt: string | null;
  processes: StackProcess[];
};

type Environment = Record<string, string | undefined>;

function parseEnv(contents: string): Environment {
  const environment: Environment = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice(7) : line;
    const equals = withoutExport.indexOf("=");
    if (equals <= 0) continue;
    const key = withoutExport.slice(0, equals).trim();
    let value = withoutExport.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    environment[key] = value;
  }
  return environment;
}

async function loadEnvironment(): Promise<Environment> {
  let file: string;
  try {
    file = await readFile(join(root, ".env"), "utf8");
  } catch {
    throw new Error(
      "No .env found. Copy .env.example to .env and set DATABASE_URL and the model key first.",
    );
  }
  return { ...process.env, ...parseEnv(file) };
}

function portOf(
  environment: Environment,
  name: string,
  fallback: number,
): number {
  const raw = environment[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value <= 65_535
    ? value
    : fallback;
}

function appPort(environment: Environment): number {
  const configured = environment.APP_PORT?.trim();
  if (configured) return portOf(environment, "APP_PORT", 3110);
  try {
    const url = new URL(environment.OPENBOT_APP_URL ?? "http://localhost:3110");
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    return Number.isInteger(port) && port > 0 ? port : 3110;
  } catch {
    return 3110;
  }
}

async function healthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitFor(
  label: string,
  url: string,
  timeoutMs = 45_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await healthy(url)) return;
    await Bun.sleep(500);
  }
  throw new Error(
    `${label} did not become healthy at ${url} within ${timeoutMs}ms.`,
  );
}

/**
 * Start a service detached, with its output written straight to its own log file.
 *
 * `local:up` exits as soon as the stack is healthy, so the service must not be a child whose
 * lifetime is tied to the launcher. Node's `detached` plus `unref` is the portable way to ask for
 * that, and a real file descriptor on the child's stdout keeps the log alive after this process is
 * gone. A pipe would close the moment the launcher left.
 */
async function start(
  name: string,
  command: string[],
  cwd: string,
  environment: Environment,
): Promise<StackProcess> {
  const log = join(logDirectory, `${name}.log`);
  const executable = command[0];
  if (!executable) throw new Error(`${name} has no command to run.`);
  await writeFile(log, "");
  const fd = openSync(log, "a");
  try {
    const child = spawn(executable, command.slice(1), {
      cwd,
      env: environment,
      detached: true,
      stdio: ["ignore", fd, fd],
      windowsHide: true,
    });
    if (!child.pid) {
      throw new Error(`${name} did not start.`);
    }
    child.unref();
    return { name, pid: child.pid, log };
  } finally {
    closeSync(fd);
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readStackFile(): Promise<StackFile | null> {
  try {
    return JSON.parse(await readFile(pidFile, "utf8")) as StackFile;
  } catch {
    return null;
  }
}

function stop(pid: number): void {
  try {
    if (process.platform === "win32") {
      Bun.spawnSync({
        cmd: ["taskkill", "/PID", String(pid), "/T", "/F"],
        stdout: "ignore",
        stderr: "ignore",
      });
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    // Already gone, or not ours. Either way there is nothing left to stop.
  }
}

async function up(): Promise<void> {
  const environment = await loadEnvironment();
  if (environment.OPENBOT_LOCAL_MODE?.trim().toLowerCase() !== "true") {
    throw new Error(
      "OPENBOT_LOCAL_MODE must be true for the local stack. This launcher is for the no-Intelligence path.",
    );
  }
  await mkdir(logDirectory, { recursive: true });

  const serverPort = portOf(environment, "PORT", 3101);
  const computerPort = (() => {
    try {
      const url = new URL(
        environment.AGENT_COMPUTER_URL ?? "http://127.0.0.1:4100",
      );
      return Number(url.port || 80);
    } catch {
      return 4100;
    }
  })();
  const serverUrl = `http://127.0.0.1:${serverPort}`;
  const computerUrl = `http://127.0.0.1:${computerPort}`;
  const appUrl = `http://127.0.0.1:${appPort(environment)}`;
  const processes: StackProcess[] = [];
  const previous = await readStackFile();
  const previousByName = new Map(
    previous?.processes.map((entry) => [entry.name, entry]) ?? [],
  );

  const record = (entry: StackProcess): void => {
    processes.push(entry);
    console.info(
      `[local] ${entry.name} starting as pid ${entry.pid}; log ${entry.log}`,
    );
  };

  try {
    // One idempotent migration pass. It is also the first honest Postgres check.
    const migration = Bun.spawnSync({
      cmd: [process.execPath, "--env-file=../.env", "scripts/migrate.ts"],
      cwd: join(root, "server"),
      env: environment,
      stdout: "inherit",
      stderr: "inherit",
    });
    if (migration.exitCode !== 0) {
      throw new Error(
        "Database migrations failed. Check that DATABASE_URL points at a running PostgreSQL and that it is migrated.",
      );
    }

    if (!(await healthy(`${computerUrl}/health`))) {
      record(
        await start(
          "computer",
          [process.execPath, "--env-file=../.env", "src/index.ts"],
          join(root, "agent-computer"),
          {
            ...environment,
            /*
             * The computer reads `PORT`, and the shared `.env` reserves that name for the API
             * server. Without this override it binds the server's port and the launcher waits for
             * a health check on a port nothing is listening to.
             */
            PORT: String(computerPort),
            PROFILES_DIR: environment.PROFILES_DIR
              ? resolve(root, environment.PROFILES_DIR)
              : join(runDirectory, "profiles"),
            WORKSPACE_DIR: environment.WORKSPACE_DIR
              ? resolve(root, environment.WORKSPACE_DIR)
              : join(runDirectory, "workspace"),
            EGRESS_POLICY_REQUIRED:
              environment.EGRESS_POLICY_REQUIRED ?? "0",
            AGENT_COMPUTER_ALLOW_PRIVATE_HOSTS:
              environment.AGENT_COMPUTER_ALLOW_PRIVATE_HOSTS ?? "true",
          },
        ),
      );
      await waitFor("agent computer", `${computerUrl}/health`);
    } else {
      console.info(`[local] computer already healthy at ${computerUrl}`);
    }

    if (!(await healthy(`${serverUrl}/health`))) {
      record(
        await start(
          "server",
          [process.execPath, "--env-file=../.env", "src/index.ts"],
          join(root, "server"),
          environment,
        ),
      );
      await waitFor("server", `${serverUrl}/health`);
    } else {
      console.info(`[local] server already healthy at ${serverUrl}`);
    }

    const priorWorker = previousByName.get("worker");
    if (!priorWorker || !isAlive(priorWorker.pid)) {
      record(
        await start("worker", [process.execPath, "worker/src/index.ts"], root, {
          ...environment,
          SERVER_INTERNAL_URL: serverUrl,
          WORKER_SHARED_SECRET:
            environment.WORKER_SHARED_SECRET?.trim() ||
            "openbot-local-worker-secret",
          OPENBOT_LOCAL_MODE: "true",
        }),
      );
    } else {
      console.info(`[local] worker already running as pid ${priorWorker.pid}`);
    }

    if (!(await healthy(appUrl))) {
      record(
        await start(
          "app",
          [
            process.execPath,
            "--bun",
            "node_modules/vite/bin/vite.js",
            "--port",
            String(appPort(environment)),
            "--strictPort",
          ],
          join(root, "app"),
          environment,
        ),
      );
      await waitFor("app", appUrl);
    } else {
      console.info(`[local] app already healthy at ${appUrl}`);
    }

    const stack: StackFile = {
      startedAt: new Date().toISOString(),
      processes: [
        ...(previous?.processes.filter(
          (entry) =>
            isAlive(entry.pid) &&
            !processes.some((next) => next.name === entry.name),
        ) ?? []),
        ...processes,
      ],
    };
    await writeFile(pidFile, JSON.stringify(stack, null, 2));
    console.info(`[local] up: ${appUrl} (server ${serverUrl})`);
  } catch (error) {
    for (const entry of processes) stop(entry.pid);
    throw error;
  }
}

async function down(): Promise<void> {
  const stack = await readStackFile();
  if (!stack || stack.processes.length === 0) {
    console.info("[local] nothing recorded as started by local:up");
    return;
  }
  for (const entry of stack.processes) {
    if (!isAlive(entry.pid)) {
      console.info(
        `[local] ${entry.name} (pid ${entry.pid}) was already stopped`,
      );
      continue;
    }
    stop(entry.pid);
    console.info(`[local] ${entry.name} (pid ${entry.pid}) stopped`);
  }
  await writeFile(
    pidFile,
    JSON.stringify({ startedAt: null, processes: [] }, null, 2),
  );
}

async function status(): Promise<void> {
  const environment = await loadEnvironment();
  const serverPort = portOf(environment, "PORT", 3101);
  const appPortNumber = appPort(environment);
  const computerPort = (() => {
    try {
      return Number(
        new URL(environment.AGENT_COMPUTER_URL ?? "http://127.0.0.1:4100")
          .port || 4100,
      );
    } catch {
      return 4100;
    }
  })();
  const stack = await readStackFile();
  const worker = stack?.processes.find((entry) => entry.name === "worker");
  const rows = [
    [
      "server",
      `http://127.0.0.1:${serverPort}/health`,
      await healthy(`http://127.0.0.1:${serverPort}/health`),
    ],
    [
      "computer",
      `http://127.0.0.1:${computerPort}/health`,
      await healthy(`http://127.0.0.1:${computerPort}/health`),
    ],
    [
      "app",
      `http://127.0.0.1:${appPortNumber}`,
      await healthy(`http://127.0.0.1:${appPortNumber}`),
    ],
    [
      "worker",
      worker ? `pid ${worker.pid}` : "not recorded",
      worker ? isAlive(worker.pid) : false,
    ],
  ] as const;
  for (const [name, detail, ok] of rows) {
    console.info(`${ok ? "ok  " : "down"} ${name.padEnd(9)} ${detail}`);
  }
}

const command = process.argv[2] ?? "up";
if (command === "up") {
  await up();
  process.exit(0);
} else if (command === "down") {
  await down();
  process.exit(0);
} else if (command === "status") {
  await status();
  process.exit(0);
} else {
  console.error("Usage: bun scripts/local-stack.ts [up|down|status]");
  process.exit(1);
}
