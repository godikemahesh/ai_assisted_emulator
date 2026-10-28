// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Emulator } from '../src/emulator/index.js';
import { askTutor, buildTutorRequest, checkTutorStatus } from '../src/ai/tutorClient.js';

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function loadedEmulator() {
  const emu = new Emulator();
  emu.assemble('MOV AX, 5\nADD AX, 3\nHLT');
  emu.step();
  return emu;
}

describe('AI tutor is separated from the emulator', () => {
  it('the tutor client does not import the emulator engine', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/ai/tutorClient.js', import.meta.url)), 'utf8');
    const imports = src.split('\n').filter((l) => /^\s*import\s/.test(l));
    expect(imports.filter((l) => /emulator/i.test(l))).toEqual([]);
  });

  it('the tutor request is a plain copy: changing it cannot change the emulator', () => {
    const emu = loadedEmulator();
    const request = buildTutorRequest({
      mode: 'explain_state', source: 'MOV AX, 5', snapshot: emu.getSnapshot(), trace: emu.getTrace(),
    });
    request.snapshot.registers.AX = 0x9999;
    request.trace[0].asm = 'HACKED';
    expect(emu.cpu.get('AX')).toBe(5);
    expect(emu.getTrace()[0].asm).toBe('MOV AX, 0005h');
  });

  it('a tutor call — even one whose response tries to tamper with data — never changes emulator state', async () => {
    const emu = loadedEmulator();
    const before = JSON.stringify(emu.getSnapshot());
    const steps = emu.stepCount;
    const request = buildTutorRequest({ mode: 'explain_state', snapshot: emu.getSnapshot(), trace: emu.getTrace() });
    const fetchImpl = async (_url, init) => {
      const body = JSON.parse(init.body);
      body.snapshot.registers.AX = 1; // a hostile transport mutating what it was sent
      return jsonResponse(200, { answer: 'MOV AX, 1234h\nHLT  ; (the AI suggested code, it is only text)', model: 'test' });
    };
    const result = await askTutor(request, { fetchImpl, baseUrl: '' });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(emu.getSnapshot())).toBe(before);
    expect(emu.stepCount).toBe(steps);
  });

  it('the snapshot given to the tutor is frozen', () => {
    const snap = loadedEmulator().getSnapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.flags)).toBe(true);
  });

  it('request size is bounded (last 20 trace entries, truncated text)', () => {
    const trace = Array.from({ length: 50 }, (_, i) => ({ step: i + 1, asm: 'NOP', stages: { update: '' } }));
    const r = buildTutorRequest({ mode: 'question', question: 'q'.repeat(5000), source: 'x'.repeat(30000), trace });
    expect(r.trace).toHaveLength(20);
    expect(r.trace[0].step).toBe(31);
    expect(r.question).toHaveLength(2000);
    expect(r.program).toHaveLength(20000);
  });
});

describe('tutor client error handling (no fabricated answers)', () => {
  const request = buildTutorRequest({ mode: 'explain_state' });

  it('shows the server message when the AI is not configured (503)', async () => {
    const fetchImpl = async () => jsonResponse(503, { detail: 'The AI tutor is not configured on the server (GROQ_API_KEY is missing).' });
    const r = await askTutor(request, { fetchImpl, baseUrl: '' });
    expect(r).toEqual({ ok: false, message: expect.stringMatching(/GROQ_API_KEY/) });
  });

  it('reports network failures clearly', async () => {
    const fetchImpl = async () => {
      throw new TypeError('Failed to fetch');
    };
    const r = await askTutor(request, { fetchImpl, baseUrl: '' });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Could not reach/);
  });

  it('treats an empty answer as an error', async () => {
    const r = await askTutor(request, { fetchImpl: async () => jsonResponse(200, { answer: '  ' }), baseUrl: '' });
    expect(r.ok).toBe(false);
  });

  it('handles validation errors (422) and non-JSON bodies', async () => {
    const fetchImpl = async () => ({ ok: false, status: 422, json: async () => { throw new Error('not json'); } });
    const r = await askTutor(request, { fetchImpl, baseUrl: '' });
    expect(r.message).toMatch(/invalid/);
  });

  it('health check: configured, unconfigured and offline', async () => {
    let s = await checkTutorStatus({ fetchImpl: async () => jsonResponse(200, { ai_configured: true, model: 'm' }), baseUrl: '' });
    expect(s.available).toBe(true);
    s = await checkTutorStatus({ fetchImpl: async () => jsonResponse(200, { ai_configured: false }), baseUrl: '' });
    expect(s.available).toBe(false);
    expect(s.message).toMatch(/GROQ_API_KEY/);
    s = await checkTutorStatus({ fetchImpl: async () => { throw new Error('offline'); }, baseUrl: '' });
    expect(s.available).toBe(false);
    expect(s.message).toMatch(/offline/);
  });

  it('uses the configured base URL', async () => {
    let seen = null;
    await askTutor(request, {
      baseUrl: 'https://tutor.example.com',
      fetchImpl: async (url) => {
        seen = url;
        return jsonResponse(200, { answer: 'ok', model: 'm' });
      },
    });
    expect(seen).toBe('https://tutor.example.com/api/tutor');
  });
});
