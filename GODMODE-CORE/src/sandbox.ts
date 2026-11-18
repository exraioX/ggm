// sandbox.ts — Ambiente isolado de execução para comandos e ferramentas
import { spawn } from 'node:child_process';
import path from 'node:path';

export interface SandboxExecutionOptions {
  cwd: string;
  timeoutMs?: number;
  maxBufferBytes?: number;
  allowedEnv?: Record<string, string>;
  projectWorkspace: string;
}

export interface SandboxExecutionResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

// Variáveis permitidas no ambiente seguro do processo
const SAFE_ENV_VARS = new Set([
  'PATH', 'Path', 'PATHEXT', 'SYSTEMROOT', 'SystemRoot', 'WINDIR',
  'COMSPEC', 'ComSpec', 'TEMP', 'TMP', 'USERPROFILE', 'HOME',
  'NODE_ENV', 'LANG', 'LC_ALL', 'PYTHONIOENCODING', 'PYTHONUTF8',
]);

// Chaves sensíveis que nunca devem vazar para o processo sandbox
const SENSITIVE_KEY_PATTERN = /(?:key|secret|token|password|auth|credential|cert|private)/i;

export class ProcessSandbox {
  /**
   * Sanitiza o ambiente do processo para evitar vazamento de credenciais e API keys.
   */
  private buildSafeEnv(customEnv?: Record<string, string>): Record<string, string> {
    const safeEnv: Record<string, string> = {};

    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value !== 'string') continue;
      // Permitir variáveis seguras de sistema
      if (SAFE_ENV_VARS.has(key) && !SENSITIVE_KEY_PATTERN.test(key)) {
        safeEnv[key] = value;
      }
    }

    // Mesclar variáveis customizadas explicitamente autorizadas
    if (customEnv) {
      for (const [key, value] of Object.entries(customEnv)) {
        if (!SENSITIVE_KEY_PATTERN.test(key)) {
          safeEnv[key] = value;
        }
      }
    }

    return safeEnv;
  }

  /**
   * Valida se o diretório de trabalho está estritamente dentro do workspace permitido.
   */
  private validateCwd(requestedCwd: string, allowedWorkspace: string): string {
    const resolvedCwd = path.resolve(requestedCwd);
    const resolvedWorkspace = path.resolve(allowedWorkspace);
    const rel = path.relative(resolvedWorkspace, resolvedCwd);

    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw new Error(`Tentativa de escapar do workspace do sandbox: ${requestedCwd}`);
    }

    return resolvedCwd;
  }

  /**
   * Executa um comando no ambiente isolado com limites de tempo e buffer.
   */
  async execute(
    command: string,
    args: string[] = [],
    options: SandboxExecutionOptions,
  ): Promise<SandboxExecutionResult> {
    const cwd = this.validateCwd(options.cwd, options.projectWorkspace);
    const timeoutMs = options.timeoutMs ?? 30_000;
    const maxBuffer = options.maxBufferBytes ?? 1024 * 1024 * 4; // 4MB
    const env = this.buildSafeEnv(options.allowedEnv);

    const startTime = Date.now();
    let timedOut = false;

    return new Promise((resolve) => {
      // No Windows, usa shell apenas se o comando for um script batch (.cmd / .bat)
      const isWindows = process.platform === 'win32';
      const needsShell = isWindows && (command.endsWith('.bat') || command.endsWith('.cmd'));
      const child = spawn(command, args, {
        cwd,
        env,
        shell: needsShell,
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          if (isWindows) {
            spawn('taskkill', ['/pid', child.pid!.toString(), '/f', '/t']);
          } else {
            child.kill('SIGKILL');
          }
        } catch {
          // Processo pode já ter encerrado
        }
      }, timeoutMs);

      child.stdout?.on('data', (chunk) => {
        if (stdout.length < maxBuffer) {
          stdout += chunk.toString('utf8');
        }
      });

      child.stderr?.on('data', (chunk) => {
        if (stderr.length < maxBuffer) {
          stderr += chunk.toString('utf8');
        }
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          exitCode: code,
          stdout,
          stderr,
          durationMs: Date.now() - startTime,
          timedOut,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          exitCode: -1,
          stdout,
          stderr: `Erro de execução no sandbox: ${err.message}`,
          durationMs: Date.now() - startTime,
          timedOut: false,
        });
      });
    });
  }
}

export const processSandbox = new ProcessSandbox();
