import { spawn } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SandboxConfig {
  /** Container name — reused across runs so the session is persistent. */
  name: string;
  /** Image to run. Must contain bash + coreutils. */
  image?: string;
  /** Working directory inside the container. */
  workdir?: string;
}

function dockerRun(args: string[], stdin?: string): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({ stdout, stderr, exitCode: code ?? -1 }),
    );

    if (stdin !== undefined) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

/**
 * A persistent Docker container the engineering worker operates inside.
 *
 * The container is the resource binding: filesystem + bash live here, isolated
 * from the host. `start()` is idempotent — it reuses an existing container so
 * the session survives across worker runs.
 */
export class DockerSandbox {
  /** Container name. Per-agent, so it doubles as the worker's git branch name. */
  readonly name: string;
  private readonly image: string;
  readonly workdir: string;

  constructor(config: SandboxConfig) {
    this.name = config.name;
    this.image = config.image ?? "node:24-slim";
    this.workdir = config.workdir ?? "/workspace";
  }

  /** Create or resume the container. Idempotent. */
  async start(): Promise<void> {
    const inspect = await dockerRun([
      "ps",
      "-a",
      "--filter",
      `name=^/${this.name}$`,
      "--format",
      "{{.State}}",
    ]);

    const state = inspect.stdout.trim();

    if (state === "running") return;

    if (state === "exited" || state === "created" || state === "paused") {
      const started = await dockerRun(["start", this.name]);
      if (started.exitCode !== 0) {
        throw new Error(`failed to resume sandbox: ${started.stderr}`);
      }
      return;
    }

    const created = await dockerRun([
      "run",
      "-d",
      "--name",
      this.name,
      "-w",
      this.workdir,
      this.image,
      "sleep",
      "infinity",
    ]);

    if (created.exitCode !== 0) {
      throw new Error(`failed to start sandbox: ${created.stderr}`);
    }

    await this.exec(`mkdir -p "${this.workdir}"`);
  }

  /** Run a bash command inside the container. */
  async exec(command: string, cwd: string = this.workdir): Promise<ExecResult> {
    return this.sh(command, undefined, cwd);
  }

  async readFile(path: string): Promise<string> {
    const result = await this.sh(`cat -- "${path}"`);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `cannot read ${path}`);
    }
    return result.stdout;
  }

  async writeFile(path: string, content: string): Promise<void> {
    const dir = path.includes("/")
      ? path.slice(0, path.lastIndexOf("/")) || "/"
      : ".";

    await this.exec(`mkdir -p "${dir}"`);

    const result = await this.sh(`cat > "${path}"`, content);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `cannot write ${path}`);
    }
  }

  /** Stop the container without deleting it (session can be resumed). */
  async stop(): Promise<void> {
    await dockerRun(["stop", this.name]);
  }

  /** Delete the container entirely. */
  async remove(): Promise<void> {
    await dockerRun(["rm", "-f", this.name]);
  }

  private sh(
    command: string,
    stdin?: string,
    cwd: string = this.workdir,
  ): Promise<ExecResult> {
    const args = ["exec"];
    if (stdin !== undefined) {
      args.push("-i");
    }
    args.push("-w", cwd, this.name, "bash", "-lc", command);
    return dockerRun(args, stdin);
  }
}
