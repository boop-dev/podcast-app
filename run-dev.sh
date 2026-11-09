#!/usr/bin/env bash
# Start the whole app for local development:
#   backend  -> http://localhost:5001
#   frontend -> http://localhost:5173 (proxies /api to the backend)
set -e
cd "$(dirname "$0")"

if [ ! -d backend/venv ]; then
  python3 -m venv backend/venv
  backend/venv/bin/pip install -r backend/requirements.txt
fi

backend/venv/bin/python backend/app.py &
BACKEND_PID=$!

cd frontend
if [ ! -d node_modules ]; then
  npm install
fi
npm run dev &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID" INT TERM
wait
