$ErrorActionPreference = 'Stop'

$LabRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $LabRoot
$AppRoot = Join-Path $RepoRoot 'G0DM0D3'
$SidebarPath = Join-Path $AppRoot 'src\components\Sidebar.tsx'
$LabPagePath = Join-Path $AppRoot 'src\app\lab\page.tsx'
$TemplatePath = Join-Path $LabRoot 'ui\page.tsx'

if (-not (Test-Path $SidebarPath)) {
  throw "Não encontrei '$SidebarPath'. Inicialize/extraia o projeto G0DM0D3 dentro do repositório ggm antes de instalar o GODMODE LAB."
}
if (-not (Test-Path $TemplatePath)) {
  throw "Arquivo de interface ausente: $TemplatePath"
}

$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$Sidebar = Get-Content -Raw -LiteralPath $SidebarPath
if (-not $Sidebar.Contains('href="/lab"')) {
  Copy-Item -LiteralPath $SidebarPath -Destination "$SidebarPath.bak-$Timestamp"

  if ($Sidebar -notmatch "import Link from 'next/link'") {
    $Sidebar = $Sidebar.Replace("import { useState } from 'react'", "import { useState } from 'react'`r`nimport Link from 'next/link'")
  }
  if ($Sidebar -notmatch 'BrainCircuit') {
    $Sidebar = $Sidebar.Replace("  Terminal", "  Terminal,`r`n  BrainCircuit")
  }
  $FooterMarker = '          {/* Footer */}'
  $LabLink = @'
          {/* GODMODE LAB */}
          <div className="px-4 py-3 border-t border-theme-primary">
            <Link
              href="/lab"
              className="w-full flex items-center justify-center gap-2 py-2 px-4 border border-theme-primary rounded-lg hover:glow-box transition-all text-sm"
            >
              <BrainCircuit className="w-4 h-4" />
              <span>GODMODE LAB</span>
            </Link>
          </div>

'@
  if (-not $Sidebar.Contains($FooterMarker)) {
    throw 'Não encontrei o ponto de inserção da navegação na Sidebar. Nenhum arquivo foi alterado além do backup.'
  }
  $Sidebar = $Sidebar.Replace($FooterMarker, $LabLink + $FooterMarker)
  Set-Content -LiteralPath $SidebarPath -Value $Sidebar -Encoding utf8
} else {
  Write-Host 'O link GODMODE LAB já está presente na Sidebar.' -ForegroundColor Yellow
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LabPagePath) | Out-Null
if (Test-Path $LabPagePath) {
  Copy-Item -LiteralPath $LabPagePath -Destination "$LabPagePath.bak-$Timestamp"
}
Copy-Item -LiteralPath $TemplatePath -Destination $LabPagePath -Force

Write-Host ''
Write-Host 'GODMODE LAB instalado na interface React/Next.js.' -ForegroundColor Green
Write-Host "Página: $LabPagePath"
Write-Host "Backup da Sidebar: $SidebarPath.bak-$Timestamp (se foi necessária alteração)"
Write-Host ''
Write-Host 'Próximos passos:' -ForegroundColor Cyan
Write-Host '  1. No PowerShell: cd GODMODE-LAB'
Write-Host '  2. npm install'
Write-Host '  3. Copie .env.example para .env e ajuste os caminhos, se necessário.'
Write-Host '  4. npm run dev'
Write-Host '  5. Em outro terminal, inicie o G0DM0D3: cd G0DM0D3; npm run dev'
Write-Host '  6. Abra http://localhost:3000/lab'
