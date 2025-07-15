import { connect, Container } from "@dagger.io/dagger";

/**
 * Build and optionally publish the Claude Code UI image to GHCR.
 *
 * @param srcDir     Project root on the host (default "..")
 * @param tag        Image tag to use (default "latest")
 * @param ghcrRepo   e.g. "ghcr.io/owner/repo"
 * @param ghcrToken  GitHub token with "packages:write"
 */
export async function buildClaudeUi(
  srcDir = "..",
  tag = "latest",
  ghcrRepo?: string,
  ghcrToken?: string,
) {
  const dag = await connect();

  /* ───── Stage 1: build the frontend ───── */
  const builder = dag
    .container()
    .from("node:20-alpine")
    .withExec(["apk", "add", "--no-cache", "bash", "g++", "make", "python3"])
    .withWorkdir("/app")
    .withDirectory("/app", dag.host().directory(srcDir, { exclude: ["node_modules"] }))
    .withExec(["npm", "ci"])
    .withExec(["npm", "run", "build"]);

  /* ───── Stage 2: runtime image ───── */
  let runtime: Container = dag
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
    .withDirectory("/app", dag.host().directory(srcDir, {
      include: ["package*.json", ".mcp.json", "server/**"],
    }))
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
    .withEnvVariable("OTEL_RESOURCE_ATTRIBUTES",
      "service.namespace=default,deployment.environment=production,app.version=1.1.3")
    .withExposedPort(3001)
    .withHealthcheck({
      interval: 30_000,
      timeout: 3_000,
      startPeriod: 40_000,
      retries: 3,
      test: ["CMD", "node", "-e",
        "require('http').get('http://localhost:3001/api/health',(r)=>process.exit(r.statusCode===200?0:1))"],
    })
    .withEntrypoint(["node", "server/index.js"]);

  /* ───── Publish to GHCR (only) ───── */
  if (ghcrRepo) {
    await runtime.publish(`${ghcrRepo}:${tag}`, {
      username: "x-access-token",
      password: ghcrToken,
    });
  }

  return runtime;       // useful if caller wants to export / scan the image
}
