/**
 * Dagger module for building and pushing Claude Code UI container images
 */
import { dag, Directory, object, func, Secret } from "@dagger.io/dagger"

@object()
export class Claudecodeui {
  /**
   * Build the Vite application and create a container image
   */
  @func()
  async buildAndPush(
    source: Directory,
    registry: string,
    imageName: string,
    tags: string,
    registryUsername: string,
    registryPassword: Secret,
  ): Promise<string> {
    // Convert image name to lowercase as required by Docker registries
    const lowerImageName = imageName.toLowerCase()
    
    // Parse comma-separated tags and extract just the tag portion
    const tagList = tags.split(',').map(tag => {
      // Extract just the tag part after the last colon
      const parts = tag.trim().split(':')
      return parts[parts.length - 1]
    }).filter(tag => tag.length > 0)
    
    // Build stage: Build the Vite application
    const buildContainer = dag.container()
      .from("node:20-alpine")
      // Install Python and build dependencies for native modules
      .withExec(["apk", "add", "--no-cache", "python3", "make", "g++", "py3-pip"])
      .withDirectory("/app", source)
      .withWorkdir("/app")
      .withExec(["npm", "ci", "--prefer-offline", "--no-audit"])
      .withExec(["npm", "run", "build"])
    
    // Get the built dist directory
    const distDir = buildContainer.directory("/app/dist")
    
    // Production stage: Create a lightweight container with nginx
    let productionContainer = dag.container()
      .from("nginx:alpine")
      .withDirectory("/usr/share/nginx/html", distDir)
      .withExec(["rm", "/etc/nginx/conf.d/default.conf"])
      .withNewFile("/etc/nginx/conf.d/default.conf", `server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;
    
    # Enable gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    
    # Handle client-side routing
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    # API proxy (if needed in production)
    location /api {
        proxy_pass http://backend:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
    
    # WebSocket proxy (if needed in production)
    location /ws {
        proxy_pass http://backend:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}`)
      .withExposedPort(80)
    
    // Add labels
    productionContainer = productionContainer
      .withLabel("org.opencontainers.image.source", `https://github.com/${lowerImageName}`)
      .withLabel("org.opencontainers.image.description", "Claude Code UI - A web-based UI for Claude Code CLI")
    
    // Login to registry
    productionContainer = productionContainer.withRegistryAuth(
      registry,
      registryUsername,
      registryPassword
    )
    
    // Push with all tags
    const results: string[] = []
    for (const tag of tagList) {
      const fullTag = `${registry}/${lowerImageName}:${tag}`
      const pushed = await productionContainer.publish(fullTag)
      results.push(pushed)
    }
    
    return results.join('\n')
  }
}