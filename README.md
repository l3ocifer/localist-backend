# Localist Backend API

**Express.js TypeScript service for the Localist platform**

[![Live Production](https://img.shields.io/badge/Live-Production-success)](https://localist.leopaska.xyz/api)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-K3s-326ce5)](https://k3s.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

## 🎯 Overview

The Localist Backend is a production-ready Express.js API service that powers the Localist local discovery platform. It provides RESTful endpoints for venue discovery, user management, list creation, and AI-powered recommendations.

### Key Features

- 🔐 **JWT Authentication** - Secure user authentication and authorization
- 🏪 **Venue Management** - CRUD operations for 1,600+ venues across 5 cities
- 📝 **List Curation** - 80 curated lists + custom user lists
- 🔍 **Search & Filters** - Advanced search with multiple criteria
- 🤖 **Agent System** - Hunter/Archivist/Curator agents for data processing
- 📊 **Analytics** - Request metrics and health monitoring
- 🚀 **High Performance** - Redis caching, connection pooling, compression

## 🏗️ Technology Stack

- **Runtime:** Node.js 20+
- **Framework:** Express.js 4.18
- **Language:** TypeScript 5.0
- **Database:** PostgreSQL 15
- **Cache:** Redis 7
- **Authentication:** JWT + bcrypt
- **Validation:** express-validator
- **Security:** Helmet, CORS, rate-limit
- **Monitoring:** Prometheus metrics, Winston logging

## 🚀 Quick Start

### Prerequisites

- Node.js 20+ and npm 10+
- PostgreSQL 15+
- Redis 7+
- (Optional) Docker and Kubernetes

### Local Development

```bash
# Clone the repository
git clone https://github.com/l3ocifer/localist-backend.git
cd localist-backend

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Initialize database
psql -U postgres -c "CREATE DATABASE localist;"
psql -U postgres -d localist -f database/migrations/001_initial_schema.sql

# Generate seed data
npm run db:generate-seed

# Seed database
npm run db:seed

# Start development server
npm run dev
```

The API will be available at `http://localhost:3002`

### Production Deployment

```bash
# Build Docker image
docker build -t localist/backend:latest .

# Deploy to Kubernetes
kubectl apply -k k8s/base/

# Check deployment status
kubectl get pods -n localist
```

## 📚 API Documentation

Full API documentation is available in [API_DOCUMENTATION.md](./API_DOCUMENTATION.md)

### Base URL

- **Development:** `http://localhost:3002`
- **Production:** `https://localist.leopaska.xyz/api`

### Authentication

```bash
# Register new user
POST /api/auth/register
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "first_name": "John",
  "last_name": "Doe"
}

# Login
POST /api/auth/login
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

### Core Endpoints

```
GET    /api/cities                 # List all cities
GET    /api/cities/:id/lists       # Get city's curated lists
GET    /api/venues                 # Browse venues with filters
GET    /api/lists/:id              # List details with venues
GET    /api/search                 # Search venues
POST   /api/user/lists             # Create custom list
GET    /api/user/favorites         # Get saved venues
```

## 🔧 Configuration

### Environment Variables

```bash
# Application
NODE_ENV=production
PORT=3001

# Database
DATABASE_URL=postgresql://user:password@host:5432/localist
DB_NAME=localist
DB_HOST=postgres-service
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=<your-password>

# Redis
REDIS_URL=redis://host:6379
REDIS_HOST=redis-service
REDIS_PORT=6379
REDIS_PASSWORD=<your-password>

# Authentication
JWT_SECRET=<generate-with-openssl>
REFRESH_TOKEN_SECRET=<generate-with-openssl>

# CORS
FRONTEND_URL=https://localist.leopaska.xyz
CORS_ORIGIN=https://localist.leopaska.xyz

# Monitoring
LOG_LEVEL=info
```

Generate secrets:
```bash
openssl rand -base64 32
```

## 🗄️ Database Management

### Migrations

```bash
# Run migrations
npm run migrate

# Create new migration
npm run migrate create <migration-name>
```

### Seeding

```bash
# Generate comprehensive seed data (1600 venues, 80 lists)
npm run db:generate-seed

# Seed database
npm run db:seed

# Reset and reseed
npm run db:reset
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Type checking
npm run typecheck

# Linting
npm run lint
```

## 📊 Monitoring & Health

### Health Endpoint

```bash
curl https://localist.leopaska.xyz/api/health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2025-10-21T12:00:00.000Z",
  "environment": "production",
  "metrics": {
    "totalRequests": 1523,
    "activeConnections": 12,
    "averageResponseTime": 145
  }
}
```

### Metrics Endpoint

```bash
curl https://localist.leopaska.xyz/api/metrics
```

Prometheus-compatible metrics available on port 9090.

## 🏗️ Project Structure

```
localist-backend/
├── src/
│   ├── agents/          # Hunter/Archivist/Curator agents
│   ├── routes/          # API route handlers
│   ├── services/        # Business logic
│   ├── middleware/      # Auth, security, validation
│   ├── config/          # Configuration
│   ├── types/           # TypeScript types
│   ├── utils/           # Utilities
│   ├── app.ts           # Express app setup
│   └── index.ts         # Server entry point
├── database/
│   └── migrations/      # SQL migrations
├── data/                # Seed data
├── scripts/             # Build & deployment scripts
├── tests/               # Test files
├── k8s/                 # Kubernetes manifests
└── dist/                # Build output
```

## 🔐 Security

- JWT-based authentication with httpOnly cookies
- Bcrypt password hashing (10 rounds)
- Rate limiting (100 requests per 15 minutes)
- Helmet.js security headers
- CORS configuration
- Input validation with express-validator
- SQL injection protection via parameterized queries
- Kubernetes secrets for credential management

## 🚢 Deployment

### Docker

```bash
# Build
docker build -t localist/backend:v1.0.0 .

# Run
docker run -p 3001:3001 \
  -e DATABASE_URL=postgresql://... \
  -e REDIS_URL=redis://... \
  localist/backend:v1.0.0
```

### Kubernetes

```bash
# Apply configuration
kubectl apply -k k8s/base/

# Update deployment
kubectl set image deployment/backend backend=localist/backend:v1.0.0 -n localist

# Check status
kubectl rollout status deployment/backend -n localist

# View logs
kubectl logs -n localist -l app=backend --tail=50
```

## 🤝 Contributing

This repository is part of the Localist platform. For frontend contributions, see [localist-frontend](https://github.com/l3ocifer/localist-frontend).

### Development Workflow

1. Create feature branch: `git checkout -b feature/amazing-feature`
2. Make changes and add tests
3. Ensure all tests pass: `npm test`
4. Commit: `git commit -m 'Add amazing feature'`
5. Push: `git push origin feature/amazing-feature`
6. Create Pull Request

### API Contract

Changes to API endpoints must:
- Be documented in API_DOCUMENTATION.md
- Include migration guide for breaking changes
- Be reviewed by frontend team
- Follow semantic versioning

See [SHARED_TYPES.md](./SHARED_TYPES.md) for the contract between frontend and backend.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Related Repositories

- **Frontend:** [localist-frontend](https://github.com/l3ocifer/localist-frontend)
- **Original Monorepo (archived):** [localist](https://github.com/l3ocifer/localist)

## 📞 Contact & Support

- **Live API:** [localist.leopaska.xyz/api](https://localist.leopaska.xyz/api)
- **Issues:** [GitHub Issues](https://github.com/l3ocifer/localist-backend/issues)
- **Documentation:** [API Documentation](./API_DOCUMENTATION.md)

---

**Built with ❤️ for the Localist Platform**

