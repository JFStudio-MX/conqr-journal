@echo off
rem Abre CONQR Journal en este equipo: http://localhost:5180
rem Usa siempre el mismo puerto (los datos locales dependen de la direccion).
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias por primera vez...
  call npm install || goto :error
)
echo Compilando...
call npm run build || goto :error
start "" http://localhost:5180/
echo CONQR Journal esta abierto en http://localhost:5180  (cierra esta ventana para detenerlo)
call npx vite preview --port 5180 --strictPort
goto :eof
:error
echo Algo fallo. Revisa el mensaje de arriba.
pause
