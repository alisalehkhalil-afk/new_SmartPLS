@echo off
setlocal
chcp 65001 > nul
title New_SmartPLS Launcher - Ministry of Finance

cd /d "%~dp0"
set "PATH=%PATH%;C:\Program Files\nodejs;C:\Program Files\dotnet;%LOCALAPPDATA%\Programs\node;%APPDATA%\npm"

cls
echo ===============================================================================
echo            جمهورية اليمن - وزارة المالية - الوحدة التنفيذية لتقنية المعلومات
echo               منظومة New_SmartPLS لتقييم الأنظمة المالية الحكومية
echo               مع بوابة الواتساب الذكية - WhatsApp Gateway Hub
echo ===============================================================================
echo.

:: 1. Check Node.js
where node >nul 2>nul
if errorlevel 1 goto NoNode

:: 2. Check WhatsApp Gateway on Port 5050
echo [1/3] فحص خدمات بوابة الواتساب - Port 5050...
netstat -ano | findstr ":5050" | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 goto GatewayRunning

echo [!] بوابة الواتساب ليست قيد التشغيل حالياً.
echo جاري تشغيل خدمات الواتساب تلقائياً في الخلفية...
if exist "F:\Software Reuse\WhatsAppSaaSSolution\RUN_SERVERS_DIRECT.bat" (
    start "" "F:\Software Reuse\WhatsAppSaaSSolution\RUN_SERVERS_DIRECT.bat"
    echo [✓] تم تشغيل خوادم الواتساب.
    goto GatewayDone
)
if exist "..\WhatsAppSaaSSolution\RUN_SERVERS_DIRECT.bat" (
    start "" "..\WhatsAppSaaSSolution\RUN_SERVERS_DIRECT.bat"
    echo [✓] تم تشغيل خوادم الواتساب.
    goto GatewayDone
)

:GatewayRunning
echo [✓] بوابة الواتساب قيد التشغيل وتعمل بنجاح على المنفذ 5050.

:GatewayDone
echo.

:: 3. Launching New_SmartPLS Server
echo [2/3] بدء تشغيل خادم منصة New_SmartPLS على المنفذ 3000...
echo الرابط الرئيسي للمنصة:  http://localhost:3000
echo شاشة إعدادات الواتساب: http://localhost:3000/whatsapp_settings.html
echo.

:: Open browser
start http://localhost:3000/whatsapp_settings.html

echo [3/3] الخادم قيد العمل الآن...
echo ===============================================================================
echo.

node server.js
if errorlevel 1 goto ServerError
goto End

:NoNode
color 0C
echo [خطأ] لم يتم العثور على بيئة Node.js في المسار!
echo يرجى التأكد من تثبيت Node.js من الموقع الرسمي: https://nodejs.org
echo.
pause
exit /b 1

:ServerError
echo.
echo [تنبيه] توقف خادم Node.js برمز خطأ.
pause
exit /b 1

:End
pause
