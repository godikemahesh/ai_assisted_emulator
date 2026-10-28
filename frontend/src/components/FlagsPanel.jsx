import { FLAG_ORDER, FLAG_NAMES, hex16 } from '../emulator/index.js';
import Card from './Card.jsx';

const MEANING = {
  CF: 'Set when an unsigned result needed a carry out (ADD) or a borrow (SUB/CMP).',
  PF: 'Set when the low byte of the result has an even number of 1 bits.',
  AF: 'Set on a carry/borrow between bit 3 and bit 4 (used for BCD arithmetic).',
  ZF: 'Set when the result is zero.',
  SF: 'Copy of the top bit of the result (1 = negative as a signed number).',
  TF: 'Trap flag (single-step interrupts). Not used by this emulator.',
  IF: 'Interrupts enabled. Changed by STI/CLI only.',
  DF: 'Direction for string instructions. Changed by STD/CLD only.',
  OF: 'Set when a signed result is too large or too small to fit (signed overflow).',
};

export default function FlagsPanel({ flags, flagsValue, changed }) {
  return (
    <Card
      id="flags"
      title="Flags"
      subtitle="hover a flag for its meaning"
      actions={<code className="tag" data-testid="flags-hex">{hex16(flagsValue)}h</code>}
    >
      <div className="flags">
        {FLAG_ORDER.map((f) => (
          <div
            key={f}
            className={`flag ${flags[f] ? 'on' : 'off'} ${changed.has(f) ? 'changed' : ''}`}
            title={`${FLAG_NAMES[f]} flag: ${MEANING[f]}`}
            data-testid={`flag-${f}`}
          >
            <span className="flag-name">{f}</span>
            <span className="flag-value">{flags[f]}</span>
            <span className="flag-label">{FLAG_NAMES[f]}</span>
          </div>
        ))}
      </div>
      <p className="hint mono">{flagsValue.toString(2).padStart(16, '0').replace(/(\d{4})(?=\d)/g, '$1 ')}</p>
    </Card>
  );
}
