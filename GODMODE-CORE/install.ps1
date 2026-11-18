$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host '=== Instalação GODMODE CORE ===' -ForegroundColor Cyan
$nodeVersion = (node --version 2>$null)
if (-not $nodeVersion) { throw 'Node.js não encontrado. Instale Node.js 22.16.0 ou superior e abra um novo PowerShell.' }
Write-Host "Node detectado: $nodeVersion"
$versionParts = $nodeVersion.TrimStart('v').Split('.')
$major = [int]$versionParts[0]
$minor = [int]$versionParts[1]
if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 16)) { throw 'GODMODE CORE requer Node.js 22.16.0 ou superior.' }

if (-not (Test-Path '.env')) {
  Copy-Item '.env.example' '.env'
  Write-Host 'Arquivo .env criado a partir de .env.example.'
}

npm install
if ($LASTEXITCODE -ne 0) { throw 'npm install falhou. Verifique a conexão, versão do Node e o log do npm.' }
Write-Host 'Instalação concluída. Execute .\start.ps1 para iniciar o núcleo.' -ForegroundColor Green
