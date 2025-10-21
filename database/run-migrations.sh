#!/bin/bash

# Database migration runner for DiscoverLocal.ai
# Applies all SQL migrations in sequence

# Load environment variables
if [ -f "../.env.local" ]; then
    source ../.env.local
elif [ -f "../.env" ]; then
    source ../.env
fi

# Set defaults if not provided
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
DB_NAME=${DB_NAME:-discoverlocal_dev}
DB_USER=${DB_USER:-postgres}
DB_PASSWORD=${DB_PASSWORD:-postgres}

echo "Running database migrations for DiscoverLocal.ai..."

# Check if psql is available
if ! command -v psql &> /dev/null; then
    echo "Error: PostgreSQL client (psql) is not installed."
    exit 1
fi

# Run migration scripts
for migration in migrations/*.sql; do
    if [ -f "$migration" ]; then
        echo "Applying migration: $(basename $migration)"
        PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f "$migration"
        if [ $? -eq 0 ]; then
            echo "✓ Successfully applied: $(basename $migration)"
        else
            echo "✗ Failed to apply: $(basename $migration)"
            exit 1
        fi
    fi
done

echo "All migrations applied successfully!"