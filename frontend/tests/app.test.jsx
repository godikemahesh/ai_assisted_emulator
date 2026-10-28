import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import App from '../src/App.jsx';

const jsonResponse = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body });

function mockBackend({ configured = false, answer = 'Explanation from the tutor.' } = {}) {
  const calls = [];
  globalThis.fetch = vi.fn((url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/api/health')) return jsonResponse(200, { status: 'ok', ai_configured: configured, model: configured ? 'test-model' : null });
    if (url.endsWith('/api/tutor')) {
      if (!configured) return jsonResponse(503, { detail: 'The AI tutor is not configured on the server (GROQ_API_KEY is missing).' });
      return jsonResponse(200, { answer, model: 'test-model' });
    }
    return jsonResponse(404, {});
  });
  return calls;
}

const reg = (name) => screen.getByTestId(`reg-${name}`).textContent;
const click = (name) => fireEvent.click(screen.getByRole('button', { name }));
const consoleText = () => screen.getByTestId('console').textContent;
const editor = () => screen.getByLabelText('Assembly source code');
const openView = (name) => fireEvent.click(screen.getByRole('tab', { name }));

beforeEach(() => mockBackend());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('App (frontend integration)', () => {
  it('renders the dashboard with an assembled example', () => {
    render(<App />);
    expect(screen.getByTestId('project-title').textContent).toBe('AI-Assisted 8086');
    expect(screen.getByRole('heading', { name: 'Debugger' })).toBeTruthy();
    expect(screen.getByTestId('status').textContent).toMatch(/Ready/);
    expect(reg('AX')).toBe('0000');
    expect(reg('CS')).toBe('1000');
    expect(reg('SP')).toBe('FFFE');
    expect(consoleText()).toMatch(/Assembled successfully/);
  });

  it('Step executes one instruction and updates registers, pipeline and trace', () => {
    render(<App />);
    click('Step');
    expect(reg('AX')).toBe('1234');
    expect(reg('IP')).toBe('0004');
    expect(screen.getByTestId('status').textContent).toMatch(/Paused/);
    expect(screen.getByText(/Read 4 bytes \[8B 06 00 00\]/)).toBeTruthy();
    openView(/Execution trace/);
    const trace = screen.getByTestId('trace-table');
    expect(within(trace).getAllByText('MOV AX, [0000h]').length).toBeGreaterThan(0);
  });

  it('Run executes to HLT, then Reset restores the initial state', async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('Execution speed'), { target: { value: '25' } });
    click('Run');
    await waitFor(() => expect(screen.getByTestId('status').textContent).toMatch(/Halted/), { timeout: 4000 });
    expect(reg('AX')).toBe('2134');
    expect(consoleText()).toMatch(/Program finished \(HLT\) after 5 instructions/);
    expect(screen.getByRole('button', { name: 'Step' }).disabled).toBe(true);
    click('Reset');
    expect(reg('AX')).toBe('0000');
    expect(screen.getByTestId('status').textContent).toMatch(/Ready/);
  });

  it('Pause stops a running program', async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('Execution speed'), { target: { value: '2' } });
    click('Run');
    expect(screen.getByTestId('status').textContent).toMatch(/Running/);
    click('Pause');
    expect(screen.getByTestId('status').textContent).toMatch(/Paused|Ready/);
    const ip = reg('IP');
    await new Promise((r) => setTimeout(r, 700));
    expect(reg('IP')).toBe(ip); // nothing ran after Pause
  });

  it('editing the source disables Step until it is re-assembled', () => {
    render(<App />);
    fireEvent.change(editor(), { target: { value: 'MOV BX, 7\nHLT' } });
    expect(screen.getByTestId('status').textContent).toMatch(/Source changed/);
    expect(screen.getByRole('button', { name: 'Step' }).disabled).toBe(true);
    click('Assemble');
    click('Step');
    expect(reg('BX')).toBe('0007');
  });

  it('assembly errors are shown with line number and hint', () => {
    render(<App />);
    fireEvent.change(editor(), { target: { value: 'MOV AX, 1\nMOV DS, 2000h\nHLT' } });
    click('Assemble');
    expect(consoleText()).toMatch(/Line 2: Cannot move a constant directly into DS/);
    expect(consoleText()).toMatch(/Hint: The 8086 has no such instruction/);
    expect(screen.getByTestId('status').textContent).toMatch(/Not assembled/);
    expect(screen.getByRole('button', { name: 'Run' }).disabled).toBe(true);
  });

  it('runtime errors are reported', () => {
    render(<App />);
    fireEvent.change(editor(), { target: { value: 'POP AX\nHLT' } });
    click('Assemble');
    click('Step');
    expect(consoleText()).toMatch(/Runtime error on line 1: Stack underflow/);
    expect(screen.getByTestId('status').textContent).toMatch(/Error/);
  });

  it('Load example loads and assembles the chosen program', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('Example program'), { target: { value: 'loop' } });
    click('Load example');
    expect(editor().value).toMatch(/Sum of 1..5 using LOOP/);
    expect(consoleText()).toMatch(/Loaded example: Simple loop/);
  });

  it('flag indicators update after an instruction', () => {
    render(<App />);
    fireEvent.change(editor(), { target: { value: 'MOV AL, 0FFh\nADD AL, 1\nHLT' } });
    click('Assemble');
    click('Step');
    click('Step');
    expect(screen.getByTestId('flag-CF').textContent).toMatch(/^CF1/);
    expect(screen.getByTestId('flag-ZF').textContent).toMatch(/^ZF1/);
    expect(screen.getByTestId('flags-hex').textContent).toBe('0057h');
  });
});

describe('AI tutor panel', () => {
  it('without a configured backend the tutor is disabled with a clear message', async () => {
    render(<App />);
    openView(/AI tutor/);
    await waitFor(() => expect(screen.getByTestId('ai-status').textContent).toMatch(/GROQ_API_KEY/));
    expect(screen.getByRole('button', { name: /Explain registers & flags/ }).disabled).toBe(true);
    // the emulator still works
    openView(/Debugger/);
    click('Step');
    expect(reg('AX')).toBe('1234');
  });

  it('shows the tutor answer and sends a read-only snapshot, without changing the emulator', async () => {
    const calls = mockBackend({ configured: true, answer: 'AX now holds **1234h**.\n\n```asm\nMOV AX, 1\n```' });
    render(<App />);
    click('Step');
    openView(/AI tutor/);
    await waitFor(() => expect(screen.getByTestId('ai-status').textContent).toMatch(/ready/));
    fireEvent.click(screen.getByRole('button', { name: /Explain registers & flags/ }));
    await waitFor(() => expect(screen.getByTestId('tutor-answer')).toBeTruthy());
    expect(screen.getByTestId('tutor-answer').textContent).toMatch(/AX now holds 1234h/);
    const tutorCall = calls.find((c) => c.url.endsWith('/api/tutor'));
    const body = JSON.parse(tutorCall.init.body);
    expect(body.mode).toBe('explain_state');
    expect(body.snapshot.registersHex.AX).toBe('1234');
    expect(body.trace[0].asm).toBe('MOV AX, [0000h]');
    // The answer contained code, but it was only displayed: registers are unchanged.
    openView(/Debugger/);
    expect(reg('AX')).toBe('1234');
    expect(reg('IP')).toBe('0004');
  });

  it('the instruction reference works offline', () => {
    render(<App />);
    openView(/Instruction set/);
    fireEvent.click(screen.getByRole('button', { name: 'LOOP' }));
    expect(screen.getByTestId('reference-card').textContent).toMatch(/CX = CX − 1; jumps/);
  });
});

describe('sidebar navigation', () => {
  it('switches views and keeps emulator state across them', () => {
    render(<App />);
    click('Step');
    fireEvent.click(screen.getByRole('tab', { name: /Memory/ }));
    expect(screen.getByRole('heading', { name: 'Variables' })).toBeTruthy();
    expect(screen.getByText('num1')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Machine code/ }));
    expect(screen.getByText('8B 06 00 00')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Debugger/ }));
    expect(reg('AX')).toBe('1234');
    expect(screen.getByRole('tab', { name: /Debugger/ }).getAttribute('aria-selected')).toBe('true');
  });
});
