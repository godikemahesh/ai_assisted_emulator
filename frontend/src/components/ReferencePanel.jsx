import { useState } from 'react';
import { INSTRUCTION_DOCS, SUPPORTED_MNEMONICS, getInstructionDoc } from '../emulator/isa.js';
import Card from './Card.jsx';

export function ReferenceCard({ doc }) {
  if (!doc) return null;
  return (
    <div className="ref-card" data-testid="reference-card">
      <div className="ref-head">
        <h3>{doc.name}</h3>
        <span className="tag">{doc.category}</span>
        {doc.aliases.length > 0 && <span className="muted small">also {doc.aliases.join(', ')}</span>}
      </div>
      <p className="ref-summary">{doc.summary}</p>
      <dl className="ref-dl">
        <dt>Forms</dt>
        <dd>{doc.syntax.map((s) => <code key={s} className="syntax">{s}</code>)}</dd>
        <dt>Flags</dt>
        <dd>{doc.flags}</dd>
        {doc.notes && (
          <>
            <dt>Note</dt>
            <dd>{doc.notes}</dd>
          </>
        )}
        <dt>Example</dt>
        <dd><pre className="code-block">{doc.example}</pre></dd>
      </dl>
    </div>
  );
}

const CATEGORIES = [...new Set(Object.values(INSTRUCTION_DOCS).map((d) => d.category))];

export default function ReferencePanel() {
  const [selected, setSelected] = useState('MOV');
  const [filter, setFilter] = useState('');
  const names = Object.keys(INSTRUCTION_DOCS).filter((n) => n.includes(filter.trim().toUpperCase()));
  return (
    <div className="reference-layout">
      <Card
        id="isa"
        title="Supported instructions"
        subtitle={`${SUPPORTED_MNEMONICS.length} instructions · a documented subset of the 8086, not the full set`}
      >
        <input className="input" placeholder="Filter, e.g. J or MOV" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter instructions" />
        {CATEGORIES.map((cat) => {
          const inCat = names.filter((n) => INSTRUCTION_DOCS[n].category === cat);
          if (!inCat.length) return null;
          return (
            <div key={cat} className="ref-group">
              <h3 className="group-title">{cat}</h3>
              <div className="chips">
                {inCat.map((name) => (
                  <button key={name} type="button" className={`chip ${selected === name ? 'active' : ''}`} onClick={() => setSelected(name)}>{name}</button>
                ))}
              </div>
            </div>
          );
        })}
        {!names.length && <p className="empty">No instruction matches “{filter}”.</p>}
      </Card>
      <Card id="isa-detail" title="Details">
        <ReferenceCard doc={getInstructionDoc(selected)} />
      </Card>
    </div>
  );
}
