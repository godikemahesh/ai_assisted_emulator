import { useState } from 'react';
import { hex8, hex16, hex20, physicalAddress } from '../emulator/index.js';
import Card from './Card.jsx';

const ROWS = 16;
const COLS = 16;

const parseHex = (text) => {
  const clean = text.trim().replace(/h$/i, '').replace(/^0x/i, '');
  if (!/^[0-9a-f]{1,4}$/i.test(clean)) return null;
  return parseInt(clean, 16);
};

export default function MemoryViewer({ registers, readBytes, changedAddresses }) {
  const [segText, setSegText] = useState(hex16(registers.DS));
  const [offText, setOffText] = useState('0000');
  const seg = parseHex(segText);
  const off = parseHex(offText);
  const valid = seg !== null && off !== null;
  const rowStartOffset = valid ? off & 0xfff0 : 0;
  const base = valid ? physicalAddress(seg, rowStartOffset) : 0;
  const bytes = valid ? readBytes(base, ROWS * COLS) : [];
  const ipAddr = physicalAddress(registers.CS, registers.IP);
  const spAddr = physicalAddress(registers.SS, registers.SP);

  const jump = (s, o) => {
    setSegText(hex16(s));
    setOffText(hex16(o));
  };

  return (
    <Card
      id="memory"
      title="Memory viewer"
      subtitle={valid ? `${hex16(seg)}:${hex16(rowStartOffset)} → physical ${hex20(base)}h` : 'invalid address'}
      actions={(
        <div className="seg-tabs" role="group" aria-label="Jump to">
          <button type="button" className="btn ghost sm" onClick={() => jump(registers.DS, 0)}>DS:0000 data</button>
          <button type="button" className="btn ghost sm" onClick={() => jump(registers.SS, Math.max(0, registers.SP - 0x80))}>SS:SP stack</button>
          <button type="button" className="btn ghost sm" onClick={() => jump(registers.CS, registers.IP)}>CS:IP code</button>
        </div>
      )}
    >
      <div className="mem-controls">
        <label className="field">
          <span>Segment</span>
          <input className="input mono" value={segText} onChange={(e) => setSegText(e.target.value)} aria-label="Memory segment (hex)" maxLength={5} />
        </label>
        <span className="colon">:</span>
        <label className="field">
          <span>Offset</span>
          <input className="input mono" value={offText} onChange={(e) => setOffText(e.target.value)} aria-label="Memory offset (hex)" maxLength={5} />
        </label>
        <div className="legend">
          <span className="key changed">changed</span>
          <span className="key at-ip">CS:IP</span>
          <span className="key at-sp">SS:SP</span>
        </div>
      </div>
      {!valid ? (
        <p className="error-text">Enter a segment and an offset as 1–4 hex digits, e.g. 2000 : 0000.</p>
      ) : (
        <div className="scroll-x">
          <table className="mem-table">
            <thead>
              <tr>
                <th className="addr-col">Address</th>
                {Array.from({ length: COLS }, (_, i) => (
                  <th key={i}>{i.toString(16).toUpperCase()}</th>
                ))}
                <th className="ascii">ASCII</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: ROWS }, (_, r) => {
                const rowOff = (rowStartOffset + r * COLS) & 0xffff;
                const rowBytes = bytes.slice(r * COLS, r * COLS + COLS);
                if (!rowBytes.length) return null;
                return (
                  <tr key={r}>
                    <th className="addr-col" title={`physical ${hex20(base + r * COLS)}h`}>{hex16(seg)}:{hex16(rowOff)}</th>
                    {rowBytes.map((b, c) => {
                      const addr = base + r * COLS + c;
                      const cls = [
                        b === 0 ? 'zero' : '',
                        changedAddresses.has(addr) ? 'changed' : '',
                        addr === ipAddr ? 'at-ip' : '',
                        addr === spAddr || addr === spAddr + 1 ? 'at-sp' : '',
                      ].join(' ');
                      return <td key={c} className={cls} title={`${hex20(addr)}h = ${b}`}>{hex8(b)}</td>;
                    })}
                    <td className="ascii">{rowBytes.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '·')).join('')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint">Physical address = segment × 16 + offset. Words are stored little-endian (low byte first).</p>
    </Card>
  );
}
