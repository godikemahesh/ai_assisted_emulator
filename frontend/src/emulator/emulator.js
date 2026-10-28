// Emulator: owns the CPU and memory and runs the instruction pipeline
//   1. Fetch   – read instruction bytes at CS:IP
//   2. Decode  – turn bytes into an instruction
//   3. Execute – perform the operation
//   4. Update  – compute what changed (registers, flags, memory, IP)
//   5. Record  – append an entry to the execution trace
//
// Only this class can change emulator state. Everything handed out
// (snapshots, traces) is a frozen copy.

import {
  DEFAULT_SEGMENTS, DEFAULT_SP, DEFAULT_MAX_STEPS, MAX_TRACE, FLAG_BITS, FLAG_ORDER, SREG, SEG,
} from './constants.js';
import { hex16, hex20, asmHex, bytesToHex, physicalAddress } from './format.js';
import { CPU } from './cpu.js';
import { Memory, MemoryError } from './memory.js';
import { assemble } from './assembler.js';
import { decode, disassemble, DecodeError } from './decoder.js';
import { execute, ExecutionError } from './executor.js';

const REGISTER_NAMES = ['AX', 'BX', 'CX', 'DX', 'SI', 'DI', 'BP', 'SP', 'IP', 'CS', 'DS', 'SS', 'ES', 'FLAGS'];

export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

const flagsOf = (flagsValue) => Object.fromEntries(FLAG_ORDER.map((f) => [f, (flagsValue >> FLAG_BITS[f]) & 1]));

export class Emulator {
  constructor({ maxSteps = DEFAULT_MAX_STEPS, segments = DEFAULT_SEGMENTS, stackPointer = DEFAULT_SP } = {}) {
    this.cpu = new CPU();
    this.memory = new Memory();
    this.maxSteps = maxSteps;
    this.segments = { ...segments };
    this.initialSP = stackPointer;
    this.program = null;
    this.status = 'empty'; // empty | ready | halted | error
    this.trace = [];
    this.traceDropped = 0;
    this.stepCount = 0;
    this.lastError = null;
    this.lastChanges = null;

    const emulator = this;
    this.machine = {
      cpu: this.cpu,
      readMem: (seg, offset, size) => emulator.readMem(seg, offset, size),
      writeMem: (seg, offset, size, value) => emulator.writeMem(seg, offset, size, value),
      push: (value) => emulator.push(value),
      pop: () => emulator.pop(),
    };
    this.cpu.reset(this.segments, this.initialSP);
  }

  // ------------------------------------------------------------ program loading

  /** Assemble source; on success the program is loaded and the CPU reset, on failure nothing is loaded. */
  assemble(source) {
    const program = assemble(source);
    if (program.ok) this.load(program);
    else this.unload();
    return program;
  }

  unload() {
    this.program = null;
    this.reset();
  }

  load(program) {
    if (!program || !program.ok) throw new Error('Cannot load a program that failed to assemble');
    this.program = program;
    this.reset();
  }

  /** Restore the freshly-loaded state: registers, memory, trace. */
  reset() {
    this.cpu.reset(this.segments, this.initialSP);
    this.memory.clear();
    this.trace = [];
    this.traceDropped = 0;
    this.stepCount = 0;
    this.lastError = null;
    this.lastChanges = null;
    if (!this.program) {
      this.status = 'empty';
      return;
    }
    const codeBase = physicalAddress(this.segments.CS, 0);
    const dataBase = physicalAddress(this.segments.DS, 0);
    this.memory.load(codeBase, this.program.code);
    this.memory.load(dataBase, this.program.data);
    this.memory.protect(codeBase, this.program.code.length, 'machine code');
    this.status = 'ready';
  }

  // ------------------------------------------------------------ memory access (used by the executor)

  readMem(segIndex, offset, size) {
    const address = this.addressOf(segIndex, offset, size);
    return size === 8 ? this.memory.readByte(address) : this.memory.readWord(address);
  }

  writeMem(segIndex, offset, size, value) {
    const address = this.addressOf(segIndex, offset, size);
    if (size === 8) this.memory.writeByte(address, value);
    else this.memory.writeWord(address, value);
  }

  addressOf(segIndex, offset, size) {
    if (size === 16 && offset === 0xffff) {
      throw new MemoryError(
        `Word access at ${SREG[segIndex]}:FFFFh would cross the end of the 64 KB segment`,
        'Use an even offset below FFFFh for word values.',
      );
    }
    return physicalAddress(this.cpu.sregs[segIndex], offset);
  }

  push(value) {
    const sp = this.cpu.getReg16(4);
    if (sp < 2) {
      throw new ExecutionError('Stack overflow: SP reached the bottom of the stack segment', 'Too many PUSH/CALL without POP/RET, or SP was set too low.');
    }
    this.writeMem(SEG.SS, sp - 2, 16, value);
    this.cpu.setReg16(4, sp - 2);
  }

  pop() {
    const sp = this.cpu.getReg16(4);
    if (sp >= this.initialSP) {
      throw new ExecutionError(
        'Stack underflow: POP/RET with nothing on the stack',
        'Every POP needs an earlier PUSH, and every RET needs a CALL.',
      );
    }
    const value = this.readMem(SEG.SS, sp, 16);
    this.cpu.setReg16(4, sp + 2);
    return value;
  }

  // ------------------------------------------------------------ pipeline

  get codeSize() {
    return this.program ? this.program.code.length : 0;
  }

  canStep() {
    return this.status === 'ready' && this.program !== null;
  }

  /** Execute exactly one instruction. Returns { ok, entry } or { ok: false, error }. */
  step() {
    if (!this.program) return { ok: false, error: { message: 'No program loaded. Write a program and click Assemble.' } };
    if (this.status === 'halted') return { ok: false, error: { message: 'The CPU is halted (HLT). Press Reset to run the program again.' } };
    if (this.status === 'error') return { ok: false, error: this.lastError };
    if (this.stepCount >= this.maxSteps) {
      return this.fail(new ExecutionError(
        `Step limit reached (${this.maxSteps} instructions). The program may be in an infinite loop.`,
        'Check that your loop counter changes and that the loop condition eventually becomes false.',
      ), null);
    }

    const before = this.cpu.save();
    const ip = this.cpu.ip;
    const cs = this.cpu.sregs[SEG.CS];
    this.memory.startLog();
    let instr = null;
    try {
      // 1. FETCH
      if (ip >= this.codeSize) {
        throw new ExecutionError(
          `IP = ${asmHex(ip)} is outside the program (the code occupies 0000h–${asmHex(Math.max(0, this.codeSize - 1))})`,
          'The CPU ran past the last instruction. Did you forget HLT at the end?',
        );
      }
      // 2. DECODE
      instr = decode((offset) => {
        if (offset >= this.codeSize) {
          throw new DecodeError(`Instruction at ${asmHex(ip)} is cut off at the end of the program`);
        }
        return this.memory.readByte(physicalAddress(cs, offset));
      }, ip);
      // 3. EXECUTE (IP already points at the next instruction, as on a real 8086)
      this.cpu.ip = (ip + instr.length) & 0xffff;
      const result = execute(instr, this.machine);
      const memLog = this.memory.stopLog();
      // 4. UPDATE
      const after = this.cpu.save();
      const changes = this.diff(before, after, memLog);
      this.stepCount++;
      if (this.cpu.halted) this.status = 'halted';
      // 5. RECORD
      const entry = this.record({
        step: this.stepCount, cs, ip, instr, result, changes, before, after,
      });
      this.lastChanges = changes;
      return { ok: true, entry };
    } catch (e) {
      const log = this.memory.stopLog();
      this.memory.rollback(log);
      this.cpu.restore(before);
      return this.fail(e, instr, ip, cs);
    }
  }

  fail(e, instr, ip = this.cpu.ip, cs = this.cpu.sregs[SEG.CS]) {
    if (!(e instanceof ExecutionError || e instanceof MemoryError || e instanceof DecodeError)) throw e;
    const error = {
      type: e.name,
      message: e.message,
      hint: e.hint || null,
      ip,
      line: this.program?.offsetToLine[ip] ?? null,
      instruction: instr ? disassemble(instr, this.program?.labelsByOffset) : null,
    };
    this.status = 'error';
    this.lastError = error;
    this.pushTrace(deepFreeze({
      step: this.stepCount + 1,
      address: `${hex16(cs)}:${hex16(ip)}`,
      line: error.line,
      asm: error.instruction || '(not decoded)',
      error: error.message,
    }));
    return { ok: false, error };
  }

  diff(before, after, memLog) {
    const registers = REGISTER_NAMES.filter((r) => r !== 'FLAGS' && before[r] !== after[r])
      .map((r) => ({ name: r, before: before[r], after: after[r] }));
    const fb = flagsOf(before.FLAGS);
    const fa = flagsOf(after.FLAGS);
    const flags = FLAG_ORDER.filter((f) => fb[f] !== fa[f]).map((f) => ({ name: f, before: fb[f], after: fa[f] }));
    // Collapse multiple writes to the same byte into one change (first "before", last "after").
    const bytes = new Map();
    for (const w of memLog) {
      if (bytes.has(w.address)) bytes.get(w.address).after = w.after;
      else bytes.set(w.address, { address: w.address, before: w.before, after: w.after });
    }
    return { registers, flags, memory: [...bytes.values()] };
  }

  record({ step, cs, ip, instr, result, changes, before }) {
    const line = this.program.offsetToLine[ip] ?? null;
    const asm = disassemble(instr, this.program.labelsByOffset);
    const physical = physicalAddress(cs, ip);
    const entry = deepFreeze({
      step,
      address: `${hex16(cs)}:${hex16(ip)}`,
      physical: hex20(physical),
      bytes: bytesToHex(instr.bytes),
      asm,
      line,
      source: line ? this.program.listing.find((l) => l.offset === ip)?.source ?? null : null,
      description: result.description,
      stages: {
        fetch: `Read ${instr.length} byte${instr.length > 1 ? 's' : ''} [${bytesToHex(instr.bytes)}] at CS:IP = ${hex16(cs)}:${hex16(ip)} (physical ${hex20(physical)}h = ${hex16(cs)}h × 16 + ${hex16(ip)}h)`,
        decode: `Opcode ${bytesToHex(instr.bytes.slice(0, 1))}h → ${asm}`,
        execute: result.description,
        update: describeChanges(changes, before),
        record: `Trace entry #${step}`,
      },
      changes,
    });
    this.pushTrace(entry);
    return entry;
  }

  pushTrace(entry) {
    this.trace.push(entry);
    if (this.trace.length > MAX_TRACE) {
      this.trace.shift();
      this.traceDropped++;
    }
  }

  /**
   * Run until HLT, an error, or `limit` more instructions. Returns the number of steps executed.
   * Without a limit, the emulator's maxSteps safety limit ends infinite loops with an error.
   */
  run(limit = Infinity) {
    let executed = 0;
    while (this.canStep() && executed < limit) {
      const r = this.step();
      if (r.ok) executed++;
      else break;
    }
    return executed;
  }

  // ------------------------------------------------------------ read-only views

  /** The instruction at CS:IP, decoded without executing it (or null). */
  peekNext() {
    if (!this.program || this.status !== 'ready' || this.cpu.ip >= this.codeSize) return null;
    try {
      const cs = this.cpu.sregs[SEG.CS];
      const instr = decode((offset) => {
        if (offset >= this.codeSize) throw new DecodeError('cut off');
        return this.memory.readByte(physicalAddress(cs, offset));
      }, this.cpu.ip);
      return { asm: disassemble(instr, this.program.labelsByOffset), bytes: bytesToHex(instr.bytes), line: this.program.offsetToLine[this.cpu.ip] ?? null };
    } catch {
      return null;
    }
  }

  readBytes(physical, length) {
    return this.memory.slice(physical, length);
  }

  /** Words currently on the stack, from SS:SP upward (top of stack first). */
  stackWords(max = 8) {
    const words = [];
    const ss = this.cpu.sregs[SEG.SS];
    for (let sp = this.cpu.getReg16(4); sp < this.initialSP && words.length < max; sp += 2) {
      const addr = physicalAddress(ss, sp);
      words.push({ offset: hex16(sp), physical: hex20(addr), value: hex16(this.memory.readWord(addr)) });
    }
    return words;
  }

  /** A complete, frozen, JSON-safe copy of the visible state. Mutating it cannot affect the emulator. */
  getSnapshot() {
    const regs = this.cpu.save();
    const registers = Object.fromEntries(REGISTER_NAMES.map((r) => [r, regs[r]]));
    const ds = physicalAddress(this.cpu.sregs[SEG.DS], 0);
    return deepFreeze({
      status: this.status,
      stepCount: this.stepCount,
      registers,
      registersHex: Object.fromEntries(REGISTER_NAMES.map((r) => [r, hex16(regs[r])])),
      flags: flagsOf(regs.FLAGS),
      currentLine: this.program ? this.program.offsetToLine[this.cpu.ip] ?? null : null,
      nextInstruction: this.peekNext(),
      lastError: this.lastError ? { ...this.lastError } : null,
      stack: this.stackWords(),
      dataSegment: {
        physicalStart: hex20(ds),
        bytes: this.memory.slice(ds, Math.min(64, Math.max(16, this.program ? this.program.data.length : 16))),
      },
      variables: this.program ? Object.values(this.program.variables).map((v) => ({
        name: v.name, offset: hex16(v.offset), size: v.size === 8 ? 'BYTE' : 'WORD', count: v.count,
        value: hex16(v.size === 8 ? this.memory.readByte(ds + v.offset) : this.memory.readWord(ds + v.offset)),
      })) : [],
      memoryLayout: {
        CS: hex16(this.segments.CS), DS: hex16(this.segments.DS), SS: hex16(this.segments.SS), ES: hex16(this.segments.ES),
        codeBytes: this.codeSize, dataBytes: this.program ? this.program.data.length : 0,
      },
    });
  }

  getTrace() {
    return this.trace;
  }
}

function describeChanges(changes, before) {
  const parts = [];
  for (const r of changes.registers) parts.push(`${r.name}: ${hex16(r.before)}→${hex16(r.after)}`);
  for (const f of changes.flags) parts.push(`${f.name}: ${f.before}→${f.after}`);
  for (const m of changes.memory) parts.push(`[${hex20(m.address)}]: ${hex16(m.before).slice(2)}→${hex16(m.after).slice(2)}`);
  if (!changes.registers.some((r) => r.name === 'IP')) parts.push(`IP: ${hex16(before.IP)} (unchanged)`);
  return parts.length ? parts.join(', ') : 'No changes';
}
