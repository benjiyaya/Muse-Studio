@echo off
echo ========================================
echo   Starting Muse Development Server
echo ========================================
echo.

:: Terminal 1 - Python Backend
:: If you get "WinError 10013" (port in use), change --port 8000 to e.g. --port 8001
:: and set MUSE_BACKEND_URL=http://localhost:8001 in muse-studio/.env.local
::
:: Polished export (Remotion): backend must fetch scene MP4s from Muse Studio over HTTP.
:: Default matches Next dev (port 3000). If you use another port, set MUSE_VIDEO_HTTP_BASE accordingly.
set "MUSE_VIDEO_HTTP_BASE=http://127.0.0.1:3000"
echo [1/2] Starting Python Backend...
start "Muse Backend" cmd /k "cd muse_backend && .venv\Scripts\activate.bat && uvicorn app.main:app --reload --port 8000"

:: Wait a moment for backend to start
timeout /t 2 /nobreak >nul

:: Terminal 2 - Next.js Frontend
echo [2/2] Starting Next.js Frontend...
start "Muse Studio" cmd /k "cd muse-studio && npm run dev"

echo.
echo ========================================
echo   Both servers starting...
echo   Backend: http://localhost:8000
echo   Frontend: http://localhost:3000
echo ========================================
echo.
echo Press any key to exit this window...
pause >nul
