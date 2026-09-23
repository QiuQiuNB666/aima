@echo off
cd /d "%~dp0"
echo EYE OS - open http://127.0.0.1:4177 in your browser.
echo Keep this window open while using the local device bridge.
node server.mjs
pause
