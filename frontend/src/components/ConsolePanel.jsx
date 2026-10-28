import { useEffect, useRef } from 'react';
import Card from './Card.jsx';

const ICONS = { success: '✓', error: '✕', warning: '!', info: 'i' };

export default function ConsolePanel({ messages, onClear }) {
  const bodyRef = useRef(null);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages.length]);
  return (
    <Card
      id="console"
      title="Output & errors"
      className="console"
      actions={<button type="button" className="btn ghost sm" onClick={onClear}>Clear</button>}
    >
      <div className="console-body" role="log" aria-live="polite" data-testid="console" ref={bodyRef}>
        {messages.length === 0 && <p className="empty">No messages.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.type}`}>
            <span className="msg-icon" aria-hidden="true">{ICONS[m.type]}</span>
            <div className="msg-text">
              <div>{m.text}</div>
              {m.hint && <div className="msg-hint">Hint: {m.hint}</div>}
            </div>
            <span className="msg-time">{m.time}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
