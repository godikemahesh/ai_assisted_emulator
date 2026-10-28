// AI tutor client.
//
// Separation rule: this module NEVER imports the emulator engine and never receives
// a reference to it. It only gets plain, copied data (source text, a frozen snapshot,
// trace entries) and returns text. The tutor's answer is displayed, never executed.

const ENV = import.meta.env || {};
export const API_BASE = String(ENV.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const STANDALONE = ENV.MODE === 'standalone';

export const TUTOR_MODES = [
  { id: 'explain_instruction', label: 'Explain selected line', needsQuestion: false },
  { id: 'explain_state', label: 'Explain registers & flags', needsQuestion: false },
  { id: 'explain_trace', label: 'Explain the trace', needsQuestion: false },
  { id: 'diagnose_errors', label: 'Diagnose errors', needsQuestion: false },
  { id: 'question', label: 'Ask a question', needsQuestion: true },
];

const MAX_TRACE_ENTRIES = 20;

/** Copy only what the tutor needs, as plain JSON (no functions, no shared references). */
export function buildTutorRequest({
  mode, question = '', source = '', selectedLine = null, snapshot = null, trace = [], errors = [], supported = [],
}) {
  const lines = source.split('\n');
  const request = {
    mode,
    question: question.slice(0, 2000),
    program: source.slice(0, 20000),
    selected_line: selectedLine,
    selected_text: selectedLine ? (lines[selectedLine - 1] || '').slice(0, 300) : '',
    snapshot: snapshot || {},
    trace: trace.slice(-MAX_TRACE_ENTRIES).map((t) => ({
      step: t.step, address: t.address, line: t.line, asm: t.asm, bytes: t.bytes,
      description: t.description, changes: t.stages?.update, error: t.error,
    })),
    errors: errors.slice(0, 50).map((e) => ({ line: e.line, message: e.message, hint: e.hint, source: e.source })),
    supported_instructions: supported,
  };
  return JSON.parse(JSON.stringify(request));
}

function errorMessage(status, body) {
  if (body && typeof body.detail === 'string') return body.detail;
  if (status === 422) return 'The tutor request was rejected as invalid (it may be too long).';
  if (status === 404) return 'The tutor API was not found. Check VITE_API_BASE_URL.';
  return `The AI tutor service returned an error (HTTP ${status}).`;
}

/** Ask the backend whether the AI tutor is available. Never throws. */
export async function checkTutorStatus({ baseUrl = API_BASE, fetchImpl = globalThis.fetch } = {}) {
  if (STANDALONE && !baseUrl) {
    return { available: false, message: 'This standalone file runs fully offline. The AI tutor needs the backend server (see README).' };
  }
  try {
    const res = await fetchImpl(`${baseUrl}/api/health`);
    if (!res.ok) return { available: false, message: `Tutor backend not reachable (HTTP ${res.status}).` };
    const body = await res.json();
    if (!body.ai_configured) {
      return { available: false, message: 'The backend is running but no GROQ_API_KEY is configured, so the AI tutor is off.' };
    }
    return { available: true, model: body.model, message: `AI tutor ready (${body.model}).` };
  } catch {
    return { available: false, message: 'Tutor backend is offline. The emulator works normally without it.' };
  }
}

/** Send a tutor request. Resolves to { ok, answer } or { ok: false, message }. Never throws. */
export async function askTutor(request, { baseUrl = API_BASE, fetchImpl = globalThis.fetch, timeoutMs = 45000 } = {}) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(`${baseUrl}/api/tutor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller?.signal,
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) return { ok: false, message: errorMessage(res.status, body) };
    if (!body || typeof body.answer !== 'string' || !body.answer.trim()) {
      return { ok: false, message: 'The AI service returned an empty answer.' };
    }
    return { ok: true, answer: body.answer, model: body.model };
  } catch (e) {
    if (e && e.name === 'AbortError') return { ok: false, message: 'The AI tutor took too long to answer. Please try again.' };
    return { ok: false, message: 'Could not reach the AI tutor backend. Is it running? The emulator still works without it.' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
