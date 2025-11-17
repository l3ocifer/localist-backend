# Deployment Guide

## Docker Image Build

The Docker image is configured to:
1. Install PostgreSQL client for migrations
2. Build TypeScript to JavaScript
3. Run database migrations on startup
4. Start the Node.js application

### Building the Image

```bash
docker build -t localist-backend:latest .
```

### Key Features

- **Automatic Migrations**: Runs database migrations on container startup
- **Health Checks**: Built-in health check endpoint at `/health`
- **Database Wait**: Waits for database to be ready before starting
- **Graceful Error Handling**: Migrations continue even if some are already applied

## Kubernetes Deployment

### Prerequisites

1. Database migrations run automatically on pod startup
2. Environment variables configured via ConfigMap and Secrets
3. Health checks configured for liveness/readiness/startup probes

### Configuration

**ConfigMap** (`k8s/base/configmap.yaml`):
- `RUN_MIGRATIONS=true` - Enable automatic migrations
- `PORT=3001` - Application port
- `NODE_ENV=production` - Environment

**Secrets** (`k8s/base/secret.yaml`):
- Database credentials (`DB_USER`, `DB_PASSWORD`)
- Redis password (`REDIS_PASSWORD`)
- JWT secrets
- Other sensitive configuration

### Deployment Steps

1. **Build and push image**:
   ```bash
   docker build -t k3d-registry.localhost:5555/localist-backend:latest .
   docker push k3d-registry.localhost:5555/localist-backend:latest
   ```

2. **Apply Kubernetes manifests**:
   ```bash
   kubectl apply -k k8s/base/
   ```

3. **Verify deployment**:
   ```bash
   kubectl get pods -n localist
   kubectl logs -n localist -l app=backend
   ```

### Health Checks

- **Liveness**: `/health` endpoint (checks every 30s)
- **Readiness**: `/health` endpoint (checks every 5s)
- **Startup**: `/health` endpoint (allows up to 5 minutes for startup)

### Ports

- **3001**: HTTP API
- **9090**: Metrics endpoint

## Environment Variables

Required environment variables:

```bash
# Database
DB_HOST=postgres-service
DB_PORT=5432
DB_NAME=localist
DB_USER=postgres
DB_PASSWORD=<from-secret>

# Redis
REDIS_HOST=redis-service
REDIS_PORT=6379
REDIS_PASSWORD=<from-secret>

# Application
PORT=3001
NODE_ENV=production
JWT_SECRET=<from-secret>
FRONTEND_URL=https://localist.leopaska.xyz

# Optional
RUN_MIGRATIONS=true  # Default: true
LOG_LEVEL=info
```

## Startup Sequence

1. Container starts
2. Waits for database connection (up to 60s timeout)
3. Runs database migrations (sorted by filename)
4. Starts Node.js application
5. Health check becomes ready

## Troubleshooting

### Migrations Fail

- Check database connectivity: `kubectl exec -it <pod> -- pg_isready -h $DB_HOST`
- Check migration logs: `kubectl logs -n localist <pod>`
- Migrations are idempotent - safe to rerun

### Health Check Fails

- Check application logs: `kubectl logs -n localist <pod>`
- Verify `/health` endpoint: `kubectl port-forward -n localist <pod> 3001:3001`
- Check database and Redis connectivity

### Redis Connection Issues

- Redis uses lazy connection - app starts even if Redis is unavailable
- Check Redis service: `kubectl get svc -n default | grep redis`
- Verify password in secrets

## Notes

- Migrations run automatically on every pod startup
- Migrations are safe to run multiple times (uses `IF NOT EXISTS`)
- Database connection timeout is 60 seconds
- Application will not start if database is unavailable

