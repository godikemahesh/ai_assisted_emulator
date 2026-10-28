// Decoder: turns machine-code bytes back into an instruction object.
// This is the "decode" stage of the pipeline. It only reads bytes; it never changes state.

import { REG8, REG16, SREG } from './constants.js';
import { hex8, asmHex, toSigned } from './format.js';
import { ALU_OPS, JCC_BY_OPCODE } from './isa.js';

export class DecodeError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'DecodeError';
    this.hint = hint;
  }
}

const RM_REGS = [['BX', 'SI'], ['BX', 'DI'], ['BP', 'SI'], ['BP', 'DI'], ['SI'], ['DI'], ['BP'], ['BX']];
const SEG_PREFIXES = { 0x26: 0, 0x2e: 1, 0x36: 2, 0x3e: 3 };
const SIMPLE = {
  0x90: 'NOP', 0xc3: 'RET', 0xf4: 'HLT', 0xf5: 'CMC', 0xf8: 'CLC', 0xf9: 'STC', 0xfa: 'CLI', 0xfb: 'STI', 0xfc: 'CLD', 0xfd: 'STD',
};
const SHIFTS = { 4: 'SHL', 5: 'SHR', 7: 'SAR' };
const GROUP3 = { 0: 'TEST', 2: 'NOT', 3: 'NEG', 4: 'MUL', 6: 'DIV' };

const reg = (size, index) => ({ type: 'reg', size, index, name: size === 8 ? REG8[index] : REG16[index] });
const sreg = (index) => ({ type: 'sreg', size: 16, index, name: SREG[index] });
const imm = (size, value) => ({ type: 'imm', size, value: value & (size === 8 ? 0xff : 0xffff) });

/**
 * Decode one instruction.
 * @param {(offset:number)=>number} readByte  reads the byte at CS:offset (throws if out of range)
 * @param {number} ip  offset of the first byte
 */
export function decode(readByte, ip) {
  let pos = ip;
  const bytes = [];
  const next = () => {
    const b = readByte(pos & 0xffff);
    bytes.push(b);
    pos++;
    return b;
  };
  const nextWord = () => next() | (next() << 8);
  const unsupported = (op, detail = '') => new DecodeError(
    `Opcode ${hex8(op)}h${detail} at offset ${asmHex(ip)} is not supported by this emulator`,
    'Execution reached bytes that are not a supported instruction. Did IP jump into data, or is HLT missing?',
  );

  let segOverride = null;
  let op = next();
  while (op in SEG_PREFIXES) {
    segOverride = SEG_PREFIXES[op];
    op = next();
  }

  const modrm = (size) => {
    const b = next();
    const mod = b >> 6;
    const regField = (b >> 3) & 7;
    const rm = b & 7;
    if (mod === 3) return { reg: regField, operand: reg(size, rm) };
    let regs;
    let disp = 0;
    if (mod === 0 && rm === 6) {
      regs = [];
      disp = nextWord();
    } else {
      regs = RM_REGS[rm];
      if (mod === 1) disp = toSigned(next(), 8) & 0xffff;
      else if (mod === 2) disp = nextWord();
    }
    const defaultSeg = regs.includes('BP') ? 2 : 3; // BP-based addresses use SS, all others DS
    return {
      reg: regField,
      operand: {
        type: 'mem', size, regs, disp, segment: segOverride ?? defaultSeg, override: segOverride !== null,
      },
    };
  };

  let mnemonic;
  let operands = [];
  let size = 16;
  let target;

  if (op < 0x40 && (op & 7) < 6) {
    // ALU group: ADD OR ADC SBB AND SUB XOR CMP
    mnemonic = ALU_OPS[op >> 3];
    const form = op & 7;
    size = form & 1 ? 16 : 8;
    if (form < 4) {
      const m = modrm(size);
      operands = form < 2 ? [m.operand, reg(size, m.reg)] : [reg(size, m.reg), m.operand];
    } else {
      operands = [reg(size, 0), imm(size, size === 8 ? next() : nextWord())];
    }
  } else if ([0x06, 0x0e, 0x16, 0x1e].includes(op)) {
    mnemonic = 'PUSH';
    operands = [sreg(op >> 3)];
  } else if ([0x07, 0x17, 0x1f].includes(op)) {
    mnemonic = 'POP';
    operands = [sreg(op >> 3)];
  } else if (op >= 0x40 && op <= 0x5f) {
    mnemonic = ['INC', 'DEC', 'PUSH', 'POP'][(op - 0x40) >> 3];
    operands = [reg(16, op & 7)];
  } else if (op >= 0x70 && op <= 0x7f) {
    mnemonic = JCC_BY_OPCODE[op];
    const rel = toSigned(next(), 8);
    target = (ip + bytes.length + rel) & 0xffff;
  } else if (op >= 0x80 && op <= 0x83) {
    size = op === 0x80 || op === 0x82 ? 8 : 16;
    const m = modrm(size);
    mnemonic = ALU_OPS[m.reg];
    let value;
    if (op === 0x83) value = toSigned(next(), 8);
    else value = size === 8 ? next() : nextWord();
    operands = [m.operand, imm(size, value)];
  } else if (op === 0x84 || op === 0x85 || op === 0x86 || op === 0x87 || (op >= 0x88 && op <= 0x8b)) {
    size = op & 1 ? 16 : 8;
    const m = modrm(size);
    mnemonic = op <= 0x85 ? 'TEST' : op <= 0x87 ? 'XCHG' : 'MOV';
    operands = op === 0x8a || op === 0x8b ? [reg(size, m.reg), m.operand] : [m.operand, reg(size, m.reg)];
  } else if (op === 0x8c || op === 0x8e) {
    const m = modrm(16);
    if (m.reg > 3) throw unsupported(op, ` with segment register field ${m.reg}`);
    if (op === 0x8e && m.reg === 1) throw unsupported(op, ' (MOV CS)');
    mnemonic = 'MOV';
    operands = op === 0x8c ? [m.operand, sreg(m.reg)] : [sreg(m.reg), m.operand];
  } else if (op === 0x8d) {
    const m = modrm(16);
    if (m.operand.type !== 'mem') throw unsupported(op, ' with a register source');
    mnemonic = 'LEA';
    operands = [reg(16, m.reg), m.operand];
  } else if (op === 0x8f) {
    const m = modrm(16);
    if (m.reg !== 0) throw unsupported(op, ` /${m.reg}`);
    mnemonic = 'POP';
    operands = [m.operand];
  } else if (op in SIMPLE) {
    mnemonic = SIMPLE[op];
  } else if (op === 0xa8 || op === 0xa9) {
    size = op === 0xa8 ? 8 : 16;
    mnemonic = 'TEST';
    operands = [reg(size, 0), imm(size, size === 8 ? next() : nextWord())];
  } else if (op >= 0xb0 && op <= 0xbf) {
    size = op < 0xb8 ? 8 : 16;
    mnemonic = 'MOV';
    operands = [reg(size, op & 7), imm(size, size === 8 ? next() : nextWord())];
  } else if (op === 0xc6 || op === 0xc7) {
    size = op === 0xc6 ? 8 : 16;
    const m = modrm(size);
    if (m.reg !== 0) throw unsupported(op, ` /${m.reg}`);
    mnemonic = 'MOV';
    operands = [m.operand, imm(size, size === 8 ? next() : nextWord())];
  } else if (op >= 0xd0 && op <= 0xd3) {
    size = op & 1 ? 16 : 8;
    const m = modrm(size);
    mnemonic = SHIFTS[m.reg];
    if (!mnemonic) throw unsupported(op, ` /${m.reg} (rotate instructions are not supported)`);
    operands = [m.operand, op <= 0xd1 ? imm(8, 1) : reg(8, 1)];
  } else if (op === 0xe2 || op === 0xe3 || op === 0xeb) {
    mnemonic = op === 0xe2 ? 'LOOP' : op === 0xe3 ? 'JCXZ' : 'JMP';
    const rel = toSigned(next(), 8);
    target = (ip + bytes.length + rel) & 0xffff;
  } else if (op === 0xe8 || op === 0xe9) {
    mnemonic = op === 0xe8 ? 'CALL' : 'JMP';
    const rel = nextWord();
    target = (ip + bytes.length + rel) & 0xffff;
  } else if (op === 0xf6 || op === 0xf7) {
    size = op === 0xf6 ? 8 : 16;
    const m = modrm(size);
    mnemonic = GROUP3[m.reg];
    if (!mnemonic) throw unsupported(op, ` /${m.reg}`);
    operands = [m.operand];
    if (mnemonic === 'TEST') operands.push(imm(size, size === 8 ? next() : nextWord()));
  } else if (op === 0xfe || op === 0xff) {
    size = op === 0xfe ? 8 : 16;
    const m = modrm(size);
    if (m.reg === 0) mnemonic = 'INC';
    else if (m.reg === 1) mnemonic = 'DEC';
    else if (m.reg === 6 && op === 0xff) mnemonic = 'PUSH';
    else throw unsupported(op, ` /${m.reg}`);
    operands = [m.operand];
  } else {
    throw unsupported(op);
  }

  if (target !== undefined) operands = [{ type: 'rel', target }];
  return { ip, bytes, length: bytes.length, mnemonic, operands, size, segOverride };
}

// ---------------------------------------------------------------- disassembly text

export function formatOperand(op, { showSize = false, labels = {} } = {}) {
  switch (op.type) {
    case 'reg':
    case 'sreg':
      return op.name;
    case 'imm':
      return asmHex(op.value, op.size);
    case 'rel':
      return labels[op.target] ? `${labels[op.target]} (${asmHex(op.target)})` : asmHex(op.target);
    case 'mem': {
      const parts = [...op.regs];
      const signed = toSigned(op.disp, 16);
      let inner = parts.join('+');
      if (!parts.length) inner = asmHex(op.disp);
      else if (signed > 0) inner += `+${asmHex(signed, signed > 0xff ? 16 : 8)}`;
      else if (signed < 0) inner += `-${asmHex(-signed, -signed > 0xff ? 16 : 8)}`;
      const seg = op.override ? `${SREG[op.segment]}:` : '';
      const ptr = showSize ? (op.size === 8 ? 'BYTE PTR ' : 'WORD PTR ') : '';
      return `${ptr}${seg}[${inner}]`;
    }
    default:
      return '?';
  }
}

export function disassemble(instr, labels = {}) {
  const hasReg = instr.operands.some((o) => o.type === 'reg' || o.type === 'sreg');
  const sizeAmbiguous = !hasReg || ['SHL', 'SHR', 'SAR'].includes(instr.mnemonic);
  const text = instr.operands
    .map((o) => formatOperand(o, { showSize: o.type === 'mem' && sizeAmbiguous && instr.mnemonic !== 'LEA', labels }))
    .join(', ');
  return text ? `${instr.mnemonic} ${text}` : instr.mnemonic;
}
