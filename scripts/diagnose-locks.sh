#!/usr/bin/env bash
#
# Live lock/contention snapshot for the PMA database.
#
# Purpose: the geo map creation ("Agregar mapa") intermittently fails on the
# client with "La operación superó el tiempo de espera" (30s client timeout).
# Every authenticated write in the app serialises on ONE global advisory lock
# (pg_advisory_xact_lock(9042026)) and the pg pool waits forever for a free
# connection, so a single slow/stuck write can cascade into timeouts elsewhere.
#
# Run this:
#   1. Now, as a baseline (should be quiet).
#   2. THE MOMENT someone reports a timeout — it shows who holds the lock,
#      who is blocked, and what each session is running.
#
# Usage:
#   ./scripts/diagnose-locks.sh              # one-shot snapshot
#   ./scripts/diagnose-locks.sh --watch      # refresh every 2s until Ctrl-C
#
set -euo pipefail

CONTAINER="${PG_CONTAINER:-pma-postgres}"
DB="${DB_NAME:-pma_db}"
USER="${DB_USER:-postgres}"

# 9042026 is AUTHORIZATION_MUTATION_LOCK in authorizationLock.ts. Postgres
# splits a bigint advisory key into classid/objid, so match on that too.
psql() { docker exec -i "$CONTAINER" psql -U "$USER" -d "$DB" -X "$@"; }

snapshot() {
  echo "================ $(date '+%Y-%m-%d %H:%M:%S') ================"

  echo
  echo "--- Pool / connection usage (pool max=20 in db/client.ts) ---"
  psql -c "
    select state, count(*)
    from pg_stat_activity
    where datname = '$DB'
    group by state
    order by count(*) desc;"

  echo "--- Sessions holding the GLOBAL authorization advisory lock (key 9042026) ---"
  psql -c "
    select a.pid, a.usename, a.state,
           now() - a.xact_start as xact_age,
           left(regexp_replace(a.query, '\s+', ' ', 'g'), 80) as query
    from pg_locks l
    join pg_stat_activity a on a.pid = l.pid
    where l.locktype = 'advisory' and l.granted
    order by a.xact_start;"

  echo "--- Blocking chains (who is waiting on whom) ---"
  psql -c "
    select waiting.pid              as waiting_pid,
           waiting.usename          as waiting_user,
           now() - waiting.xact_start as waiting_for,
           blocking.pid             as blocking_pid,
           blocking.usename         as blocking_user,
           left(regexp_replace(blocking.query, '\s+', ' ', 'g'), 60) as blocking_query
    from pg_stat_activity waiting
    join lateral unnest(pg_blocking_pids(waiting.pid)) as b(pid) on true
    join pg_stat_activity blocking on blocking.pid = b.pid
    where waiting.datname = '$DB';"

  echo "--- Longest-running transactions (top 10) ---"
  psql -c "
    select pid, usename, state,
           now() - xact_start as xact_age,
           now() - query_start as query_age,
           wait_event_type, wait_event,
           left(regexp_replace(query, '\s+', ' ', 'g'), 70) as query
    from pg_stat_activity
    where datname = '$DB' and xact_start is not null
    order by xact_start
    limit 10;"
}

if [[ "${1:-}" == "--watch" ]]; then
  while true; do
    clear
    snapshot
    sleep 2
  done
else
  snapshot
fi
