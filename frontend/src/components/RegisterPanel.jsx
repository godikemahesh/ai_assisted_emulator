import { hex16, hex8, hex20, physicalAddress } from '../emulator/index.js';
import Card from './Card.jsx';

const GROUPS = [
  { title: 'General purpose', regs: ['AX', 'BX', 'CX', 'DX'], split: true },
  { title: 'Pointer & index', regs: ['SI', 'DI', 'BP', 'SP'] },
  { title: 'Segment', regs: ['CS', 'DS', 'SS', 'ES'] },
];

const DESCRIPTIONS = {
  AX: 'Accumulator', BX: 'Base', CX: 'Count (used by LOOP)', DX: 'Data', SI: 'Source index', DI: 'Destination index',
  BP: 'Base pointer (defaults to SS)', SP: 'Stack pointer', CS: 'Code segment', DS: 'Data segment', SS: 'Stack segment',
  ES: 'Extra segment', IP: 'Instruction pointer (offset of next instruction in CS)',
};

export default function RegisterPanel({ registers, changed }) {
  const reg = (name, split = false) => {
    const v = registers[name];
    return (
      <div key={name} className={`reg ${changed.has(name) ? 'changed' : ''}`} title={`${DESCRIPTIONS[name]} — ${v} decimal`}>
        <div className="reg-top">
          <span className="reg-name">{name}</span>
          <span className="reg-value" data-testid={`reg-${name}`}>{hex16(v)}</span>
        </div>
        {split && (
          <div className="reg-halves">
            <span>{name[0]}H <b>{hex8(v >> 8)}</b></span>
            <span>{name[0]}L <b>{hex8(v)}</b></span>
          </div>
        )}
      </div>
    );
  };

  return (
    <Card id="registers" title="Registers" subtitle="hexadecimal · highlighted = changed by last step">
      {GROUPS.map((g) => (
        <div key={g.title} className="reg-group">
          <h3 className="group-title">{g.title}</h3>
          <div className="reg-grid">{g.regs.map((r) => reg(r, g.split))}</div>
        </div>
      ))}
      <div className="reg-group">
        <h3 className="group-title">Instruction pointer &amp; addresses</h3>
        <div className="reg-grid">
          {reg('IP')}
          <div className="reg addr">
            <span className="reg-name">CS:IP</span>
            <span className="addr-value">{hex16(registers.CS)}:{hex16(registers.IP)} → {hex20(physicalAddress(registers.CS, registers.IP))}h</span>
          </div>
          <div className="reg addr">
            <span className="reg-name">SS:SP</span>
            <span className="addr-value">{hex16(registers.SS)}:{hex16(registers.SP)} → {hex20(physicalAddress(registers.SS, registers.SP))}h</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
