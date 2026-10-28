import { useCallback, useEffect, useRef, useState } from 'react';
import { Emulator, hex16 } from './emulator/index.js';
import { EXAMPLES, getExample } from './examples/programs.js';
import { checkTutorStatus } from './ai/tutorClient.js';
import Sidebar, { VIEWS } from './components/Sidebar.jsx';
import Toolbar, { SPEEDS } from './components/Toolbar.jsx';
import Card from './components/Card.jsx';
import CodeEditor from './components/CodeEditor.jsx';
import RegisterPanel from './components/RegisterPanel.jsx';
import FlagsPanel from './components/FlagsPanel.jsx';
import PipelinePanel from './components/PipelinePanel.jsx';
import MemoryViewer from './components/MemoryViewer.jsx';
import { VariablesPanel, StackPanel } from './components/DataPanels.jsx';
import { TracePanel, ListingPanel } from './components/TracePanels.jsx';
import ConsolePanel from './components/ConsolePanel.jsx';
import TutorPanel from './components/TutorPanel.jsx';
import ReferencePanel from './components/ReferencePanel.jsx';

const MAX_SPEED_BATCH = 2000; // instructions per animation frame at "Max" speed
const STATUS_TEXT = {
  'not-assembled': 'Not assembled', changed: 'Source changed', ready: 'Ready',
  running: 'Running', paused: 'Paused', halted: 'Halted', error: 'Error',
};

let messageId = 0;
const makeMessage = (type, text, hint) => ({ id: ++messageId, type, text, hint, time: new Date().toLocaleTimeString() });

function assembledMessages(program) {
  if (program.ok) {
    return [
      makeMessage('success', `Assembled successfully: ${program.listing.length} instructions, ${program.code.length} bytes of code, ${program.data.length} bytes of data.`),
      ...program.warnings.map((w) => makeMessage('warning', `${w.line ? `Line ${w.line}: ` : ''}${w.message}`)),
    ];
  }
  return [
    ...program.errors.map((e) => makeMessage('error', `${e.line ? `Line ${e.line}: ` : ''}${e.message}`, e.hint)),
    makeMessage('error', `Assembly failed with ${program.errors.length} error${program.errors.length > 1 ? 's' : ''}. Fix ${program.errors.length > 1 ? 'them' : 'it'} and click Assemble again.`),
  ];
}

export default function App() {
  // The emulator lives for the whole session. Rendering reads from it; only the handlers below change it.
  const [initial] = useState(() => {
    const emulator = new Emulator();
    const program = emulator.assemble(EXAMPLES[0].source);
    return { emulator, program };
  });
  const emu = initial.emulator;
  const [, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const [view, setView] = useState('debugger');
  const [source, setSource] = useState(EXAMPLES[0].source);
  const [exampleId, setExampleId] = useState(EXAMPLES[0].id);
  const [program, setProgram] = useState(initial.program);
  const [dirty, setDirty] = useState(false);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(5);
  const [cursorLine, setCursorLine] = useState(null);
  const [aiStatus, setAiStatus] = useState({ available: false, checking: true, message: 'Checking the AI tutor…' });
  const [messages, setMessages] = useState(() => [
    makeMessage('info', 'Welcome! An example program is loaded. Press Step to execute one instruction, or Run.'),
    ...assembledMessages(initial.program),
  ]);

  const log = useCallback((...msgs) => setMessages((m) => [...m, ...msgs].slice(-200)), []);

  const recheckAi = useCallback(() => {
    setAiStatus({ available: false, checking: true, message: 'Checking the AI tutor…' });
    checkTutorStatus().then((s) => setAiStatus({ ...s, checking: false }));
  }, []);
  useEffect(() => {
    let alive = true;
    checkTutorStatus().then((s) => alive && setAiStatus({ ...s, checking: false }));
    return () => {
      alive = false;
    };
  }, []);

  const reportOutcome = useCallback(() => {
    if (emu.status === 'halted') {
      log(makeMessage('success', `Program finished (HLT) after ${emu.stepCount} instruction${emu.stepCount === 1 ? '' : 's'}.`));
    } else if (emu.status === 'error' && emu.lastError) {
      const e = emu.lastError;
      log(makeMessage('error', `Runtime error${e.line ? ` on line ${e.line}` : ''}: ${e.message}`, e.hint));
    }
  }, [emu, log]);

  const doAssemble = useCallback((src) => {
    setRunning(false);
    const result = emu.assemble(src);
    setProgram(result);
    setDirty(false);
    log(...assembledMessages(result));
    refresh();
  }, [emu, log, refresh]);

  const canExecute = !dirty && emu.canStep();

  const doStep = useCallback(() => {
    if (dirty || !emu.canStep()) return;
    emu.step();
    refresh();
    if (emu.status !== 'ready') reportOutcome();
  }, [dirty, emu, refresh, reportOutcome]);

  const doRun = useCallback(() => {
    if (dirty || !emu.canStep()) return;
    const label = SPEEDS.find((s) => s.value === speed)?.label;
    log(makeMessage('info', `Running at ${label}…`));
    setRunning(true);
  }, [dirty, emu, speed, log]);

  const doPause = () => {
    setRunning(false);
    log(makeMessage('info', `Paused after ${emu.stepCount} instructions. Press Step or Run to continue.`));
  };

  const doReset = () => {
    setRunning(false);
    emu.reset();
    refresh();
    log(makeMessage('info', 'Reset: registers, flags, memory and trace restored to the freshly loaded program.'));
  };

  const loadExample = () => {
    const example = getExample(exampleId);
    setSource(example.source);
    log(makeMessage('info', `Loaded example: ${example.title}.`));
    doAssemble(example.source);
  };

  // Run loop: executes instructions on a timer until HLT, an error, or Pause.
  useEffect(() => {
    if (!running) return undefined;
    let timer = null;
    let frame = null;
    let stopped = false;
    const schedule = () => {
      if (speed === 'max') frame = requestAnimationFrame(tick);
      else timer = setTimeout(tick, 1000 / speed);
    };
    function tick() {
      if (stopped) return;
      emu.run(speed === 'max' ? MAX_SPEED_BATCH : 1);
      refresh();
      if (!emu.canStep()) {
        setRunning(false);
        reportOutcome();
        return;
      }
      schedule();
    }
    schedule();
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [running, speed, emu, refresh, reportOutcome]);

  // Keyboard shortcuts: Ctrl+Enter assemble, F10 step, F8 run/pause.
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const handleShortcut = useCallback((e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      doAssemble(sourceRef.current);
    } else if (e.key === 'F10') {
      e.preventDefault();
      doStep();
    } else if (e.key === 'F8') {
      e.preventDefault();
      if (running) setRunning(false);
      else doRun();
    }
  }, [doAssemble, doStep, doRun, running]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLTextAreaElement) return; // the editor forwards its own shortcuts
      handleShortcut(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleShortcut]);

  const onSourceChange = (text) => {
    setSource(text);
    if (!dirty) setDirty(true);
    if (running) setRunning(false);
  };

  // ---- derived, read-only view data
  const snapshot = emu.getSnapshot();
  const trace = emu.getTrace();
  const lastOk = [...trace].reverse().find((t) => !t.error) || null;
  const lastChanges = emu.lastChanges || { registers: [], flags: [], memory: [] };
  const changedRegs = new Set(lastChanges.registers.map((r) => r.name));
  const changedFlags = new Set(lastChanges.flags.map((f) => f.name));
  const changedMem = new Set(lastChanges.memory.map((m) => m.address));
  const errorLines = [
    ...(program && !program.ok ? program.errors.map((e) => e.line).filter(Boolean) : []),
    ...(snapshot.lastError?.line && !dirty ? [snapshot.lastError.line] : []),
  ];
  let statusKey = 'not-assembled';
  if (program?.ok) {
    if (dirty) statusKey = 'changed';
    else if (running) statusKey = 'running';
    else if (emu.status === 'ready') statusKey = emu.stepCount ? 'paused' : 'ready';
    else statusKey = emu.status;
  } else if (program && dirty) statusKey = 'changed';
  const highlightLine = !dirty && emu.status === 'ready' ? snapshot.currentLine : null;
  const selectedLineText = cursorLine ? source.split('\n')[cursorLine - 1] : '';
  const regs = snapshot.registers;
  const current = VIEWS.find((v) => v.id === view);
  const errorCount = (program && !program.ok ? program.errors.length : 0) + (emu.status === 'error' ? 1 : 0);

  // The tutor receives copies only: source text, a frozen snapshot, frozen trace entries, error info.
  const getTutorContext = () => ({
    source,
    selectedLine: cursorLine,
    snapshot: emu.getSnapshot(),
    trace: emu.getTrace(),
    errors: [
      ...(program && !program.ok ? program.errors : []),
      ...(emu.lastError ? [{ line: emu.lastError.line, message: `Runtime error: ${emu.lastError.message}`, hint: emu.lastError.hint }] : []),
    ],
  });

  return (
    <div className="shell">
      <Sidebar
        view={view}
        onView={setView}
        badges={{ trace: trace.length + emu.traceDropped || null, debugger: errorCount || null }}
        status={{ key: statusKey, text: STATUS_TEXT[statusKey], steps: emu.stepCount, csip: `${hex16(regs.CS)}:${hex16(regs.IP)}` }}
        aiStatus={aiStatus}
      />

      <div className="main">
        <header className="topbar">
          <div className="page-title">
            <h1>{current.title}</h1>
            <p>{current.description}</p>
          </div>
          <Toolbar
            exampleId={exampleId}
            onExampleChange={setExampleId}
            onLoadExample={loadExample}
            onAssemble={() => doAssemble(source)}
            onRun={doRun}
            onStep={doStep}
            onPause={doPause}
            onReset={doReset}
            canExecute={canExecute}
            running={running}
            canReset={!!emu.program && !dirty}
            speed={speed}
            onSpeedChange={setSpeed}
          />
        </header>

        <main className="content">
          {view === 'debugger' && (
            <div className="view-debugger">
              <div className="stack-col">
                <Card
                  id="editor"
                  title="Assembly source"
                  subtitle={dirty ? 'modified — click Assemble' : program?.ok ? `assembled · ${program.listing.length} instructions` : 'not assembled'}
                  actions={<span className="kbd-hint"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> assemble · <kbd>F10</kbd> step · <kbd>F8</kbd> run</span>}
                  bodyClassName="flush"
                >
                  <CodeEditor
                    value={source}
                    onChange={onSourceChange}
                    currentLine={highlightLine}
                    errorLines={errorLines}
                    onCursorLine={setCursorLine}
                    onShortcut={handleShortcut}
                  />
                </Card>
                <ConsolePanel messages={messages} onClear={() => setMessages([])} />
              </div>
              <div className="stack-col">
                <RegisterPanel registers={regs} changed={changedRegs} />
                <FlagsPanel flags={snapshot.flags} flagsValue={regs.FLAGS} changed={changedFlags} />
                <PipelinePanel lastEntry={lastOk} next={snapshot.nextInstruction} />
              </div>
            </div>
          )}

          {view === 'memory' && (
            <div className="view-memory">
              <MemoryViewer registers={regs} readBytes={(addr, len) => emu.readBytes(addr, len)} changedAddresses={changedMem} />
              <div className="stack-col">
                <VariablesPanel variables={snapshot.variables} />
                <StackPanel stack={snapshot.stack} sp={`${hex16(regs.SS)}:${hex16(regs.SP)}`} />
              </div>
            </div>
          )}

          {view === 'trace' && <TracePanel trace={trace} dropped={emu.traceDropped} />}
          {view === 'listing' && <ListingPanel program={program} ip={regs.IP} />}
          {view === 'tutor' && (
            <TutorPanel
              getContext={getTutorContext}
              selectedLine={cursorLine}
              selectedLineText={selectedLineText}
              status={aiStatus}
              onRecheck={recheckAi}
            />
          )}
          {view === 'reference' && <ReferencePanel />}
        </main>

        <footer className="footer">
          Educational, instruction-level simulation of a documented 8086 subset — not cycle-accurate.
          Code CS=1000h · data DS=ES=2000h · stack SS=3000h. The AI tutor only explains; it never executes code.
        </footer>
      </div>
    </div>
  );
}
