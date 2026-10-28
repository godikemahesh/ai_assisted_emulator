// Two-pass assembler: turns assembly source into real 8086 machine code.
//
// Pass 1 reads every line: sections, labels, variables (DB/DW), constants (EQU)
//         and instruction mnemonics.
// Pass 2 parses operands and encodes instructions to bytes.
// Layout  assigns addresses, choosing short (2-byte) or near (3-byte) JMPs,
//         then resolves jump displacements.

import { REG8, REG16, SREG, SEG, MASK, SIGN } from './constants.js';
import { toSigned } from './format.js';
import {
  INSTRUCTION_DOCS, ALIASES, JCC, ALU_OPS, KNOWN_UNSUPPORTED, LATER_CPU, SUPPORTED_MNEMONICS,
} from './isa.js';

export class AsmError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'AsmError';
    this.hint = hint || null;
  }
}

const IDENT = /^[A-Za-z_?@$][\w?@$]*$/;
const ADDRESS_REGS = ['BX', 'BP', 'SI', 'DI'];
const BRANCHES = new Set([...Object.keys(JCC), 'JMP', 'CALL', 'LOOP', 'JCXZ']);
const NO_OPERAND_OPCODES = {
  RET: 0xc3, HLT: 0xf4, NOP: 0x90, CLC: 0xf8, STC: 0xf9, CMC: 0xf5, CLI: 0xfa, STI: 0xfb, CLD: 0xfc, STD: 0xfd,
};
const UNARY_GROUP = { NOT: 2, NEG: 3, MUL: 4, DIV: 6 };
const SHIFT_GROUP = { SHL: 4, SHR: 5, SAR: 7 };
const RM_TABLE = { 'BX+SI': 0, 'BX+DI': 1, 'BP+SI': 2, 'BP+DI': 3, SI: 4, DI: 5, BP: 6, BX: 7 };

const RESERVED = new Set([
  ...REG8, ...REG16, ...SREG, 'IP', 'FLAGS', 'BYTE', 'WORD', 'PTR', 'OFFSET', 'DUP', 'DB', 'DW', 'EQU',
  'SHORT', 'PROC', 'ENDP', 'END', ...SUPPORTED_MNEMONICS, ...Object.keys(ALIASES),
]);

const isRegisterName = (name) => REG8.includes(name) || REG16.includes(name) || SREG.includes(name);

// ---------------------------------------------------------------- text helpers

/** Remove a ";" comment, ignoring semicolons inside quotes. */
export function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === ';') return line.slice(0, i);
  }
  return line;
}

/** Split on commas that are not inside quotes, brackets or parentheses. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (const c of text) {
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += c;
  }
  parts.push(current.trim());
  return parts;
}

/** Split an expression like "num+2-1" into signed terms. */
function splitTerms(expr) {
  const terms = [];
  let sign = 1;
  let current = '';
  let quote = null;
  for (const c of expr) {
    if (quote) {
      current += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      current += c;
      continue;
    }
    if (c === '+' || c === '-') {
      if (current.trim() === '') {
        if (c === '-') sign = -sign; // unary minus
        continue;
      }
      terms.push({ sign, text: current.trim() });
      current = '';
      sign = c === '-' ? -1 : 1;
      continue;
    }
    current += c;
  }
  if (current.trim() === '') throw new AsmError(`Incomplete expression '${expr.trim()}'`);
  terms.push({ sign, text: current.trim() });
  return terms;
}

/**
 * Parse a numeric literal. Supported forms:
 * decimal 25 / 25d, hexadecimal 19h / 0FFh / 0x19, binary 1010b, character 'A'.
 * Returns null if the text is not a number.
 */
export function parseNumber(text) {
  const s = text.trim();
  if (/^(['"]).\1$/.test(s)) return s.charCodeAt(1);
  if (/^[0-9][0-9a-f]*h$/i.test(s)) return parseInt(s.slice(0, -1), 16);
  if (/^0x[0-9a-f]+$/i.test(s)) return parseInt(s.slice(2), 16);
  if (/^[01]+b$/i.test(s)) return parseInt(s.slice(0, -1), 2);
  if (/^[0-9]+d?$/i.test(s)) return parseInt(s, 10);
  return null;
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

function closestMnemonic(word) {
  let best = null;
  let bestDistance = 3;
  for (const candidate of [...SUPPORTED_MNEMONICS, ...Object.keys(ALIASES)]) {
    const d = levenshtein(word, candidate);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

function canonicalMnemonic(word) {
  if (INSTRUCTION_DOCS[word]) return word;
  if (ALIASES[word]) return ALIASES[word];
  if (KNOWN_UNSUPPORTED.includes(word)) {
    throw new AsmError(
      `${word} is a real 8086 instruction, but this emulator does not support it`,
      'Open the "Instruction reference" panel to see the supported subset.',
    );
  }
  if (LATER_CPU.includes(word)) {
    throw new AsmError(`${word} does not exist on the 8086 (it was added in the 80186 or a later processor)`);
  }
  const suggestion = closestMnemonic(word);
  throw new AsmError(
    `Unknown instruction '${word}'`,
    suggestion ? `Did you mean ${suggestion}?` : 'Check the spelling. See the "Instruction reference" panel for supported instructions.',
  );
}

// ---------------------------------------------------------------- expressions & operands

function unknownSymbol(text, ctx) {
  const up = text.toUpperCase();
  if (isRegisterName(up)) {
    return new AsmError(`Register ${up} cannot be used inside a numeric expression`);
  }
  if (ctx.labels.has(up)) {
    return new AsmError(
      `Code label '${text}' cannot be used as a value`,
      'Labels are only targets for JMP, Jcc, LOOP and CALL. For data, define a variable in .DATA.',
    );
  }
  if (/^[a-f][0-9a-f]*h$/i.test(text)) {
    return new AsmError(`'${text}' is not a valid number`, `Hex numbers must start with a digit: write 0${text}.`);
  }
  return new AsmError(`Undefined symbol '${text}'`, 'Define it as a variable in .DATA, a constant with EQU, or a label with "name:".');
}

/** Evaluate an immediate expression made of numbers, EQU constants and OFFSET var, joined by + and -. */
function evalImmediate(text, ctx) {
  let total = 0;
  for (const term of splitTerms(text)) {
    let value;
    const offset = /^OFFSET\s+(.+)$/i.exec(term.text);
    if (offset) {
      const name = offset[1].trim().toUpperCase();
      if (ctx.variables.has(name)) value = ctx.variables.get(name).offset;
      else if (ctx.labels.has(name)) {
        throw new AsmError(`OFFSET of a code label is not supported`, 'OFFSET works with data variables defined in .DATA.');
      } else throw unknownSymbol(offset[1].trim(), ctx);
    } else {
      value = parseNumber(term.text);
      if (value === null) {
        const up = term.text.toUpperCase();
        if (ctx.constants.has(up)) value = ctx.constants.get(up);
        else if (ctx.variables.has(up)) {
          throw new AsmError(
            `Variable '${term.text}' is a memory location, not a number`,
            `Use OFFSET ${term.text} for its address, or [${term.text}] for its value.`,
          );
        } else throw unknownSymbol(term.text, ctx);
      }
    }
    total += term.sign * value;
  }
  return total;
}

function parseMemoryExpression(inner, ctx) {
  const regs = [];
  let disp = 0;
  let variable = null;
  if (!inner.trim()) throw new AsmError('Empty brackets [ ]', 'Write an address inside, e.g. [BX] or [1000h].');
  for (const term of splitTerms(inner)) {
    const up = term.text.toUpperCase();
    if (isRegisterName(up)) {
      if (!ADDRESS_REGS.includes(up)) {
        throw new AsmError(
          `${up} cannot be used inside [ ] on the 8086`,
          'Only BX or BP (base) and SI or DI (index) can form an address, e.g. [BX+SI+4].',
        );
      }
      if (term.sign < 0) throw new AsmError('A register cannot be subtracted inside an address');
      if (regs.includes(up)) throw new AsmError(`${up} appears twice in the same address`);
      regs.push(up);
    } else if (ctx.variables.has(up)) {
      const v = ctx.variables.get(up);
      disp += term.sign * v.offset;
      if (!variable) variable = v;
    } else {
      disp += term.sign * evalImmediate(term.text, ctx);
    }
  }
  const bases = regs.filter((r) => r === 'BX' || r === 'BP');
  const indexes = regs.filter((r) => r === 'SI' || r === 'DI');
  if (bases.length > 1 || indexes.length > 1) {
    throw new AsmError(
      `Invalid addressing mode [${regs.join('+')}]`,
      'The 8086 allows at most one base register (BX or BP) and one index register (SI or DI).',
    );
  }
  if (disp < -0x10000 || disp > 0xffff) throw new AsmError(`Address offset ${disp} is outside the 64 KB segment`);
  return { regs: [...bases, ...indexes], disp: disp & 0xffff, variable };
}

function parseOperand(raw, ctx) {
  let text = raw.trim();
  if (!text) throw new AsmError('Missing operand', 'Check for a stray comma.');
  let size = null;
  let seg = null;
  let m = /^(BYTE|WORD)\s+(?:PTR\s+)?(.+)$/i.exec(text);
  if (m) {
    size = m[1].toUpperCase() === 'BYTE' ? 8 : 16;
    text = m[2].trim();
  }
  m = /^(ES|CS|SS|DS)\s*:\s*(.+)$/i.exec(text);
  if (m) {
    seg = SEG[m[1].toUpperCase()];
    text = m[2].trim();
  }
  const up = text.toUpperCase();

  if (isRegisterName(up)) {
    if (size !== null || seg !== null) {
      throw new AsmError(`'${raw.trim()}' is not valid: PTR and segment overrides only apply to memory operands`);
    }
    if (REG16.includes(up)) return { type: 'reg', size: 16, index: REG16.indexOf(up), name: up, text: up };
    if (REG8.includes(up)) return { type: 'reg', size: 8, index: REG8.indexOf(up), name: up, text: up };
    return { type: 'sreg', size: 16, index: SREG.indexOf(up), name: up, text: up };
  }

  let inner = null;
  if ((m = /^\[(.*)\]$/s.exec(text))) inner = m[1].replace(/\]\s*\[/g, '+');
  else if ((m = /^([A-Za-z_?@$][\w?@$]*)\s*\[(.*)\]$/s.exec(text))) inner = `${m[1]}+${m[2].replace(/\]\s*\[/g, '+')}`;
  else if (text.includes('[') || text.includes(']')) throw new AsmError(`Unbalanced brackets in '${raw.trim()}'`);
  else if (!/^OFFSET\s/i.test(text)) {
    // MASM style: a bare variable name (optionally +/- a number) is a memory operand.
    try {
      if (splitTerms(text).some((t) => ctx.variables.has(t.text.toUpperCase()))) inner = text;
    } catch {
      // not an expression; handled below
    }
  }

  if (inner !== null) {
    const mem = parseMemoryExpression(inner, ctx);
    return {
      type: 'mem',
      size: size ?? (mem.variable ? mem.variable.size : null),
      regs: mem.regs,
      disp: mem.disp,
      seg,
      variable: mem.variable,
      text: raw.trim(),
    };
  }
  if (seg !== null) throw new AsmError('A segment override must be followed by a memory operand, e.g. ES:[BX]');
  if (size !== null) throw new AsmError('BYTE PTR / WORD PTR can only be used with memory operands');
  if (IDENT.test(text) && ctx.labels.has(up)) return { type: 'label', name: up, text };
  return { type: 'imm', value: evalImmediate(text, ctx), text };
}

// ---------------------------------------------------------------- encoding helpers

function immBytes(value, size) {
  const v = value & MASK[size];
  return size === 8 ? [v] : [v & 0xff, v >> 8];
}

function checkImm(op, size) {
  if (op.value < -SIGN[size] || op.value > MASK[size]) {
    throw new AsmError(
      `Value ${op.text} does not fit in an ${size}-bit operand`,
      size === 8 ? '8-bit operands hold −128..255 (00h–FFh).' : '16-bit operands hold −32768..65535 (0000h–FFFFh).',
    );
  }
}

function modrm(regField, op) {
  if (op.type === 'reg' || op.type === 'sreg') return [0xc0 | (regField << 3) | op.index];
  const key = op.regs.join('+');
  const disp = op.disp & 0xffff;
  if (key === '') return [0x06 | (regField << 3), disp & 0xff, disp >> 8]; // direct address [disp16]
  const rm = RM_TABLE[key];
  const signed = toSigned(disp, 16);
  if (disp === 0 && rm !== 6) return [(regField << 3) | rm];
  if (signed >= -128 && signed <= 127) return [0x40 | (regField << 3) | rm, signed & 0xff];
  return [0x80 | (regField << 3) | rm, disp & 0xff, disp >> 8];
}

const prefix = (op) => (op.type === 'mem' && op.seg !== null ? [0x26 | (op.seg << 3)] : []);

function rejectSpecial(mn, ...ops) {
  for (const op of ops) {
    if (op.type === 'label') {
      throw new AsmError(
        `Label '${op.text}' cannot be used as an operand of ${mn}`,
        'Code labels are only jump/call targets. For data, define a variable in .DATA.',
      );
    }
    if (op.type === 'sreg') {
      throw new AsmError(
        `Segment register ${op.name} cannot be used with ${mn}`,
        `Only MOV, PUSH and POP accept segment registers. Copy it first: MOV AX, ${op.name}`,
      );
    }
  }
}

function rejectImmDest(mn, dst) {
  if (dst.type === 'imm') {
    throw new AsmError(
      `The destination of ${mn} cannot be a constant value`,
      'The first operand receives the result, so it must be a register or a memory location.',
    );
  }
}

function rejectMemMem(a, b) {
  if (a.type === 'mem' && b.type === 'mem') {
    throw new AsmError(
      'The 8086 cannot use two memory operands in one instruction',
      'Load one value into a register first, e.g. MOV AX, [a] then MOV [b], AX.',
    );
  }
}

function resolveSize(mn, a, b) {
  const sa = a.type === 'reg' || a.type === 'mem' ? a.size : null;
  const sb = b && (b.type === 'reg' || b.type === 'mem') ? b.size : null;
  if (sa && sb && sa !== sb) {
    const memOp = [a, b].find((o) => o.type === 'mem' && o.variable);
    throw new AsmError(
      `Operand size mismatch: ${a.text} is ${sa}-bit but ${b.text} is ${sb}-bit`,
      memOp
        ? `Both operands must be the same size. To access one byte of a word variable write BYTE PTR ${memOp.text.replace(/^(BYTE|WORD)\s+(PTR\s+)?/i, '')}.`
        : 'Both operands must be the same size: use AL/BL/... with 8-bit values and AX/BX/... with 16-bit values.',
    );
  }
  const size = sa || sb;
  if (!size) {
    throw new AsmError(
      `Operand size is ambiguous for ${mn}`,
      `Say how many bytes to use, e.g. ${mn} WORD PTR ${a.text}${b ? `, ${b.text}` : ''} or BYTE PTR.`,
    );
  }
  return size;
}

function encodeMov(d, s) {
  for (const op of [d, s]) {
    if (op.type === 'label') rejectSpecial('MOV', op);
  }
  rejectImmDest('MOV', d);
  if (d.type === 'sreg') {
    if (d.name === 'CS') {
      throw new AsmError('MOV CS, ... is not allowed', 'CS changes only through far jumps and calls, which this emulator does not support.');
    }
    if (s.type === 'imm') {
      throw new AsmError(
        `Cannot move a constant directly into ${d.name}`,
        `The 8086 has no such instruction. Use a general register: MOV AX, ${s.text} then MOV ${d.name}, AX.`,
      );
    }
    if (s.type === 'sreg') throw new AsmError('Cannot move one segment register into another', `Copy through a general register: MOV AX, ${s.name} then MOV ${d.name}, AX.`);
    if (s.size === 8) throw new AsmError(`${d.name} is 16-bit but ${s.text} is 8-bit`);
    return [...prefix(s), 0x8e, ...modrm(d.index, s)];
  }
  if (s.type === 'sreg') {
    if (d.size === 8) throw new AsmError(`${s.name} is 16-bit but ${d.text} is 8-bit`);
    return [...prefix(d), 0x8c, ...modrm(s.index, d)];
  }
  rejectMemMem(d, s);
  const size = resolveSize('MOV', d, s);
  const w = size === 16 ? 1 : 0;
  if (s.type === 'imm') {
    checkImm(s, size);
    if (d.type === 'reg') return [0xb0 + w * 8 + d.index, ...immBytes(s.value, size)];
    return [...prefix(d), 0xc6 + w, ...modrm(0, d), ...immBytes(s.value, size)];
  }
  if (s.type === 'reg') return [...prefix(d), 0x88 + w, ...modrm(s.index, d)];
  return [...prefix(s), 0x8a + w, ...modrm(d.index, s)];
}

function encodeAlu(mn, d, s) {
  rejectSpecial(mn, d, s);
  rejectImmDest(mn, d);
  rejectMemMem(d, s);
  const idx = ALU_OPS.indexOf(mn);
  const base = idx * 8;
  const size = resolveSize(mn, d, s);
  const w = size === 16 ? 1 : 0;
  if (s.type === 'imm') {
    checkImm(s, size);
    const signed = toSigned(s.value, size);
    const fitsSignExtended = size === 16 && signed >= -128 && signed <= 127;
    if (d.type === 'reg' && d.index === 0 && !fitsSignExtended) return [base + 4 + w, ...immBytes(s.value, size)];
    if (fitsSignExtended) return [...prefix(d), 0x83, ...modrm(idx, d), s.value & 0xff];
    return [...prefix(d), 0x80 + w, ...modrm(idx, d), ...immBytes(s.value, size)];
  }
  if (s.type === 'reg') return [...prefix(d), base + w, ...modrm(s.index, d)];
  return [...prefix(s), base + 2 + w, ...modrm(d.index, s)];
}

function encodeTest(d, s) {
  rejectSpecial('TEST', d, s);
  rejectImmDest('TEST', d);
  rejectMemMem(d, s);
  const size = resolveSize('TEST', d, s);
  const w = size === 16 ? 1 : 0;
  if (s.type === 'imm') {
    checkImm(s, size);
    if (d.type === 'reg' && d.index === 0) return [0xa8 + w, ...immBytes(s.value, size)];
    return [...prefix(d), 0xf6 + w, ...modrm(0, d), ...immBytes(s.value, size)];
  }
  const [reg, other] = s.type === 'reg' ? [s, d] : [d, s];
  return [...prefix(other), 0x84 + w, ...modrm(reg.index, other)];
}

function encodeXchg(a, b) {
  rejectSpecial('XCHG', a, b);
  if (a.type === 'imm' || b.type === 'imm') throw new AsmError('XCHG cannot use a constant value', 'Both operands must be registers or memory.');
  rejectMemMem(a, b);
  const size = resolveSize('XCHG', a, b);
  const [reg, other] = b.type === 'reg' ? [b, a] : [a, b];
  return [...prefix(other), 0x86 + (size === 16 ? 1 : 0), ...modrm(reg.index, other)];
}

function encodeLea(d, s) {
  if (d.type !== 'reg' || d.size !== 16) throw new AsmError('LEA needs a 16-bit register as destination', 'Example: LEA SI, [BX+2]');
  if (s.type !== 'mem') throw new AsmError('LEA needs a memory operand as source', 'Example: LEA SI, [BX+2] or LEA SI, myVar');
  return [0x8d, ...modrm(d.index, s)];
}

function unaryOperand(mn, op) {
  rejectSpecial(mn, op);
  if (op.type === 'imm') {
    throw new AsmError(
      `${mn} cannot take a constant operand`,
      mn === 'MUL' || mn === 'DIV' ? `Load it into a register first: MOV BL, ${op.text} then ${mn} BL.` : 'Use a register or memory operand.',
    );
  }
  return resolveSize(mn, op);
}

function encodeIncDec(mn, op) {
  const size = unaryOperand(mn, op);
  const sub = mn === 'INC' ? 0 : 1;
  if (op.type === 'reg' && size === 16) return [(mn === 'INC' ? 0x40 : 0x48) + op.index];
  return [...prefix(op), size === 16 ? 0xff : 0xfe, ...modrm(sub, op)];
}

function encodeShift(mn, d, count) {
  const size = unaryOperand(mn, d);
  const w = size === 16 ? 1 : 0;
  if (count.type === 'imm' && count.value === 1) return [...prefix(d), 0xd0 + w, ...modrm(SHIFT_GROUP[mn], d)];
  if (count.type === 'reg' && count.name === 'CL') return [...prefix(d), 0xd2 + w, ...modrm(SHIFT_GROUP[mn], d)];
  throw new AsmError(
    `On the 8086 the shift count must be 1 or CL (got ${count.text})`,
    count.type === 'imm' ? `Use: MOV CL, ${count.text} then ${mn} ${d.text}, CL` : undefined,
  );
}

function encodeStack(mn, op) {
  if (op.type === 'label') rejectSpecial(mn, op);
  if (op.type === 'imm') {
    throw new AsmError(
      `${mn} with a constant is not an 8086 instruction${mn === 'PUSH' ? ' (PUSH imm was added in the 80186)' : ''}`,
      mn === 'PUSH' ? `Use a register: MOV AX, ${op.text} then PUSH AX.` : 'POP needs a register or memory operand.',
    );
  }
  if (op.size === 8) throw new AsmError(`${mn} works with 16-bit operands only (${op.text} is 8-bit)`, `Use the full register, e.g. ${mn} AX.`);
  if (op.type === 'reg') return [(mn === 'PUSH' ? 0x50 : 0x58) + op.index];
  if (op.type === 'sreg') {
    if (mn === 'POP' && op.name === 'CS') throw new AsmError('POP CS is not allowed');
    return [(mn === 'PUSH' ? 0x06 : 0x07) | (op.index << 3)];
  }
  return mn === 'PUSH' ? [...prefix(op), 0xff, ...modrm(6, op)] : [...prefix(op), 0x8f, ...modrm(0, op)];
}

function encode(mn, ops) {
  const expect = (n) => {
    if (ops.length !== n) {
      throw new AsmError(
        `${mn} expects ${n} operand${n === 1 ? '' : 's'} but got ${ops.length}`,
        `Syntax: ${INSTRUCTION_DOCS[mn].syntax.join('  |  ')}`,
      );
    }
  };
  if (mn in NO_OPERAND_OPCODES) {
    expect(0);
    return [NO_OPERAND_OPCODES[mn]];
  }
  if (mn in UNARY_GROUP) {
    expect(1);
    const size = unaryOperand(mn, ops[0]);
    return [...prefix(ops[0]), size === 16 ? 0xf7 : 0xf6, ...modrm(UNARY_GROUP[mn], ops[0])];
  }
  if (mn in SHIFT_GROUP) {
    expect(2);
    return encodeShift(mn, ops[0], ops[1]);
  }
  if (ALU_OPS.includes(mn)) {
    expect(2);
    return encodeAlu(mn, ops[0], ops[1]);
  }
  switch (mn) {
    case 'MOV': expect(2); return encodeMov(ops[0], ops[1]);
    case 'XCHG': expect(2); return encodeXchg(ops[0], ops[1]);
    case 'LEA': expect(2); return encodeLea(ops[0], ops[1]);
    case 'TEST': expect(2); return encodeTest(ops[0], ops[1]);
    case 'INC':
    case 'DEC': expect(1); return encodeIncDec(mn, ops[0]);
    case 'PUSH':
    case 'POP': expect(1); return encodeStack(mn, ops[0]);
    default: throw new AsmError(`No encoder for ${mn}`);
  }
}

// ---------------------------------------------------------------- data definitions

function parseDataValues(text, size, ctx) {
  if (!text.trim()) throw new AsmError('DB/DW needs at least one value', 'Example: count DB 5   or   buffer DB 4 DUP(0)');
  const out = [];
  for (const part of splitTopLevel(text)) {
    if (!part) throw new AsmError('Empty value in data list (check for a double comma)');
    let m = /^(.+?)\s+DUP\s*\((.*)\)$/i.exec(part);
    if (m) {
      const count = evalImmediate(m[1], ctx);
      if (count < 1 || count > 0xffff) throw new AsmError(`DUP count ${count} must be between 1 and 65535`);
      const inner = parseDataValues(m[2], size, ctx);
      for (let i = 0; i < count; i++) out.push(...inner);
      continue;
    }
    if (part === '?') {
      out.push(...(size === 8 ? [0] : [0, 0]));
      continue;
    }
    m = /^(['"])(.*)\1$/s.exec(part);
    if (m && m[2].length > 1) {
      if (size !== 8) throw new AsmError('Text strings can only be defined with DB');
      for (const ch of m[2]) out.push(ch.charCodeAt(0) & 0xff);
      continue;
    }
    const value = evalImmediate(part, ctx);
    checkImm({ value, text: part }, size);
    out.push(...immBytes(value, size));
  }
  return out;
}

// ---------------------------------------------------------------- main entry point

/**
 * Assemble source code.
 * @returns {object} program: { ok, errors, warnings, code, data, listing, labels, variables, ... }
 */
export function assemble(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const errors = [];
  const warnings = [];
  const ctx = { variables: new Map(), labels: new Map(), constants: new Map() };
  const items = [];
  const data = [];
  let section = 'code';
  let ended = false;

  const report = (line, e) => {
    if (!(e instanceof AsmError)) throw e;
    errors.push({ line, message: e.message, hint: e.hint, source: line ? lines[line - 1].trim() : '' });
  };

  const defineSymbol = (name, kind) => {
    const up = name.toUpperCase();
    if (RESERVED.has(up) || KNOWN_UNSUPPORTED.includes(up)) throw new AsmError(`'${name}' is a reserved word and cannot be used as a ${kind} name`);
    if (ctx.labels.has(up) || ctx.variables.has(up) || ctx.constants.has(up)) throw new AsmError(`'${name}' is defined more than once`);
    return up;
  };

  // ---- pass 1
  lines.forEach((rawLine, i) => {
    const lineNo = i + 1;
    if (ended) return;
    try {
      let text = stripComment(rawLine).trim();
      if (!text) return;
      let m;
      if (/^\.DATA$/i.test(text)) {
        section = 'data';
        return;
      }
      if (/^\.CODE$/i.test(text)) {
        section = 'code';
        return;
      }
      if ((m = /^\.(MODEL|STACK)\b/i.exec(text))) {
        warnings.push({ line: lineNo, message: `.${m[1].toUpperCase()} is accepted but ignored: this emulator uses a fixed memory layout.` });
        return;
      }
      if (/^END(\s+\w+)?$/i.test(text)) {
        ended = true;
        return;
      }
      if (/^ORG\b/i.test(text)) throw new AsmError('ORG is not supported', 'Code always starts at CS:0000h and data at DS:0000h.');
      if ((m = /^([A-Za-z_?@$][\w?@$]*)\s+ENDP$/i.exec(text))) return;
      if ((m = /^([A-Za-z_?@$][\w?@$]*)\s+PROC\b/i.exec(text))) {
        text = `${m[1]}:`;
      }
      if ((m = /^([A-Za-z_?@$][\w?@$]*)\s+EQU\s+(.+)$/i.exec(text))) {
        const name = defineSymbol(m[1], 'constant');
        ctx.constants.set(name, evalImmediate(m[2], ctx));
        return;
      }
      while ((m = /^([A-Za-z_?@$][\w?@$]*)\s*:(?!\s*\[)(.*)$/.exec(text))) {
        if (section === 'data') throw new AsmError('Code labels (name:) belong in the .CODE section', 'In .DATA, define variables like: count DB 5');
        const name = defineSymbol(m[1], 'label');
        ctx.labels.set(name, undefined);
        items.push({ kind: 'label', name, line: lineNo });
        text = m[2].trim();
      }
      if (!text) return;
      if ((m = /^(?:([A-Za-z_?@$][\w?@$]*)\s+)?(DB|DW)(?:\s+(.*))?$/i.exec(text))) {
        if (section !== 'data') {
          throw new AsmError('Data definitions (DB/DW) must be placed in the .DATA section', 'Put ".DATA" before your variables and ".CODE" before your instructions.');
        }
        const size = m[2].toUpperCase() === 'DB' ? 8 : 16;
        const name = m[1] ? defineSymbol(m[1], 'variable') : null;
        const bytes = parseDataValues(m[3] || '', size, ctx);
        if (name) ctx.variables.set(name, { name: m[1], offset: data.length, size, count: bytes.length / (size / 8), line: lineNo });
        data.push(...bytes);
        if (data.length > 0x10000) throw new AsmError('Data section is larger than one 64 KB segment');
        return;
      }
      m = /^([A-Za-z]+)(?:\s+(.*))?$/.exec(text);
      if (!m) throw new AsmError(`Cannot understand '${text}'`, 'Each line should be: [label:] INSTRUCTION operand1, operand2 ; comment');
      const written = m[1].toUpperCase();
      const mnemonic = canonicalMnemonic(written);
      if (section === 'data') throw new AsmError(`Instruction ${written} found in the .DATA section`, 'Instructions go after a ".CODE" line.');
      items.push({ kind: 'instr', line: lineNo, mnemonic, written, operandText: (m[2] || '').trim(), source: text });
    } catch (e) {
      report(lineNo, e);
    }
  });

  // ---- pass 2: operands and encoding
  for (const item of items) {
    if (item.kind !== 'instr') continue;
    try {
      const texts = item.operandText ? splitTopLevel(item.operandText) : [];
      if (BRANCHES.has(item.mnemonic)) {
        if (texts.length !== 1) throw new AsmError(`${item.written} expects one label as its target`, `Example: ${item.written} next`);
        const target = texts[0].replace(/^SHORT\s+/i, '').trim();
        if (!IDENT.test(target)) throw new AsmError(`${item.written} needs a label as its target (got '${target}')`, `Example: ${item.written} next`);
        if (!ctx.labels.has(target.toUpperCase())) {
          const known = [...ctx.labels.keys()];
          throw new AsmError(`Undefined label '${target}'`, known.length ? `Known labels: ${known.join(', ')}` : 'Define a label by writing "name:" at the start of a line.');
        }
        item.target = target.toUpperCase();
      } else {
        item.bytes = encode(item.mnemonic, texts.map((t) => parseOperand(t, ctx)));
      }
    } catch (e) {
      report(item.line, e);
      item.failed = true;
    }
  }

  // ---- layout: assign offsets; widen short JMPs that cannot reach until stable
  const sizeOf = (it) => {
    if (it.failed) return 0;
    if (it.bytes) return it.bytes.length;
    if (it.mnemonic === 'CALL') return 3;
    if (it.mnemonic === 'JMP') return it.near ? 3 : 2;
    return 2;
  };
  for (;;) {
    let offset = 0;
    for (const it of items) {
      if (it.kind === 'label') ctx.labels.set(it.name, offset);
      else {
        it.offset = offset;
        offset += sizeOf(it);
      }
    }
    let changed = false;
    for (const it of items) {
      if (it.kind === 'instr' && it.mnemonic === 'JMP' && !it.near && !it.failed) {
        const rel = ctx.labels.get(it.target) - (it.offset + 2);
        if (rel < -128 || rel > 127) {
          it.near = true;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // ---- resolve branches
  for (const it of items) {
    if (it.kind !== 'instr' || it.failed || it.bytes) continue;
    const target = ctx.labels.get(it.target);
    if (it.mnemonic === 'CALL' || (it.mnemonic === 'JMP' && it.near)) {
      const rel = (target - (it.offset + 3)) & 0xffff;
      it.bytes = [it.mnemonic === 'CALL' ? 0xe8 : 0xe9, rel & 0xff, rel >> 8];
      continue;
    }
    const rel = target - (it.offset + 2);
    if (rel < -128 || rel > 127) {
      report(it.line, new AsmError(
        `${it.written} target '${it.target}' is ${rel} bytes away, but it can only reach −128..+127 bytes`,
        `Invert the condition and use JMP, e.g. replace "JE far" with "JNE skip / JMP far / skip:".`,
      ));
      it.failed = true;
      continue;
    }
    const opcode = it.mnemonic === 'JMP' ? 0xeb : it.mnemonic === 'LOOP' ? 0xe2 : it.mnemonic === 'JCXZ' ? 0xe3 : JCC[it.mnemonic].opcode;
    it.bytes = [opcode, rel & 0xff];
  }

  // ---- collect output
  const code = [];
  const listing = [];
  for (const it of items) {
    if (it.kind !== 'instr' || it.failed) continue;
    listing.push({ line: it.line, offset: it.offset, bytes: it.bytes, source: it.source, mnemonic: it.mnemonic });
    code.push(...it.bytes);
  }
  if (code.length > 0xffff) report(null, new AsmError('Program is larger than one 64 KB code segment'));
  if (errors.length === 0 && listing.length === 0) {
    report(null, new AsmError('The program contains no instructions', 'Write at least one instruction, ending with HLT.'));
  }
  if (listing.length && !items.some((it) => it.kind === 'instr' && it.mnemonic === 'HLT')) {
    warnings.push({ line: null, message: 'The program has no HLT. Execution will stop with an error when IP runs past the last instruction.' });
  }

  errors.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  const labels = Object.fromEntries(ctx.labels);
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    code,
    data,
    listing,
    labels,
    labelsByOffset: Object.fromEntries(Object.entries(labels).map(([name, off]) => [off, name])),
    variables: Object.fromEntries(ctx.variables),
    constants: Object.fromEntries(ctx.constants),
    offsetToLine: Object.fromEntries(listing.map((l) => [l.offset, l.line])),
    source: String(source ?? ''),
  };
}
