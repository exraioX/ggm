// test-runner.ts — Sistema de execução de testes, lint, build e diagnóstico de autocorreção
import path from 'node:path';
import { GODMODE_HOME, readJson, safeWriteJson } from './config.js';
import { projectManager } from './project-manager.js';
import { processSandbox } from './sandbox.js';

export interface ProjectTestConfig {
  projectId: string;
  testCommand?: string;
  lintCommand?: string;
  buildCommand?: string;
  timeoutSeconds?: number;
  autoFixAllowed?: boolean;
}

export interface TestExecutionResult {
  suite: 'test' | 'lint' | 'build';
  success: boolean;
  exitCode: number | null;
  output: string;
  durationMs: number;
  timedOut: boolean;
  diagnostics: string[];
}

export class TestRunner {
  private getConfigPath(projectId: string): string {
    return path.join(GODMODE_HOME, 'test-configs', `${projectId}.json`);
  }

  getConfig(projectId: string): ProjectTestConfig {
    const defaultCfg: ProjectTestConfig = {
      projectId,
      testCommand: 'npm test',
      lintCommand: 'npm run lint',
      buildCommand: 'npm run typecheck',
      timeoutSeconds: 60,
      autoFixAllowed: false,
    };
    return readJson<ProjectTestConfig>(this.getConfigPath(projectId), defaultCfg);
  }

  saveConfig(projectId: string, config: Partial<ProjectTestConfig>): ProjectTestConfig {
    const current = this.getConfig(projectId);
    const updated: ProjectTestConfig = { ...current, ...config, projectId };
    safeWriteJson(this.getConfigPath(projectId), updated);
    return updated;
  }

  /**
   * Executa uma suíte (test, lint ou build) em ambiente sandbox isolado.
   */
  async runSuite(projectId: string, suite: 'test' | 'lint' | 'build'): Promise<TestExecutionResult> {
    const project = projectManager.get(projectId);
    if (!project) throw new Error(`Projeto ${projectId} não encontrado.`);

    const config = this.getConfig(projectId);
    let commandStr = '';

    if (suite === 'test') commandStr = config.testCommand || 'npm test';
    else if (suite === 'lint') commandStr = config.lintCommand || 'npm run lint';
    else if (suite === 'build') commandStr = config.buildCommand || 'npm run typecheck';

    if (!commandStr.trim()) {
      throw new Error(`Comando para suíte "${suite}" não configurado.`);
    }

    const timeoutMs = (config.timeoutSeconds ?? 60) * 1000;

    // Executa via sandbox com limites de segurança e tempo
    const parts = commandStr.trim().split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    const execResult = await processSandbox.execute(cmd, args, {
      cwd: project.path,
      projectWorkspace: project.path,
      timeoutMs,
    });

    const fullOutput = (execResult.stdout + '\n' + execResult.stderr).trim();
    const success = execResult.exitCode === 0 && !execResult.timedOut;
    const diagnostics = this.extractDiagnostics(fullOutput);

    return {
      suite,
      success,
      exitCode: execResult.exitCode,
      output: fullOutput,
      durationMs: execResult.durationMs,
      timedOut: execResult.timedOut,
      diagnostics,
    };
  }

  /**
   * Extrai mensagens de erro, linhas e arquivos afetados para orientar a autocorreção.
   */
  private extractDiagnostics(output: string): string[] {
    const diagnostics: string[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      // TypeScript / ESLint / Jest / Pytest errors
      if (/error TS\d+:|AssertionError|Failed:|FAIL|SyntaxError|TypeError|ReferenceError/i.test(line)) {
        diagnostics.push(line.trim());
      }
    }

    return diagnostics.slice(0, 15);
  }
}

export const testRunner = new TestRunner();
