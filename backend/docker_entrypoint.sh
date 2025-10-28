#!/usr/bin/env bash
set -euo pipefail

# start cron
echo "Starting cron..."
service cron start || cron || true

# tail schedule log in background for visibility
touch /var/log/schedule.log
tail -n +1 -F /var/log/schedule.log &

# start the app
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
