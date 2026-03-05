@echo off
echo ========================================
echo   Starting Muse Development Server
echo ========================================
echo.

:: Terminal 1 - Python Backend
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
