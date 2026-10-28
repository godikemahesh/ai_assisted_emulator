import { EXAMPLES } from '../examples/programs.js';
import { IconBuild, IconPlay, IconStep, IconPause, IconReset } from './Icons.jsx';

export const SPEEDS = [
  { label: '1 step/s', value: 1 },
  { label: '2 steps/s', value: 2 },
  { label: '5 steps/s', value: 5 },
  { label: '10 steps/s', value: 10 },
  { label: '25 steps/s', value: 25 },
  { label: 'Max', value: 'max' },
];

export default function Toolbar({
  exampleId, onExampleChange, onLoadExample, onAssemble, onRun, onStep, onPause, onReset,
  canExecute, running, canReset, speed, onSpeedChange,
}) {
  return (
    <div className="toolbar" aria-label="Controls" role="toolbar">
      <div className="toolbar-group">
        <select className="select" value={exampleId} onChange={(e) => onExampleChange(e.target.value)} aria-label="Example program">
          {EXAMPLES.map((e) => (
            <option key={e.id} value={e.id}>{e.title}</option>
          ))}
        </select>
        <button type="button" className="btn" onClick={onLoadExample}>Load example</button>
      </div>

      <div className="toolbar-group">
        <button type="button" className="btn primary" onClick={onAssemble} title="Assemble (Ctrl+Enter)">
          <IconBuild /> Assemble
        </button>
        <div className="btn-group">
          <button type="button" className="btn" onClick={onRun} disabled={!canExecute || running} title="Run (F8)" aria-label="Run">
            <IconPlay /> <span>Run</span>
          </button>
          <button type="button" className="btn" onClick={onStep} disabled={!canExecute || running} title="Step one instruction (F10)" aria-label="Step">
            <IconStep /> <span>Step</span>
          </button>
          <button type="button" className="btn" onClick={onPause} disabled={!running} title="Pause (F8)" aria-label="Pause">
            <IconPause /> <span>Pause</span>
          </button>
          <button type="button" className="btn" onClick={onReset} disabled={!canReset} title="Reset CPU and memory" aria-label="Reset">
            <IconReset /> <span>Reset</span>
          </button>
        </div>
        <select
          className="select"
          value={String(speed)}
          onChange={(e) => onSpeedChange(e.target.value === 'max' ? 'max' : Number(e.target.value))}
          aria-label="Execution speed"
          title="Run speed"
        >
          {SPEEDS.map((s) => (
            <option key={s.label} value={String(s.value)}>{s.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
