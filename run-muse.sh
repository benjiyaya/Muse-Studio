#!/bin/bash

echo "========================================"
echo "  Starting Muse Development Server"
echo "========================================"
echo ""

# Terminal 1 - Python Backend
echo "[1/2] Starting Python Backend..."
gnome-terminal --title="Muse Backend" -- bash -c "
    cd muse_backend || exit
    source .venv/bin/activate || exit
    uvicorn app.main:app --reload --port 8000
    exec bash
" &

# Wait a moment for backend to start
sleep 2

# Terminal 2 - Next.js Frontend
echo "[2/2] Starting Next.js Frontend..."
gnome-terminal --title="Muse Studio" -- bash -c "
    cd muse-studio || exit
    npm run dev
    exec bash
" &

echo ""
echo "========================================"
echo "  Both servers starting..."
echo "  Backend: http://localhost:8000"
echo "  Frontend: http://localhost:3000"
echo "========================================"
echo ""
echo "Press Ctrl+C to stop monitoring..."

# Keep this terminal open to show status
wait
