#!/usr/bin/env bash
# ============================================================================
# RLS cross-tenant isolation gate — ARCHITECTURE §9.2, §18.
#
# Applies the migrations to a scratch database, seeds two users, and runs the
# isolation suite as the unprivileged `spendwise_app` role. Exits non-zero on
# any leak, so it can gate a release.
#
#   PGHOST=127.0.0.1 PGPORT=5432 ./scripts/rls-gate.sh
# ============================================================================
set -euo pipefail

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGSUPER="${PGSUPER:-postgres}"
DB="${RLS_TEST_DB:-spendwise_rls_gate}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

sup() { psql -h "$PGHOST" -p "$PGPORT" -U "$PGSUPER" -v ON_ERROR_STOP=1 "$@"; }

echo "▸ recreating $DB"
sup -d postgres -q -c "DROP DATABASE IF EXISTS $DB;"
sup -d postgres -q -c "CREATE DATABASE $DB;"

echo "▸ applying migrations"
sup -d "$DB" -q -f "$HERE/migrations/001_init.sql"
sup -d "$DB" -q -f "$HERE/migrations/002_rls.sql"

echo "▸ seeding two tenants"
sup -d "$DB" -q <<'SQL'
INSERT INTO users (display_name, dek_wrapped) VALUES ('RLS-User-A','\x00'), ('RLS-User-B','\x00');
INSERT INTO categories (local_id,user_id,name,icon,colour,limit_minor,created_at,updated_at)
SELECT gen_random_uuid(), id, 'Groceries','groceries','#14B8A6',32000,now(),now()
FROM users WHERE display_name LIKE 'RLS-User-%';
INSERT INTO transactions (local_id,user_id,amount_minor,currency,base_minor,base_currency,
                          fx_rate,fx_rate_date,occurred_at,created_at,updated_at)
SELECT gen_random_uuid(), id, -1550,'GBP',-1550,'GBP',1,current_date,now(),now(),now()
FROM users WHERE display_name LIKE 'RLS-User-%';
SQL

A=$(sup -d "$DB" -tAc "SELECT id FROM users WHERE display_name='RLS-User-A'")
B=$(sup -d "$DB" -tAc "SELECT id FROM users WHERE display_name='RLS-User-B'")

echo "▸ running isolation suite as spendwise_app"
psql -h "$PGHOST" -p "$PGPORT" -U spendwise_app -d "$DB" -v ON_ERROR_STOP=1 \
     -v user_a="$A" -v user_b="$B" -f "$HERE/migrations/rls.test.sql"

echo "▸ dropping $DB"
sup -d postgres -q -c "DROP DATABASE IF EXISTS $DB;"
echo "✅ RLS gate passed"
