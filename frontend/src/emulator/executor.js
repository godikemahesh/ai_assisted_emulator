// Executor: carries out one decoded instruction.
// This is the "execute" stage. It changes CPU registers/flags and memory through
// the `machine` interface supplied by the Emulator (which does the bounds checks).

import { MASK } from './constants.js';
import { asmHex } from './format.js';
import { add, sub, logic, shift } from './alu.js';
import { formatOperand } from './decoder.js';

export class ExecutionError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'ExecutionError';
    this.hint = hint;
  }
}

/** Effective address (offset) of a memory operand: base + index + displacement, wrapped to 16 bits. */
export function effectiveAddress(op, cpu) {
  let offset = op.disp;
  for (const r of op.regs) offset += cpu.get(r);
  return offset & 0xffff;
}

const CONDITIONS = {
  JO: (f) => f.OF, JNO: (f) => !f.OF, JB: (f) => f.CF, JAE: (f) => !f.CF,
  JE: (f) => f.ZF, JNE: (f) => !f.ZF, JBE: (f) => f.CF || f.ZF, JA: (f) => !f.CF && !f.ZF,
  JS: (f) => f.SF, JNS: (f) => !f.SF, JP: (f) => f.PF, JNP: (f) => !f.PF,
  JL: (f) => f.SF !== f.OF, JGE: (f) => f.SF === f.OF,
  JLE: (f) => f.ZF || f.SF !== f.OF, JG: (f) => !f.ZF && f.SF === f.OF,
};

const FLAG_HINTS = {
  JO: 'OF', JNO: 'OF', JB: 'CF', JAE: 'CF', JE: 'ZF', JNE: 'ZF', JBE: 'CF, ZF', JA: 'CF, ZF',
  JS: 'SF', JNS: 'SF', JP: 'PF', JNP: 'PF', JL: 'SF, OF', JGE: 'SF, OF', JLE: 'ZF, SF, OF', JG: 'ZF, SF, OF',
};

/**
 * @param {object} instr    decoded instruction (from decoder.decode)
 * @param {object} machine  { cpu, readMem(seg, off, size), writeMem(seg, off, size, value), push(v), pop() }
 * @returns {{ description: string }}
 */
export function execute(instr, machine) {
  const { cpu } = machine;
  const [a, b] = instr.operands;
  const size = instr.size;
  const hx = (v, s = size) => asmHex(v, s);
  const name = (op) => formatOperand(op);

  const read = (op) => {
    switch (op.type) {
      case 'reg': return op.size === 8 ? cpu.getReg8(op.index) : cpu.getReg16(op.index);
      case 'sreg': return cpu.sregs[op.index];
      case 'imm': return op.value & MASK[op.size];
      case 'mem': return machine.readMem(op.segment, effectiveAddress(op, cpu), op.size);
      default: throw new ExecutionError(`Cannot read operand of type ${op.type}`);
    }
  };
  const write = (op, value) => {
    switch (op.type) {
      case 'reg':
        if (op.size === 8) cpu.setReg8(op.index, value);
        else cpu.setReg16(op.index, value);
        return;
      case 'sreg':
        cpu.sregs[op.index] = value & 0xffff;
        return;
      case 'mem':
        machine.writeMem(op.segment, effectiveAddress(op, cpu), op.size, value);
        return;
      default:
        throw new ExecutionError(`Cannot write to operand of type ${op.type}`);
    }
  };
  const flags = () => ({
    CF: !!cpu.getFlag('CF'), ZF: !!cpu.getFlag('ZF'), SF: !!cpu.getFlag('SF'), OF: !!cpu.getFlag('OF'), PF: !!cpu.getFlag('PF'),
  });
  const jumpTo = (target) => {
    cpu.ip = target;
  };

  const mn = instr.mnemonic;
  switch (mn) {
    case 'MOV': {
      const v = read(b);
      write(a, v);
      return { description: `${name(a)} ← ${hx(v, b.size ?? size)}` };
    }
    case 'XCHG': {
      const va = read(a);
      const vb = read(b);
      write(a, vb);
      write(b, va);
      return { description: `${name(a)} ↔ ${name(b)}: ${name(a)} = ${hx(vb)}, ${name(b)} = ${hx(va)}` };
    }
    case 'LEA': {
      const offset = effectiveAddress(b, cpu);
      write(a, offset);
      return { description: `${name(a)} ← effective address of ${name(b)} = ${hx(offset, 16)}` };
    }
    case 'ADD':
    case 'ADC':
    case 'SUB':
    case 'SBB':
    case 'CMP': {
      const x = read(a);
      const y = read(b);
      const carry = mn === 'ADC' || mn === 'SBB' ? cpu.getFlag('CF') : 0;
      const r = mn === 'ADD' || mn === 'ADC' ? add(x, y, carry, size) : sub(x, y, carry, size);
      cpu.setFlags(r.flags);
      const op = mn === 'ADD' || mn === 'ADC' ? '+' : '−';
      const carryText = carry ? ` ${op} CF(1)` : (mn === 'ADC' || mn === 'SBB' ? ` ${op} CF(0)` : '');
      if (mn === 'CMP') return { description: `compare ${hx(x)} − ${hx(y)} = ${hx(r.result)} (result discarded, only flags change)` };
      write(a, r.result);
      return { description: `${name(a)} ← ${hx(x)} ${op} ${hx(y)}${carryText} = ${hx(r.result)}` };
    }
    case 'AND':
    case 'OR':
    case 'XOR':
    case 'TEST': {
      const x = read(a);
      const y = read(b);
      const r = logic(mn, x, y, size);
      cpu.setFlags(r.flags);
      if (mn === 'TEST') return { description: `test ${hx(x)} AND ${hx(y)} = ${hx(r.result)} (result discarded, only flags change)` };
      write(a, r.result);
      return { description: `${name(a)} ← ${hx(x)} ${mn} ${hx(y)} = ${hx(r.result)}` };
    }
    case 'INC':
    case 'DEC': {
      const x = read(a);
      const r = mn === 'INC' ? add(x, 1, 0, size) : sub(x, 1, 0, size);
      const { CF, ...rest } = r.flags; // INC/DEC never change CF
      cpu.setFlags(rest);
      write(a, r.result);
      return { description: `${name(a)} ← ${hx(x)} ${mn === 'INC' ? '+' : '−'} 1 = ${hx(r.result)} (CF unchanged)` };
    }
    case 'NEG': {
      const x = read(a);
      const r = sub(0, x, 0, size);
      cpu.setFlags(r.flags);
      write(a, r.result);
      return { description: `${name(a)} ← 0 − ${hx(x)} = ${hx(r.result)}` };
    }
    case 'NOT': {
      const x = read(a);
      const result = ~x & MASK[size];
      write(a, result);
      return { description: `${name(a)} ← NOT ${hx(x)} = ${hx(result)} (flags unchanged)` };
    }
    case 'MUL': {
      const src = read(a);
      if (size === 8) {
        const al = cpu.getReg8(0);
        const result = al * src;
        cpu.setReg16(0, result);
        const upper = (result & 0xff00) !== 0;
        cpu.setFlags({ CF: upper, OF: upper });
        return { description: `AX ← AL × ${name(a)} = ${hx(al, 8)} × ${hx(src, 8)} = ${hx(result, 16)}` };
      }
      const ax = cpu.getReg16(0);
      const result = ax * src; // fits exactly in a JS number (< 2^32)
      const dx = Math.floor(result / 0x10000);
      cpu.setReg16(2, dx);
      cpu.setReg16(0, result & 0xffff);
      cpu.setFlags({ CF: dx !== 0, OF: dx !== 0 });
      return { description: `DX:AX ← AX × ${name(a)} = ${hx(ax)} × ${hx(src)} = ${hx(dx)}:${hx(result & 0xffff)}` };
    }
    case 'DIV': {
      const divisor = read(a);
      if (divisor === 0) {
        throw new ExecutionError('Divide error: division by zero', 'A real 8086 would raise interrupt 0 here. Check the divisor before DIV.');
      }
      if (size === 8) {
        const dividend = cpu.getReg16(0);
        const q = Math.floor(dividend / divisor);
        if (q > 0xff) {
          throw new ExecutionError(
            `Divide error: ${hx(dividend, 16)} ÷ ${hx(divisor, 8)} = ${q}, which does not fit in AL`,
            'For 8-bit DIV the quotient must be 0..255. Use a 16-bit divisor or clear AH first.',
          );
        }
        const rem = dividend % divisor;
        cpu.setReg8(0, q);
        cpu.setReg8(4, rem);
        return { description: `AL ← AX ÷ ${name(a)} = ${hx(q, 8)}, AH ← remainder ${hx(rem, 8)}` };
      }
      const dividend = cpu.getReg16(2) * 0x10000 + cpu.getReg16(0);
      const q = Math.floor(dividend / divisor);
      if (q > 0xffff) {
        throw new ExecutionError(
          `Divide error: DX:AX ÷ ${hx(divisor)} = ${q}, which does not fit in AX`,
          'For 16-bit DIV the quotient must be 0..65535. Did you forget MOV DX, 0 before DIV?',
        );
      }
      const rem = dividend % divisor;
      cpu.setReg16(0, q);
      cpu.setReg16(2, rem);
      return { description: `AX ← DX:AX ÷ ${name(a)} = ${hx(q)}, DX ← remainder ${hx(rem)}` };
    }
    case 'SHL':
    case 'SHR':
    case 'SAR': {
      const x = read(a);
      const count = read(b) & 0xff;
      const r = shift(mn, x, count, size);
      cpu.setFlags(r.flags);
      write(a, r.result);
      return { description: `${name(a)} ← ${hx(x)} ${mn} ${count} = ${hx(r.result)}` };
    }
    case 'PUSH': {
      // 8086 quirk: PUSH SP stores the value SP has *after* being decremented.
      const value = a.type === 'reg' && a.name === 'SP' ? (cpu.getReg16(4) - 2) & 0xffff : read(a);
      machine.push(value);
      return { description: `SP ← SP − 2 = ${hx(cpu.getReg16(4), 16)}; [SS:${hx(cpu.getReg16(4), 16)}] ← ${hx(value, 16)}` };
    }
    case 'POP': {
      const at = cpu.getReg16(4);
      const value = machine.pop();
      write(a, value);
      return { description: `${name(a)} ← [SS:${hx(at, 16)}] = ${hx(value, 16)}; SP ← SP + 2` };
    }
    case 'JMP':
      jumpTo(a.target);
      return { description: `jump to ${hx(a.target, 16)}`, jumped: true };
    case 'CALL':
      machine.push(cpu.ip);
      {
        const ret = cpu.ip;
        jumpTo(a.target);
        return { description: `push return address ${hx(ret, 16)}; jump to ${hx(a.target, 16)}`, jumped: true };
      }
    case 'RET': {
      const target = machine.pop();
      jumpTo(target);
      return { description: `pop return address; IP ← ${hx(target, 16)}`, jumped: true };
    }
    case 'LOOP': {
      const cx = (cpu.getReg16(1) - 1) & 0xffff;
      cpu.setReg16(1, cx);
      if (cx !== 0) {
        jumpTo(a.target);
        return { description: `CX ← CX − 1 = ${hx(cx, 16)}; CX ≠ 0 so jump to ${hx(a.target, 16)}`, jumped: true };
      }
      return { description: 'CX ← CX − 1 = 0000h; CX = 0 so the loop ends' };
    }
    case 'JCXZ': {
      const cx = cpu.getReg16(1);
      if (cx === 0) {
        jumpTo(a.target);
        return { description: `CX = 0, jump to ${hx(a.target, 16)}`, jumped: true };
      }
      return { description: `CX = ${hx(cx, 16)} ≠ 0, no jump` };
    }
    case 'CLC': cpu.setFlag('CF', false); return { description: 'CF ← 0' };
    case 'STC': cpu.setFlag('CF', true); return { description: 'CF ← 1' };
    case 'CMC': cpu.setFlag('CF', !cpu.getFlag('CF')); return { description: `CF ← ${cpu.getFlag('CF')}` };
    case 'CLD': cpu.setFlag('DF', false); return { description: 'DF ← 0' };
    case 'STD': cpu.setFlag('DF', true); return { description: 'DF ← 1' };
    case 'CLI': cpu.setFlag('IF', false); return { description: 'IF ← 0' };
    case 'STI': cpu.setFlag('IF', true); return { description: 'IF ← 1' };
    case 'NOP': return { description: 'no operation' };
    case 'HLT':
      cpu.halted = true;
      return { description: 'processor halted' };
    default: {
      if (CONDITIONS[mn]) {
        const f = flags();
        const taken = CONDITIONS[mn](f);
        const shown = FLAG_HINTS[mn].split(', ').map((k) => `${k}=${f[k] ? 1 : 0}`).join(' ');
        if (taken) {
          jumpTo(a.target);
          return { description: `condition true (${shown}): jump to ${hx(a.target, 16)}`, jumped: true };
        }
        return { description: `condition false (${shown}): continue at ${hx(cpu.ip, 16)}` };
      }
      throw new ExecutionError(`Execution of ${mn} is not implemented`);
    }
  }
}
