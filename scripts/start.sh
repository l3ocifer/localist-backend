#!/bin/sh
set -e

echo "🚀 Starting Localist Backend..."

# Wait for database to be ready (with timeout)
echo "⏳ Waiting for database connection..."
TIMEOUT=60
ELAPSED=0
until pg_isready -h "${DB_HOST:-localhost}" -p "${DB_PORT:-5432}" -U "${DB_USER:-postgres}" 2>/dev/null; do
  if [ $ELAPSED -ge $TIMEOUT ]; then
    echo "❌ Database connection timeout after ${TIMEOUT}s"
    exit 1
  fi
  echo "Database is unavailable - sleeping (${ELAPSED}s/${TIMEOUT}s)"
  sleep 2
  ELAPSED=$((ELAPSED + 2))
done
echo "✅ Database is ready"

# Run database migrations if enabled
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "📋 Running database migrations..."
  cd /app/database
  
  # Run migrations in order (sorted by filename)
  for migration in $(ls -1 migrations/*.sql 2>/dev/null | sort); do
    if [ -f "$migration" ]; then
      echo "Applying migration: $(basename "$migration")"
      # Use ON_ERROR_STOP=off to continue on errors (e.g., if migration already applied)
      PGPASSWORD="${DB_PASSWORD}" psql \
        -h "${DB_HOST:-localhost}" \
        -p "${DB_PORT:-5432}" \
        -U "${DB_USER:-postgres}" \
        -d "${DB_NAME:-localist}" \
        -v ON_ERROR_STOP=off \
        -f "$migration" 2>&1 | grep -v "already exists" | grep -v "does not exist" || true
    fi
  done
  
  echo "✅ Migrations complete"
  cd /app
fi

# Start the application
echo "🎯 Starting Node.js application..."
exec node dist/index.js

