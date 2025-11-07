@echo off
echo 🚀 Installing Drive Metadata Manager...

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js is not installed. Please install Node.js first.
    echo    Download from: https://nodejs.org/
    pause
    exit /b 1
)

REM Check if npm is installed
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ npm is not installed. Please install npm first.
    pause
    exit /b 1
)

REM Check Node.js version (requires 20+)
for /f "tokens=1 delims=." %%a in ('node --version') do set NODE_VERSION=%%a
set NODE_VERSION=%NODE_VERSION:v=%
if %NODE_VERSION% LSS 20 (
    echo ❌ Node.js version 20 or higher is required. Current version: 
    node --version
    pause
    exit /b 1
)

echo ✅ Node.js version: 
node --version
echo ✅ npm version: 
npm --version

REM Install dependencies
echo 📦 Installing dependencies...
npm install

if %errorlevel% equ 0 (
    echo ✅ Dependencies installed successfully!
    echo.
    echo 🎉 Installation complete!
    echo.
    echo To start the development server:
    echo   npm run dev
    echo.
    echo To build for production:
    echo   npm run build
    echo.
    echo To package the app:
    echo   npm run package
    echo.
    echo For more information, see README.md
) else (
    echo ❌ Failed to install dependencies. Please check the error messages above.
    pause
    exit /b 1
)

pause 