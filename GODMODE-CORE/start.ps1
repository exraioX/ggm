$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path 'node_modules')) { throw 'Dependências não instaladas. Execute .\install.ps1 primeiro.' }
npm run dev
