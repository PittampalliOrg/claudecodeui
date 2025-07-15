# Claude Code UI - Deployment Guide

This guide covers containerizing and deploying the Claude Code UI application to Kubernetes.

## Overview

The application has been containerized using Docker and configured for deployment to Kubernetes with the following features:

- Multi-stage Docker build for optimized images
- Kubernetes manifests for deployment, service, ingress, and storage
- GitHub Actions workflows for automated CI/CD
- WebSocket support for real-time communication
- Persistent storage for Claude projects

## Prerequisites

- Docker installed locally for building images
- Kubernetes cluster (local or cloud-based)
- kubectl CLI configured to access your cluster
- GitHub repository with Actions enabled
- Container registry access (GitHub Container Registry is configured by default)

## Local Development with Docker

### Building the Docker Image

```bash
# Build the image
docker build -t claude-code-ui:latest .

# Or use docker-compose
docker-compose build
```

### Running Locally with Docker Compose

```bash
# Start the container
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the container
docker-compose down
```

The application will be available at http://localhost:3008

**Note**: The Claude CLI must be installed on the host system or included in the Docker image. By default, it's commented out in the Dockerfile to speed up builds during development.

## Kubernetes Deployment

### 1. Prepare Your Cluster

Ensure you have:
- An ingress controller installed (e.g., nginx-ingress)
- A storage class available for persistent volumes
- Proper RBAC permissions

### 2. Update Configuration

Before deploying, update the following files:

**k8s/ingress.yaml**:
- Change `claude-code-ui.example.com` to your actual domain
- Uncomment TLS section if using HTTPS

**k8s/pvc.yaml**:
- Update `storageClassName` to match your cluster's storage class

**k8s/deployment.yaml**:
- Update the image repository if not using local images

### 3. Deploy to Kubernetes

```bash
# Create namespace (optional)
kubectl create namespace claude-code-ui

# Apply all manifests
kubectl apply -f k8s/

# Or apply individually
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/pvc.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml

# Check deployment status
kubectl get pods -l app=claude-code-ui
kubectl get svc claude-code-ui
kubectl get ingress claude-code-ui
```

### 4. Verify Deployment

```bash
# Check pod logs
kubectl logs -l app=claude-code-ui

# Test health endpoint
kubectl port-forward svc/claude-code-ui 8080:80
curl http://localhost:8080/api/health

# Check persistent volume
kubectl describe pvc claude-projects-pvc
```

## GitHub Actions CI/CD

### Build Workflow

The build workflow (`.github/workflows/build.yml`) automatically:
- Builds Docker images on push to main/develop branches
- Pushes images to GitHub Container Registry
- Runs security scanning with Trivy
- Tags images with branch name and commit SHA

### Deploy Workflow

The deploy workflow (`.github/workflows/deploy.yml`) can be:
- Manually triggered via GitHub Actions UI
- Automatically triggered on version tags (v*)

To use the workflows:

1. **Set up secrets in your GitHub repository**:
   - `KUBE_CONFIG`: Base64-encoded kubeconfig file for cluster access
   ```bash
   cat ~/.kube/config | base64 | pbcopy  # macOS
   cat ~/.kube/config | base64 | xclip    # Linux
   ```

2. **Deploy manually**:
   - Go to Actions → Deploy to Kubernetes
   - Click "Run workflow"
   - Select environment and image tag

3. **Deploy on tag**:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

## Production Considerations

### Security

1. **Run as non-root user**: Already configured in Dockerfile
2. **Network policies**: Consider adding Kubernetes NetworkPolicies
3. **Secrets management**: Use Kubernetes secrets for sensitive data
4. **Image scanning**: Enabled in CI/CD pipeline

### Scaling

1. **Horizontal Pod Autoscaling**:
   ```yaml
   apiVersion: autoscaling/v2
   kind: HorizontalPodAutoscaler
   metadata:
     name: claude-code-ui
   spec:
     scaleTargetRef:
       apiVersion: apps/v1
       kind: Deployment
       name: claude-code-ui
     minReplicas: 1
     maxReplicas: 10
     metrics:
     - type: Resource
       resource:
         name: cpu
         target:
           type: Utilization
           averageUtilization: 70
   ```

2. **Session Affinity**: Already configured in service for WebSocket connections

### Monitoring

Consider adding:
- Prometheus metrics endpoint
- Grafana dashboards
- Application performance monitoring (APM)
- Log aggregation (ELK/Loki)

### Backup

For production use:
1. Regularly backup the persistent volume data
2. Consider using volume snapshots
3. Test restore procedures

## Troubleshooting

### Common Issues

1. **Pod not starting**:
   ```bash
   kubectl describe pod <pod-name>
   kubectl logs <pod-name> --previous
   ```

2. **WebSocket connection issues**:
   - Check ingress annotations for WebSocket support
   - Verify session affinity is enabled
   - Check proxy timeout settings

3. **Permission errors**:
   - Ensure the container runs as user 1001
   - Check PVC permissions and ownership

4. **Claude CLI not found**:
   - Install Claude CLI in the Docker image (uncomment in Dockerfile)
   - Or mount from host system via volume

### Debug Commands

```bash
# Get into a running container
kubectl exec -it <pod-name> -- /bin/bash

# Check environment variables
kubectl exec <pod-name> -- env | grep -E "PORT|NODE_ENV"

# Test internal connectivity
kubectl run debug --rm -it --image=alpine -- sh
```

## Updating the Application

1. **Build new image**:
   ```bash
   docker build -t claude-code-ui:v1.0.1 .
   ```

2. **Push to registry** (if using remote registry):
   ```bash
   docker push your-registry/claude-code-ui:v1.0.1
   ```

3. **Update deployment**:
   ```bash
   kubectl set image deployment/claude-code-ui claude-code-ui=your-registry/claude-code-ui:v1.0.1
   ```

4. **Monitor rollout**:
   ```bash
   kubectl rollout status deployment/claude-code-ui
   ```

## Clean Up

To remove the deployment:

```bash
# Delete all resources
kubectl delete -f k8s/

# Or delete individually
kubectl delete ingress claude-code-ui
kubectl delete svc claude-code-ui
kubectl delete deployment claude-code-ui
kubectl delete pvc claude-projects-pvc
kubectl delete configmap claude-code-ui-config
```

## Additional Resources

- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Docker Documentation](https://docs.docker.com/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Claude Code CLI Documentation](https://docs.anthropic.com/en/docs/claude-code)