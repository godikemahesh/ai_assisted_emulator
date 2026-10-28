// The supported instruction subset: documentation + opcode tables.
// This file is the single source of truth for "what does this emulator support".

/** Conditional jumps: opcode (70h–7Fh) and the flag condition they test. */
export const JCC = {
  JO: { opcode: 0x70, condition: 'OF = 1' },
  JNO: { opcode: 0x71, condition: 'OF = 0' },
  JB: { opcode: 0x72, condition: 'CF = 1' },
  JAE: { opcode: 0x73, condition: 'CF = 0' },
  JE: { opcode: 0x74, condition: 'ZF = 1' },
  JNE: { opcode: 0x75, condition: 'ZF = 0' },
  JBE: { opcode: 0x76, condition: 'CF = 1 or ZF = 1' },
  JA: { opcode: 0x77, condition: 'CF = 0 and ZF = 0' },
  JS: { opcode: 0x78, condition: 'SF = 1' },
  JNS: { opcode: 0x79, condition: 'SF = 0' },
  JP: { opcode: 0x7a, condition: 'PF = 1' },
  JNP: { opcode: 0x7b, condition: 'PF = 0' },
  JL: { opcode: 0x7c, condition: 'SF ≠ OF' },
  JGE: { opcode: 0x7d, condition: 'SF = OF' },
  JLE: { opcode: 0x7e, condition: 'ZF = 1 or SF ≠ OF' },
  JG: { opcode: 0x7f, condition: 'ZF = 0 and SF = OF' },
};

/** Alternative spellings accepted by the assembler, mapped to the canonical name. */
export const ALIASES = {
  JZ: 'JE', JNZ: 'JNE', JC: 'JB', JNAE: 'JB', JNC: 'JAE', JNB: 'JAE', JNA: 'JBE', JNBE: 'JA',
  JPE: 'JP', JPO: 'JNP', JNGE: 'JL', JNL: 'JGE', JNG: 'JLE', JNLE: 'JG', SAL: 'SHL',
};

export const JCC_BY_OPCODE = Object.fromEntries(Object.entries(JCC).map(([name, j]) => [j.opcode, name]));

/** ALU group: ModR/M /digit and opcode base (base + 0..5 are the six standard forms). */
export const ALU_OPS = ['ADD', 'OR', 'ADC', 'SBB', 'AND', 'SUB', 'XOR', 'CMP'];

const jccDocs = Object.fromEntries(Object.entries(JCC).map(([name, j]) => [name, {
  category: 'Control transfer',
  syntax: [`${name} label`],
  summary: `Jumps to the label if ${j.condition}; otherwise continues with the next instruction.`,
  flags: 'Reads flags only; changes none.',
  example: `CMP AX, BX\n${name} target`,
  notes: 'Short jump: the target must be within −128..+127 bytes of the next instruction (an 8086 limitation).',
}]));

export const INSTRUCTION_DOCS = {
  MOV: {
    category: 'Data transfer',
    syntax: ['MOV reg, reg', 'MOV reg, imm', 'MOV reg, mem', 'MOV mem, reg', 'MOV mem, imm', 'MOV sreg, reg16/mem16', 'MOV reg16/mem16, sreg'],
    summary: 'Copies the source operand into the destination. The source is unchanged.',
    flags: 'None.',
    example: 'MOV AX, 1234h\nMOV [num], AX',
    notes: 'Memory-to-memory moves, loading a segment register with an immediate, and MOV CS, ... are not allowed on the 8086.',
  },
  XCHG: {
    category: 'Data transfer',
    syntax: ['XCHG reg, reg', 'XCHG reg, mem', 'XCHG mem, reg'],
    summary: 'Swaps the contents of the two operands.',
    flags: 'None.',
    example: 'XCHG AH, AL',
  },
  LEA: {
    category: 'Data transfer',
    syntax: ['LEA reg16, mem'],
    summary: 'Loads the effective address (offset) of a memory operand into a 16-bit register. No memory is read.',
    flags: 'None.',
    example: 'LEA SI, [BX+4]',
  },
  PUSH: {
    category: 'Stack',
    syntax: ['PUSH reg16', 'PUSH sreg', 'PUSH mem16'],
    summary: 'SP = SP − 2, then stores the 16-bit operand at SS:SP.',
    flags: 'None.',
    example: 'PUSH AX',
    notes: 'PUSH imm is an 80186+ instruction and is not available on the 8086. PUSH SP pushes the already-decremented SP (8086 behaviour).',
  },
  POP: {
    category: 'Stack',
    syntax: ['POP reg16', 'POP sreg (not CS)', 'POP mem16'],
    summary: 'Loads the word at SS:SP into the operand, then SP = SP + 2.',
    flags: 'None.',
    example: 'POP BX',
  },
  ADD: {
    category: 'Arithmetic',
    syntax: ['ADD dst, src'],
    summary: 'dst = dst + src.',
    flags: 'CF, PF, AF, ZF, SF, OF.',
    example: 'ADD AX, BX',
  },
  ADC: {
    category: 'Arithmetic',
    syntax: ['ADC dst, src'],
    summary: 'dst = dst + src + CF (add with carry, used for multi-word addition).',
    flags: 'CF, PF, AF, ZF, SF, OF.',
    example: 'ADC DX, 0',
  },
  SUB: {
    category: 'Arithmetic',
    syntax: ['SUB dst, src'],
    summary: 'dst = dst − src. CF = 1 means an unsigned borrow occurred.',
    flags: 'CF, PF, AF, ZF, SF, OF.',
    example: 'SUB AX, 10',
  },
  SBB: {
    category: 'Arithmetic',
    syntax: ['SBB dst, src'],
    summary: 'dst = dst − src − CF (subtract with borrow).',
    flags: 'CF, PF, AF, ZF, SF, OF.',
    example: 'SBB DX, 0',
  },
  CMP: {
    category: 'Arithmetic',
    syntax: ['CMP a, b'],
    summary: 'Computes a − b only to set the flags; the result is discarded. Usually followed by a conditional jump.',
    flags: 'CF, PF, AF, ZF, SF, OF.',
    example: 'CMP AX, BX\nJE same',
  },
  INC: {
    category: 'Arithmetic',
    syntax: ['INC reg', 'INC BYTE/WORD PTR mem'],
    summary: 'Adds 1 to the operand.',
    flags: 'PF, AF, ZF, SF, OF. CF is NOT changed.',
    example: 'INC CX',
  },
  DEC: {
    category: 'Arithmetic',
    syntax: ['DEC reg', 'DEC BYTE/WORD PTR mem'],
    summary: 'Subtracts 1 from the operand.',
    flags: 'PF, AF, ZF, SF, OF. CF is NOT changed.',
    example: 'DEC CX\nJNZ again',
  },
  NEG: {
    category: 'Arithmetic',
    syntax: ['NEG reg', 'NEG BYTE/WORD PTR mem'],
    summary: "Two's-complement negation: operand = 0 − operand.",
    flags: 'CF (1 unless the operand was 0), PF, AF, ZF, SF, OF.',
    example: 'NEG AX',
  },
  MUL: {
    category: 'Arithmetic',
    syntax: ['MUL reg8/mem8', 'MUL reg16/mem16'],
    summary: 'Unsigned multiply. 8-bit: AX = AL × src. 16-bit: DX:AX = AX × src.',
    flags: 'CF = OF = 1 if the upper half (AH or DX) is non-zero. SF, ZF, AF, PF are undefined and left unchanged here.',
    example: 'MOV AL, 12\nMOV BL, 10\nMUL BL',
  },
  DIV: {
    category: 'Arithmetic',
    syntax: ['DIV reg8/mem8', 'DIV reg16/mem16'],
    summary: 'Unsigned divide. 8-bit: AL = AX ÷ src, AH = remainder. 16-bit: AX = DX:AX ÷ src, DX = remainder.',
    flags: 'All undefined; left unchanged here.',
    example: 'MOV DX, 0\nMOV AX, 1000\nMOV CX, 7\nDIV CX',
    notes: 'Division by zero or a quotient that does not fit is a "divide error". A real 8086 raises interrupt 0; this emulator stops with an error.',
  },
  AND: {
    category: 'Logic',
    syntax: ['AND dst, src'],
    summary: 'Bitwise AND. Often used to clear (mask) bits.',
    flags: 'CF = 0, OF = 0, PF, ZF, SF set from result. AF undefined (cleared here).',
    example: 'AND AL, 0Fh',
  },
  OR: {
    category: 'Logic',
    syntax: ['OR dst, src'],
    summary: 'Bitwise OR. Often used to set bits.',
    flags: 'CF = 0, OF = 0, PF, ZF, SF set from result. AF undefined (cleared here).',
    example: 'OR AL, 80h',
  },
  XOR: {
    category: 'Logic',
    syntax: ['XOR dst, src'],
    summary: 'Bitwise exclusive OR. XOR AX, AX is a common way to set AX to 0.',
    flags: 'CF = 0, OF = 0, PF, ZF, SF set from result. AF undefined (cleared here).',
    example: 'XOR AX, AX',
  },
  NOT: {
    category: 'Logic',
    syntax: ['NOT reg', 'NOT BYTE/WORD PTR mem'],
    summary: "One's complement: inverts every bit.",
    flags: 'None.',
    example: 'NOT AL',
  },
  TEST: {
    category: 'Logic',
    syntax: ['TEST a, b'],
    summary: 'Computes a AND b only to set the flags; the result is discarded.',
    flags: 'CF = 0, OF = 0, PF, ZF, SF set from result. AF undefined (cleared here).',
    example: 'TEST AL, 1\nJNZ odd',
  },
  SHL: {
    category: 'Shift',
    syntax: ['SHL dst, 1', 'SHL dst, CL'],
    summary: 'Shift left; zeros enter from the right. Each shift multiplies an unsigned value by 2. SAL is the same instruction.',
    flags: 'CF = last bit shifted out; ZF, SF, PF from result; OF only defined for a count of 1. AF undefined (unchanged).',
    example: 'SHL AX, 1',
    notes: 'On the 8086 the count must be 1 or CL. "SHL AX, 3" is an 80186+ form.',
  },
  SHR: {
    category: 'Shift',
    syntax: ['SHR dst, 1', 'SHR dst, CL'],
    summary: 'Logical shift right; zeros enter from the left. Unsigned divide by 2.',
    flags: 'CF = last bit shifted out; ZF, SF, PF from result; OF only defined for a count of 1. AF undefined (unchanged).',
    example: 'MOV CL, 4\nSHR AX, CL',
  },
  SAR: {
    category: 'Shift',
    syntax: ['SAR dst, 1', 'SAR dst, CL'],
    summary: 'Arithmetic shift right; the sign bit is copied in. Signed divide by 2 (rounding toward −∞).',
    flags: 'CF = last bit shifted out; ZF, SF, PF from result; OF = 0 for a count of 1. AF undefined (unchanged).',
    example: 'SAR AX, 1',
  },
  JMP: {
    category: 'Control transfer',
    syntax: ['JMP label'],
    summary: 'Unconditional jump: IP = address of label.',
    flags: 'None.',
    example: 'JMP done',
    notes: 'The assembler picks a 2-byte short jump when the target is close, otherwise a 3-byte near jump.',
  },
  ...jccDocs,
  JCXZ: {
    category: 'Control transfer',
    syntax: ['JCXZ label'],
    summary: 'Jumps if CX = 0.',
    flags: 'None.',
    example: 'JCXZ skip',
  },
  LOOP: {
    category: 'Control transfer',
    syntax: ['LOOP label'],
    summary: 'CX = CX − 1; jumps to label if CX ≠ 0.',
    flags: 'None (unlike DEC, LOOP does not touch ZF).',
    example: 'MOV CX, 5\nagain:\n  ...\nLOOP again',
  },
  CALL: {
    category: 'Control transfer',
    syntax: ['CALL label'],
    summary: 'Pushes the return address (IP of the next instruction) and jumps to the procedure.',
    flags: 'None.',
    example: 'CALL print_sum',
  },
  RET: {
    category: 'Control transfer',
    syntax: ['RET'],
    summary: 'Pops the return address into IP.',
    flags: 'None.',
    example: 'RET',
  },
  CLC: { category: 'Flag control', syntax: ['CLC'], summary: 'Clears the carry flag (CF = 0).', flags: 'CF.', example: 'CLC' },
  STC: { category: 'Flag control', syntax: ['STC'], summary: 'Sets the carry flag (CF = 1).', flags: 'CF.', example: 'STC' },
  CMC: { category: 'Flag control', syntax: ['CMC'], summary: 'Complements (toggles) the carry flag.', flags: 'CF.', example: 'CMC' },
  CLD: { category: 'Flag control', syntax: ['CLD'], summary: 'Clears the direction flag (DF = 0).', flags: 'DF.', example: 'CLD' },
  STD: { category: 'Flag control', syntax: ['STD'], summary: 'Sets the direction flag (DF = 1).', flags: 'DF.', example: 'STD' },
  CLI: { category: 'Flag control', syntax: ['CLI'], summary: 'Clears the interrupt-enable flag (IF = 0).', flags: 'IF.', example: 'CLI' },
  STI: { category: 'Flag control', syntax: ['STI'], summary: 'Sets the interrupt-enable flag (IF = 1).', flags: 'IF.', example: 'STI' },
  NOP: { category: 'Miscellaneous', syntax: ['NOP'], summary: 'Does nothing (opcode 90h).', flags: 'None.', example: 'NOP' },
  HLT: {
    category: 'Miscellaneous',
    syntax: ['HLT'],
    summary: 'Halts the processor. Every program should end with HLT.',
    flags: 'None.',
    example: 'HLT',
  },
};

export const SUPPORTED_MNEMONICS = Object.keys(INSTRUCTION_DOCS);

/** Real 8086/8088 instructions that are recognised but deliberately not implemented. */
export const KNOWN_UNSUPPORTED = [
  'AAA', 'AAD', 'AAM', 'AAS', 'CBW', 'CWD', 'DAA', 'DAS', 'IDIV', 'IMUL', 'IN', 'OUT', 'INT', 'INTO',
  'IRET', 'LAHF', 'SAHF', 'LDS', 'LES', 'LOCK', 'LODSB', 'LODSW', 'MOVSB', 'MOVSW', 'CMPSB', 'CMPSW',
  'SCASB', 'SCASW', 'STOSB', 'STOSW', 'REP', 'REPE', 'REPZ', 'REPNE', 'REPNZ', 'LOOPE', 'LOOPZ',
  'LOOPNE', 'LOOPNZ', 'PUSHF', 'POPF', 'RCL', 'RCR', 'ROL', 'ROR', 'XLAT', 'XLATB', 'WAIT', 'ESC', 'RETF',
  'LODS', 'MOVS', 'CMPS', 'SCAS', 'STOS',
];

/** Instructions that only exist on later processors (80186 and newer). */
export const LATER_CPU = ['PUSHA', 'POPA', 'ENTER', 'LEAVE', 'BOUND', 'INSB', 'OUTSB', 'MOVZX', 'MOVSX', 'BSWAP', 'CPUID'];

/** Look up docs for a mnemonic or one of its aliases. */
export function getInstructionDoc(mnemonic) {
  if (!mnemonic) return null;
  const upper = mnemonic.toUpperCase();
  const canonical = ALIASES[upper] || upper;
  const doc = INSTRUCTION_DOCS[canonical];
  if (!doc) return null;
  const aliases = Object.entries(ALIASES).filter(([, c]) => c === canonical).map(([a]) => a);
  return { name: canonical, aliases, ...doc };
}
