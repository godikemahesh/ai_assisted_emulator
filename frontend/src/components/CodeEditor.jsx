import { useRef, useState } from 'react';

const LINE_HEIGHT = 20; // must match --editor-line-height in styles.css

/**
 * A textarea with line numbers, current-line highlighting and error markers.
 * The highlight layers sit behind the transparent textarea and scroll with it.
 */
export default function CodeEditor({ value, onChange, currentLine, errorLines, onCursorLine, onShortcut }) {
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const textareaRef = useRef(null);
  const lineCount = value.split('\n').length;
  const errors = new Set(errorLines);

  const reportCursor = (el) => {
    const line = el.value.slice(0, el.selectionStart).split('\n').length;
    onCursorLine?.(line);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: start, selectionEnd: end } = el;
      const next = `${el.value.slice(0, start)}    ${el.value.slice(end)}`;
      onChange(next);
      requestAnimationFrame(() => {
        el.selectionStart = start + 4;
        el.selectionEnd = start + 4;
      });
      return;
    }
    onShortcut?.(e);
  };

  return (
    <div className="editor" style={{ '--editor-line-height': `${LINE_HEIGHT}px` }}>
      <div className="editor-gutter" aria-hidden="true">
        <div style={{ transform: `translateY(${-scroll.top}px)` }}>
          {Array.from({ length: lineCount }, (_, i) => {
            const n = i + 1;
            const cls = ['gutter-line', n === currentLine ? 'current' : '', errors.has(n) ? 'error' : ''].join(' ');
            return (
              <div key={n} className={cls}>
                {errors.has(n) ? '●' : n === currentLine ? '▶' : ''}
                <span>{n}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="editor-body">
        <div className="editor-highlights" aria-hidden="true" style={{ transform: `translateY(${-scroll.top}px)` }}>
          {[...errors].map((n) => (
            <div key={`e${n}`} className="line-mark error" style={{ top: (n - 1) * LINE_HEIGHT }} />
          ))}
          {currentLine && <div className="line-mark current" style={{ top: (currentLine - 1) * LINE_HEIGHT }} />}
        </div>
        <textarea
          ref={textareaRef}
          className="editor-input"
          value={value}
          spellCheck={false}
          wrap="off"
          autoCapitalize="off"
          autoComplete="off"
          aria-label="Assembly source code"
          onChange={(e) => {
            onChange(e.target.value);
            reportCursor(e.target);
          }}
          onScroll={(e) => setScroll({ top: e.target.scrollTop, left: e.target.scrollLeft })}
          onKeyDown={handleKeyDown}
          onKeyUp={(e) => reportCursor(e.currentTarget)}
          onClick={(e) => reportCursor(e.currentTarget)}
        />
      </div>
    </div>
  );
}
