// diff-engine.ts — unified diff e leitura segura de arquivos
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Unified Diff (LCS por linhas)
// ============================================================

const MAX_DIFF_LINES = 500;
const CONTEXT_LINES = 3;

/**
 * Calcula a LCS (Longest Common Subsequence) de dois arrays de strings.
 * Versão O(n*m) adequada para arquivos pequenos/médios.
 * Trunca a entrada em MAX_DIFF_LINES linhas para evitar consumo excessivo.
 */
function lcs(a: string[], b: string[]): number[][] {
  const m = Math.min(a.length, MAX_DIFF_LINES);
  const n = Math.min(b.length, MAX_DIFF_LINES);
  // Tabela dp[i][j] = comprimento da LCS de a[0..i-1] e b[0..j-1]
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp;
}

/**
 * Backtrack na tabela LCS para gerar sequência de operações de edição.
 * Retorna array de {op: 'keep'|'add'|'del', line: string}.
 */
function diffOps(original: string[], modified: string[]): Array<{ op: 'keep' | 'add' | 'del'; line: string }> {
  const a = original.slice(0, MAX_DIFF_LINES);
  const b = modified.slice(0, MAX_DIFF_LINES);
  const dp = lcs(a, b);
  const ops: Array<{ op: 'keep' | 'add' | 'del'; line: string }> = [];

  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.unshift({ op: 'keep', line: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ op: 'add', line: b[j - 1] });
      j--;
    } else {
      ops.unshift({ op: 'del', line: a[i - 1] });
      i--;
    }
  }

  // Avisar se linhas foram truncadas
  if (original.length > MAX_DIFF_LINES || modified.length > MAX_DIFF_LINES) {
    ops.push({ op: 'keep', line: `... [diff truncado em ${MAX_DIFF_LINES} linhas]` });
  }

  return ops;
}

/**
 * Gera uma string no formato unified diff (--- a/file / +++ b/file / @@ ... @@).
 * Inclui CONTEXT_LINES linhas de contexto em volta das mudanças.
 */
export function generateUnifiedDiff(original: string, modified: string, filename: string): string {
  if (original === modified) return '';

  const aLines = original.split('\n');
  const bLines = modified.split('\n');

  const ops = diffOps(aLines, bLines);

  // Mapear operações para linhas originais (a) e modificadas (b)
  let aLine = 1;
  let bLine = 1;

  interface HunkLine { op: 'keep' | 'add' | 'del'; text: string; aLine?: number; bLine?: number }
  const annotated: HunkLine[] = ops.map(o => {
    const hl: HunkLine = { op: o.op, text: o.line };
    if (o.op === 'keep') { hl.aLine = aLine++; hl.bLine = bLine++; }
    else if (o.op === 'del') { hl.aLine = aLine++; }
    else { hl.bLine = bLine++; }
    return hl;
  });

  // Identificar índices de linhas alteradas
  const changedIdx = new Set<number>(
    annotated.map((h, i) => h.op !== 'keep' ? i : -1).filter(i => i >= 0)
  );

  // Expandir para incluir contexto
  const inHunk = new Set<number>();
  for (const ci of changedIdx) {
    for (let k = ci - CONTEXT_LINES; k <= ci + CONTEXT_LINES; k++) {
      if (k >= 0 && k < annotated.length) inHunk.add(k);
    }
  }

  if (inHunk.size === 0) return '';

  // Agrupar em hunks contíguos
  const sortedIdx = [...inHunk].sort((x, y) => x - y);
  const hunks: number[][] = [];
  let currentHunk: number[] = [sortedIdx[0]];
  for (let k = 1; k < sortedIdx.length; k++) {
    if (sortedIdx[k] === sortedIdx[k - 1] + 1) {
      currentHunk.push(sortedIdx[k]);
    } else {
      hunks.push(currentHunk);
      currentHunk = [sortedIdx[k]];
    }
  }
  hunks.push(currentHunk);

  // Montar saída
  const lines: string[] = [
    `--- a/${filename}`,
    `+++ b/${filename}`,
  ];

  for (const hunk of hunks) {
    const hunkLines = hunk.map(i => annotated[i]);
    const aStart = hunkLines.find(h => h.aLine !== undefined)?.aLine ?? 1;
    const bStart = hunkLines.find(h => h.bLine !== undefined)?.bLine ?? 1;
    const aCount = hunkLines.filter(h => h.op !== 'add').length;
    const bCount = hunkLines.filter(h => h.op !== 'del').length;

    lines.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
    for (const h of hunkLines) {
      if (h.op === 'keep') lines.push(` ${h.text}`);
      else if (h.op === 'add') lines.push(`+${h.text}`);
      else lines.push(`-${h.text}`);
    }
  }

  return lines.join('\n');
}

// ============================================================
// Leitura segura de arquivo dentro do workspace
// ============================================================

/**
 * Lê o arquivo somente se estiver dentro do workspace informado.
 * Retorna null se o arquivo não existir ou estiver fora do workspace.
 */
export async function readFileSafe(filePath: string, workspace: string): Promise<string | null> {
  try {
    const resolvedWorkspace = path.resolve(workspace);
    const resolvedFile = path.resolve(resolvedWorkspace, filePath);
    const relative = path.relative(resolvedWorkspace, resolvedFile);

    // Rejeitar caminhos que escapam do workspace
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return null;
    }

    if (!fs.existsSync(resolvedFile)) return null;

    const stat = fs.statSync(resolvedFile);
    if (!stat.isFile()) return null;

    return fs.readFileSync(resolvedFile, 'utf8');
  } catch {
    return null;
  }
}
