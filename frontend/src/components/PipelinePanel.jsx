import Card from './Card.jsx';

const STAGES = [
  ['fetch', 'Fetch'],
  ['decode', 'Decode'],
  ['execute', 'Execute'],
  ['update', 'Update state'],
  ['record', 'Record trace'],
];

export default function PipelinePanel({ lastEntry, next }) {
  return (
    <Card id="pipeline" title="Instruction pipeline" subtitle={lastEntry ? `last executed: step ${lastEntry.step}` : 'nothing executed yet'}>
      <div className="next-instr">
        <span className="next-label">Next</span>
        {next ? <code>{next.asm}</code> : <span className="muted">—</span>}
        {next?.line ? <span className="muted small">line {next.line}</span> : null}
      </div>
      {lastEntry ? (
        <ol className="pipeline">
          {STAGES.map(([key, label], i) => (
            <li key={key}>
              <span className="stage-num">{i + 1}</span>
              <div className="stage-text">
                <strong>{label}</strong>
                <p>{lastEntry.stages[key]}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty">Press <b>Step</b> to watch one instruction go through fetch → decode → execute → update → record.</p>
      )}
    </Card>
  );
}
