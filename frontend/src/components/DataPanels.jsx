import Card from './Card.jsx';

export function VariablesPanel({ variables }) {
  return (
    <Card id="variables" title="Variables" subtitle="from the .DATA section">
      {variables.length === 0 ? (
        <p className="empty">This program defines no variables. Add a <code>.DATA</code> section, e.g. <code>count DB 5</code>.</p>
      ) : (
        <table className="table">
          <thead>
            <tr><th>Name</th><th>Address</th><th>Type</th><th>Value</th></tr>
          </thead>
          <tbody>
            {variables.map((v) => (
              <tr key={v.name}>
                <td><code>{v.name}</code></td>
                <td className="mono">DS:{v.offset}</td>
                <td>{v.size}{v.count > 1 ? ` × ${v.count}` : ''}</td>
                <td className="mono">
                  {v.size === 'BYTE' ? v.value.slice(2) : v.value}h
                  {v.count > 1 && <span className="muted small"> (first)</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function StackPanel({ stack, sp }) {
  return (
    <Card id="stack" title="Stack" subtitle={`SS:SP = ${sp} · grows downward`}>
      {stack.length === 0 ? (
        <p className="empty">The stack is empty. PUSH and CALL put words here.</p>
      ) : (
        <table className="table">
          <thead>
            <tr><th>Offset</th><th>Physical</th><th>Word</th></tr>
          </thead>
          <tbody>
            {stack.map((w, i) => (
              <tr key={w.offset} className={i === 0 ? 'top-row' : ''}>
                <td className="mono">SS:{w.offset}{i === 0 && <span className="tag sm">top</span>}</td>
                <td className="mono">{w.physical}h</td>
                <td className="mono">{w.value}h</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
