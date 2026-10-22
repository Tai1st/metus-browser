@echo off
setlocal
cd /d "%~dp0"

if not defined JAVA_HOME set "JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"
if not defined ANDROID_HOME set "ANDROID_HOME=D:\Android\Sdk"
set "NODE_ENV=production"

for /f %%v in ('node -p "require('./app.json').expo.version"') do set VERSION=%%v
for /f %%t in ('node -p "const d=new Date(),p=n=>String(n).padStart(2,'0');`${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`"') do set TIMESTAMP=%%t
echo === Build Metus Browser %VERSION%-%TIMESTAMP% (release APK) ===

cd android
call .\gradlew.bat assembleRelease
if errorlevel 1 (
  echo.
  echo Build loi - xoa cache assets va thu lai 1 lan...
  rmdir /s /q app\build\intermediates\assets\release 2>nul
  rmdir /s /q app\build\intermediates\merged_assets 2>nul
  call .\gradlew.bat assembleRelease
  if errorlevel 1 (
    echo.
    echo BUILD THAT BAI
    cd ..
    exit /b 1
  )
)
cd ..

if not exist dist mkdir dist
copy /y android\app\build\outputs\apk\release\app-release.apk dist\MetusBrowser-%VERSION%-%TIMESTAMP%.apk >nul
echo.
echo XONG: %CD%\dist\MetusBrowser-%VERSION%-%TIMESTAMP%.apk
endlocal
