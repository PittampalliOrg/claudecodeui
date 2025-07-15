// .dagger/src/index.ts
import { dag, Container, Directory, Secret, object, func } from "../sdk/index.js";

@object()
export class ClaudeCodeUI {
  /**
   * Build the Claude Code UI image and (optionally) push to GHCR.
   */
  @func()
  async buildClaudeUi(
    srcDir: Directory,
    tag = "latest",
    ghcrRepo?: string,
    ghcrToken?: Secret,
  ): Promise<Container> {
    /* ── Stage 1: build ───────────────────────────────────────────── */
    const builder = dag
      .container()
      .from("node:20-alpine")
      .withExec(["apk", "add", "--no-cache", "bash", "g++", "make", "python3"])
      .withWorkdir("/app")
      .withDirectory("/app", srcDir)
      .withExec(["npm", "ci"])
      .withExec(["npm", "run", "build"]);

    /* ── Stage 2: runtime ─────────────────────────────────────────── */
    let runtime = dag
      .container()
      .from("node:20-alpine")
      .withExec([
        "apk", "add", "--no-cache",
        "bash", "g++", "git", "make", "openssh-client", "python3", "wget",
      ])
      .withExec([
        "sh", "-c",
        "wget -q https://github.com/grafana/mcp-grafana/releases/download/v0.5.0/mcp-grafana_Linux_x86_64.tar.gz -O /tmp/mcp.tar.gz && " +
        "tar -xzf /tmp/mcp.tar.gz -C /tmp && mv /tmp/mcp-grafana /usr/local/bin/ && chmod +x /usr/local/bin/mcp-grafana",
      ])
      .withExec(["addgroup", "-g", "1001", "-S", "claude"])
      .withExec(["adduser", "-u", "1001", "-S", "claude", "-G", "claude"])
      .withWorkdir("/app")
      .withDirectory("/app", srcDir.withoutDirectory("node_modules").withoutDirectory("dist"))
      .withExec(["npm", "ci", "--omit=dev"])
      .withDirectory("/app/dist", builder.directory("/app/dist"))
      .withExec(["mkdir", "-p", "/home/claude/.claude/projects"])
      .withExec(["chown", "-R", "claude:claude", "/app", "/home/claude"])
      .withUser("claude")
      .withEnvVariable("NODE_ENV", "production")
      .withEnvVariable("PORT", "3001")
      .withEnvVariable("HOME", "/home/claude")
      .withEnvVariable("PATH", "/app/node_modules/.bin:${PATH}")
      .withEnvVariable("CLAUDE_CODE_ENABLE_TELEMETRY", "1")
      .withEnvVariable("OTEL_METRICS_EXPORTER", "otlp")
      .withEnvVariable("OTEL_LOGS_EXPORTER", "otlp")
      .withEnvVariable("OTEL_EXPORTER_OTLP_PROTOCOL", "grpc")
      .withEnvVariable("OTEL_EXPORTER_OTLP_ENDPOINT", "http://alloy.monitoring.svc.cluster.local:4317")
      .withEnvVariable("OTEL_SERVICE_NAME", "claude-code-ui")
      .withEnvVariable(
        "OTEL_RESOURCE_ATTRIBUTES",
        "service.namespace=default,deployment.environment=production,app.version=1.1.3",
      )
      .withExposedPort(3001)
      .withEntrypoint(["node", "server/index.js"]);

    /* ── Push only if creds provided ──────────────────────────────── */
    if (ghcrRepo && ghcrToken) {
      runtime = runtime.withRegistryAuth(ghcrRepo, "x-access-token", ghcrToken);
      await runtime.publish(`${ghcrRepo}:${tag}`);
    }

    return runtime;
  }
}