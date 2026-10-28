import { IconChip, IconMemory, IconTrace, IconCode, IconSpark, IconBook } from './Icons.jsx';

export const VIEWS = [
  { id: 'debugger', label: 'Debugger', title: 'Debugger', description: 'Write 8086 assembly, assemble it to machine code, and step through it while registers, flags and memory update.', Icon: IconChip },
  { id: 'memory', label: 'Memory', title: 'Memory', description: '1 MB address space · physical = segment × 16 + offset.', Icon: IconMemory },
  { id: 'trace', label: 'Execution trace', title: 'Execution trace', description: 'Every executed instruction and what it changed.', Icon: IconTrace },
  { id: 'listing', label: 'Machine code', title: 'Machine code', description: 'The bytes the assembler produced for each line.', Icon: IconCode },
  { id: 'tutor', label: 'AI tutor', title: 'AI tutor', description: 'Optional explanations. The tutor never changes the emulator.', Icon: IconSpark },
  { id: 'reference', label: 'Instruction set', title: 'Instruction set', description: 'The supported 8086 subset, with flags and examples.', Icon: IconBook },
];

export default function Sidebar({ view, onView, badges, status, aiStatus }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">86</div>
        <div>
          <div className="brand-name" data-testid="project-title">AI-Assisted 8086</div>
          <div className="brand-sub">Microprocessor Emulator</div>
        </div>
      </div>

      <nav className="nav" role="tablist" aria-orientation="vertical" aria-label="Views">
        {VIEWS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            className={`nav-item ${view === id ? 'active' : ''}`}
            onClick={() => onView(id)}
          >
            <Icon />
            <span className="nav-label">{label}</span>
            {badges[id] ? <span className="nav-badge">{badges[id]}</span> : null}
          </button>
        ))}
      </nav>

      <div className="sidebar-status">
        <div className="status-row">
          <span className="status-key">Status</span>
          <span className={`status-chip ${status.key}`} data-testid="status" role="status">{status.text}</span>
        </div>
        <div className="status-row">
          <span className="status-key">Steps</span>
          <span className="mono">{status.steps}</span>
        </div>
        <div className="status-row">
          <span className="status-key">CS:IP</span>
          <span className="mono">{status.csip}</span>
        </div>
        <div className="status-row">
          <span className="status-key">AI tutor</span>
          <span className={`ai-dot ${aiStatus.available ? 'ok' : aiStatus.checking ? 'wait' : 'off'}`}>
            {aiStatus.available ? 'Online' : aiStatus.checking ? 'Checking' : 'Offline'}
          </span>
        </div>
      </div>
    </aside>
  );
}
