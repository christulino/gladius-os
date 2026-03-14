#!/bin/bash
# Kill existing servers
pkill -f "node.*api/server" 2>/dev/null
pkill -f "vite" 2>/dev/null
sleep 1

cd "$(dirname "$0")"

# Start API server (port 3000)
node --watch api/server.js &
API_PID=$!

# Start Vite dev server (port 5173, proxies to 3000)
cd admin-ui && npx vite --clearScreen false &
VITE_PID=$!

echo ""
echo "  API server:  http://localhost:3000      (pid $API_PID)"
echo "  Admin UI:    http://localhost:5173/admin (pid $VITE_PID)"
echo ""
echo "  Press Ctrl+C to stop both."
echo ""

trap "kill $API_PID $VITE_PID 2>/dev/null; exit" INT TERM
wait
