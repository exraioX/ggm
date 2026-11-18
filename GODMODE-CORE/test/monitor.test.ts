import test from 'node:test';
import assert from 'node:assert/strict';
import { Monitor } from '../src/monitor.js';

test('monitor: clearEvents apaga replay buffer e permite novos eventos', () => {
  const monitor = new Monitor();
  monitor.emit({
    type: 'tool_result',
    agentId: 'agent-test',
    sessionId: 'session-test',
    tool: 'read_file',
    durationMs: 12,
    isError: false,
    output: 'conteúdo de teste',
  });

  assert.equal(monitor.getEvents().length, 1);
  const cleared = monitor.clearEvents();
  assert.equal(cleared, 1);
  assert.equal(monitor.getEvents().length, 0);

  monitor.emit({
    type: 'tool_result',
    agentId: 'agent-test',
    sessionId: 'session-test',
    tool: 'write_file',
    durationMs: 18,
    isError: false,
  });
  assert.equal(monitor.getEvents().length, 1);
  assert.equal(monitor.getEvents()[0].type, 'tool_result');
});
