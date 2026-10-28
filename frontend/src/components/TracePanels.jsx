import { useEffect, useRef } from 'react';
import { hex16 } from '../emulator/index.js';
import Card from './Card.jsx';

const MAX_ROWS = 500;

export function TracePanel({ trace, dropped }) {
  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [trace.length]);
  const rows = trace.slice(-MAX_ROWS);
  const hidden = trace.length - rows.length + dropped;
  return (
    <Card id="trace" title="Execution trace" subtitle={`${trace.length + dropped} entries${hidden > 0 ? ` · ${hidden} oldest hidden` : ''}`} bodyClassName="flush">
      {!trace.length ? (
        <p className="empty pad">No instructions executed yet. Press <b>Step</b> or <b>Run</b>.</p>
      ) : (
        <div className="table-scroll" ref={scrollRef}>
          <table className="table trace-table" data-testid="trace-table">
            <thead>
              <tr><th>#</th><th>CS:IP</th><th>Bytes</th><th>Instruction</th><th>Line</th><th>What happened</th><th>Changes</th></tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={`${t.step}-${t.address}-${t.error ? 'e' : ''}`} className={t.error ? 'error-row' : ''}>
                  <td className="muted">{t.step}</td>
                  <td className="mono">{t.address}</td>
                  <td className="mono muted">{t.bytes || ''}</td>
                  <td><code>{t.asm}</code></td>
                  <td className="muted">{t.line ?? ''}</td>
                  <td>{t.error ? <span className="error-text">✕ {t.error}</span> : t.description}</td>
                  <td className="mono small muted">{t.stages?.update ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function ListingPanel({ program, ip }) {
  return (
    <Card
      id="listing"
      title="Assembled listing"
      subtitle={program?.ok ? `${program.code.length} bytes of code at CS:0000 · ${program.data.length} bytes of data at DS:0000` : 'not assembled'}
      bodyClassName="flush"
    >
      {!program?.ok ? (
        <p className="empty pad">Assemble a program to see its machine code.</p>
      ) : (
        <>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr><th>Offset</th><th>Machine code</th><th>Line</th><th>Source</th></tr>
              </thead>
              <tbody>
                {program.listing.map((l) => (
                  <tr key={l.offset} className={l.offset === ip ? 'current-row' : ''}>
                    <td className="mono">{hex16(l.offset)}</td>
                    <td className="mono">{l.bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}</td>
                    <td className="muted">{l.line}</td>
                    <td><code>{l.source}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {Object.keys(program.labels).length > 0 && (
            <p className="hint pad">
              Labels: {Object.entries(program.labels).map(([n, o]) => <code key={n} className="tag">{n} = {hex16(o)}h</code>)}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
