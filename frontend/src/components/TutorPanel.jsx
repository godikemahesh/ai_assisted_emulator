import { useState } from 'react';
import { TUTOR_MODES, askTutor, buildTutorRequest } from '../ai/tutorClient.js';
import { SUPPORTED_MNEMONICS, getInstructionDoc } from '../emulator/isa.js';
import Card from './Card.jsx';
import { ReferenceCard } from './ReferencePanel.jsx';

/** Very small, safe renderer: ```code blocks```, `inline code`, **bold** and line breaks. No HTML injection. */
function Answer({ text }) {
  const parts = text.split(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g);
  const inline = (s, key) => s.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((piece, i) => {
    if (/^`[^`]+`$/.test(piece)) return <code key={`${key}-${i}`}>{piece.slice(1, -1)}</code>;
    if (/^\*\*[^*]+\*\*$/.test(piece)) return <strong key={`${key}-${i}`}>{piece.slice(2, -2)}</strong>;
    return piece;
  });
  return (
    <div className="answer">
      {parts.map((part, i) => (i % 2 === 1
        ? <pre key={i} className="code-block">{part.trimEnd()}</pre>
        : part.split(/\n{2,}/).filter((p) => p.trim()).map((para, j) => (
          <p key={`${i}-${j}`}>
            {para.split('\n').map((line, k, arr) => (
              <span key={k}>{inline(line, `${i}-${j}-${k}`)}{k < arr.length - 1 && <br />}</span>
            ))}
          </p>
        ))))}
    </div>
  );
}

const mnemonicOf = (line) => {
  const text = (line || '').replace(/;.*$/, '').replace(/^\s*[A-Za-z_?@$][\w?@$]*\s*:/, '').trim();
  const word = text.split(/\s+/)[0];
  return word ? word.toUpperCase() : null;
};

const MODE_HELP = {
  explain_instruction: 'What does the line under the cursor do?',
  explain_state: 'Why do the registers and flags have these values?',
  explain_trace: 'Walk through the steps executed so far.',
  diagnose_errors: 'Explain assembler or runtime errors and suggest fixes.',
};

export default function TutorPanel({ getContext, selectedLine, selectedLineText, status, onRecheck }) {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const selectedDoc = getInstructionDoc(mnemonicOf(selectedLineText));

  const ask = async (mode) => {
    if (mode === 'question' && !question.trim()) {
      setResult({ ok: false, message: 'Type a question first.' });
      return;
    }
    setLoading(true);
    setResult(null);
    const request = buildTutorRequest({ mode, question, supported: SUPPORTED_MNEMONICS, ...getContext() });
    const response = await askTutor(request);
    setLoading(false);
    setResult({ ...response, mode });
  };

  return (
    <div className="tutor-layout">
      <Card
        id="tutor"
        title="Ask the AI tutor"
        subtitle="Receives a read-only copy of your program and CPU state"
        actions={!status.available && !status.checking && <button type="button" className="btn ghost sm" onClick={onRecheck}>Retry connection</button>}
      >
        <div className={`ai-banner ${status.available ? 'ok' : 'off'}`} data-testid="ai-status">
          <span className="dot" />
          <span>{status.message}</span>
        </div>

        <div className="mode-grid">
          {TUTOR_MODES.filter((m) => !m.needsQuestion).map((m) => (
            <button key={m.id} type="button" className="mode-card" disabled={!status.available || loading} onClick={() => ask(m.id)}>
              <strong>{m.label}</strong>
              <span>{MODE_HELP[m.id]}</span>
            </button>
          ))}
        </div>

        <div className="ask-row">
          <textarea
            className="input"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about the 8086, this program, or a flag… e.g. Why is CF set after line 3?"
            rows={2}
            maxLength={2000}
            aria-label="Question for the AI tutor"
            disabled={!status.available}
          />
          <button type="button" className="btn primary" disabled={!status.available || loading} onClick={() => ask('question')}>Ask</button>
        </div>

        {loading && <div className="loading"><span className="spinner" /> Thinking… the emulator keeps working meanwhile.</div>}
        {result && !result.ok && <p className="alert error" role="alert">{result.message}</p>}
        {result?.ok && (
          <div className="tutor-answer" data-testid="tutor-answer">
            <Answer text={result.answer} />
            <p className="hint">AI explanation ({result.model}). It can be wrong — the emulator panels always show the real results.</p>
          </div>
        )}
      </Card>

      <Card id="offline-help" title="Built-in help" subtitle={selectedLine ? `line ${selectedLine} · no AI needed` : 'no AI needed'}>
        {selectedDoc ? <ReferenceCard doc={selectedDoc} /> : (
          <p className="empty">In the Debugger, click a line that contains an instruction to see its reference here.</p>
        )}
      </Card>
    </div>
  );
}
