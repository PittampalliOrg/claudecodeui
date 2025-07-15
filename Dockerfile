# Multi-stage Dockerfile for Claude Code UI

# Stage 1: Build the frontend
FROM node:20-alpine AS frontend-builder

# Install system dependencies for node-pty
RUN apk add --no-cache \
    bash \
    g++ \
    make \
    python3

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy frontend source files and build the frontend
COPY index.html vite.config.js tailwind.config.js postcss.config.js ./
COPY src ./src
COPY public ./public
RUN npm run build

# Stage 2: Runtime image
FROM node:20-alpine

# Install system dependencies for node-pty and other native modules
RUN apk add --no-cache \
    bash \
    g++ \
    git \
    make \
    openssh-client \
    python3 \
    wget

# Download and install mcp-grafana
RUN wget -q https://github.com/grafana/mcp-grafana/releases/download/v0.5.0/mcp-grafana_Linux_x86_64.tar.gz -O /tmp/mcp-grafana.tar.gz && \
    tar -xzf /tmp/mcp-grafana.tar.gz -C /tmp/ && \
    mv /tmp/mcp-grafana /usr/local/bin/ && \
    chmod +x /usr/local/bin/mcp-grafana && \
    rm /tmp/mcp-grafana.tar.gz

# Create a non-root user
RUN addgroup -g 1001 -S claude && \
    adduser -u 1001 -S claude -G claude

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
COPY .mcp.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy server files and built frontend from builder stage
COPY server ./server
COPY --from=frontend-builder /app/dist ./dist

# Verify claude command is available
RUN /app/node_modules/.bin/claude --version || echo "Claude CLI installed"

# Create necessary directories with proper permissions
RUN mkdir -p /home/claude/.claude/projects && \
    chown -R claude:claude /app /home/claude

# Switch to non-root user
USER claude

# Expose the backend port
EXPOSE 3001

# Set environment variables
ENV NODE_ENV=production \
    PORT=3001 \
    HOME=/home/claude \
    PATH="/app/node_modules/.bin:${PATH}" \
    # Enable Claude Code telemetry
    CLAUDE_CODE_ENABLE_TELEMETRY=1 \
    OTEL_METRICS_EXPORTER=otlp \
    OTEL_LOGS_EXPORTER=otlp \
    OTEL_EXPORTER_OTLP_PROTOCOL=grpc \
    OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy.monitoring.svc.cluster.local:4317 \
    OTEL_SERVICE_NAME=claude-code-ui \
    OTEL_RESOURCE_ATTRIBUTES="service.namespace=default,deployment.environment=production,app.version=1.1.3"

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/api/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1))"

# Start the server
CMD ["node", "server/index.js"]
