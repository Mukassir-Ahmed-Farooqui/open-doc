#!/bin/sh
# Container entrypoint: apply migrations (serialised by an advisory lock), then serve.
set -e
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  alembic upgrade head
fi
exec uvicorn app.main:app \
  --host 0.0.0.0 --port "${PORT:-8000}" \
  --workers "${WEB_CONCURRENCY:-1}" \
  --proxy-headers --forwarded-allow-ips "*" \
  --no-access-log
