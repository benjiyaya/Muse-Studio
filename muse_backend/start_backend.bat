@echo off
cd /d e:\MuseAgent_KanbunPM\v3_src\muse_backend
call .venv\Scripts\activate.bat
python run.py >> backend.log 2>&1
