import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { agentToolsHandler, NATIVE_TOOLS } from '../src/agent-tools.js';
import { claudePluginsManager } from '../src/claude-plugins.js';

test('native-tools: contém ferramentas de desenvolvimento estilo Antigravity e Claude Code', () => {
  const names = NATIVE_TOOLS.map(t => t.name);
  assert.ok(names.includes('read_file'));
  assert.ok(names.includes('write_file'));
  assert.ok(names.includes('edit_file'));
  assert.ok(names.includes('run_command'));
  assert.ok(names.includes('list_dir'));
  assert.ok(names.includes('search_files'));
});

test('native-tools: write_file, read_file e edit_file operam com segurança', async () => {
  const tmpDir = path.resolve(os.tmpdir(), 'godmode-tools-test-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  const session = 'test-session-tools';

  // 1. write_file
  const writeRes = await agentToolsHandler.executeTool(
    'write_file',
    { path: 'src/demo.ts', content: 'export const greeting = "hello world";\nexport const version = 1;\n' },
    tmpDir,
    session,
  );
  assert.equal(writeRes.ok, true);
  assert.ok(fs.existsSync(path.join(tmpDir, 'src', 'demo.ts')));

  // 2. read_file
  const readRes = await agentToolsHandler.executeTool(
    'read_file',
    { path: 'src/demo.ts', start_line: 1, end_line: 1 },
    tmpDir,
    session,
  );
  assert.equal(readRes.startLine, 1);
  assert.ok(readRes.content.includes('hello world'));

  // 3. edit_file
  const editRes = await agentToolsHandler.executeTool(
    'edit_file',
    { path: 'src/demo.ts', target: 'version = 1;', replacement: 'version = 2;' },
    tmpDir,
    session,
  );
  assert.equal(editRes.ok, true);
  assert.ok(editRes.diff.includes('-export const version = 1;'));
  assert.ok(editRes.diff.includes('+export const version = 2;'));

  // 4. search_files
  const searchRes = await agentToolsHandler.executeTool(
    'search_files',
    { pattern: 'greeting' },
    tmpDir,
    session,
  );
  assert.ok(searchRes.totalMatches >= 1);
  assert.ok(searchRes.matches[0].match.includes('hello world'));

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('claude-plugins: descobre plugins instalados e suporta sincronização', () => {
  const plugins = claudePluginsManager.discoverInstalled();
  assert.ok(Array.isArray(plugins));
});
