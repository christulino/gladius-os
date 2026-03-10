#!/bin/bash
# setup-admin-ui.sh
# Run once from the flowos/ project root to install and build the admin UI.
# After this, the admin UI is served by Express at /admin

set -e

echo "=== Flow OS Admin UI Setup ==="
echo ""

# Check we're in the right place
if [ ! -f "api/server.js" ]; then
  echo "Error: Run this script from the flowos/ project root"
  exit 1
fi

echo "→ Installing admin-ui dependencies..."
cd admin-ui
npm install

echo ""
echo "→ Building admin-ui..."
npm run build

echo ""
echo "✓ Build complete. Output in admin-ui/dist/"
echo ""
echo "The Express server will now serve the React app at http://localhost:3000/admin"
echo ""
echo "During development, you can run the Vite dev server for hot reload:"
echo "  cd admin-ui && npm run dev"
echo "  Then open http://localhost:5173 (proxies API calls to :3000)"
echo ""
echo "To rebuild after changes:"
echo "  cd admin-ui && npm run build"
echo "  (No server restart needed — Express reads the dist folder)"
