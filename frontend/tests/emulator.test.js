// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Emulator } from '../src/emulator/index.js';

const SRC = 'MOV AX, 5\nADD AX, 3\nMOV [0010h], AX\nHLT';

describe('step, run and reset', () => {
  it('starts empty and refuses to step without a program', () => {
    const emu = new Emulator();
    expect(emu.status).toBe('empty');
    const r = emu.step();
    expect(r.ok).toBe(false);
    expect(r.error.message).toMatch(/No program/);
  });

  it('a failed assembly does not load anything', () => {
    const emu = new Emulator();
    const program = emu.assemble('BAD INSTRUCTION');
    expect(program.ok).toBe(false);
    expect(emu.status).toBe('empty');
  });

  it('step executes exactly one instruction and records a 5-stage trace entry', () => {
    const emu = new Emulator();
    emu.assemble(SRC);
    const r = emu.step();
    expect(r.ok).toBe(true);
    expect(emu.stepCount).toBe(1);
    expect(emu.cpu.get('AX')).toBe(5);
    const e = r.entry;
    expect(e.asm).toBe('MOV AX, 0005h');
    expect(e.bytes).toBe('B8 05 00');
    expect(e.address).toBe('1000:0000');
    expect(e.physical).toBe('10000');
    expect(e.line).toBe(1);
    expect(Object.keys(e.stages)).toEqual(['fetch', 'decode', 'execute', 'update', 'record']);
    expect(e.changes.registers).toEqual([
      { name: 'AX', before: 0, after: 5 },
      { name: 'IP', before: 0, after: 3 },
    ]);
  });

  it('the trace records flag and memory changes', () => {
    const emu = new Emulator();
    emu.assemble(SRC);
    emu.run();
    const [, add, store] = emu.trace;
    expect(add.description).toMatch(/0005h \+ 0003h = 0008h/);
    expect(store.changes.memory).toEqual([
      { address: 0x20010, before: 0, after: 8 },
      { address: 0x20011, before: 0, after: 0 },
    ]);
    expect(emu.trace).toHaveLength(4);
  });

  it('run stops at HLT; further steps are refused', () => {
    const emu = new Emulator();
    emu.assemble(SRC);
    const n = emu.run();
    expect(n).toBe(4);
    expect(emu.status).toBe('halted');
    const r = emu.step();
    expect(r.ok).toBe(false);
    expect(r.error.message).toMatch(/halted/);
  });

  it('run(limit) executes at most `limit` instructions (used for paused/speed-controlled runs)', () => {
    const emu = new Emulator();
    emu.assemble(SRC);
    expect(emu.run(2)).toBe(2);
    expect(emu.status).toBe('ready');
    expect(emu.cpu.ip).toBe(6);
  });

  it('reset restores registers, memory, trace and status', () => {
    const emu = new Emulator();
    emu.assemble(SRC);
    emu.run();
    emu.reset();
    expect(emu.status).toBe('ready');
    expect(emu.cpu.get('AX')).toBe(0);
    expect(emu.cpu.ip).toBe(0);
    expect(emu.memory.readByte(0x20010)).toBe(0);
    expect(emu.trace).toHaveLength(0);
    expect(emu.stepCount).toBe(0);
    emu.run();
    expect(emu.cpu.get('AX')).toBe(8); // same result the second time
  });

  it('reset also clears an error state', () => {
    const emu = new Emulator();
    emu.assemble('POP AX\nHLT');
    emu.run();
    expect(emu.status).toBe('error');
    emu.reset();
    expect(emu.status).toBe('ready');
    expect(emu.lastError).toBeNull();
  });

  it('stops with an error when IP runs past the program (missing HLT)', () => {
    const emu = new Emulator();
    emu.assemble('MOV AX, 1');
    emu.run();
    expect(emu.status).toBe('error');
    expect(emu.lastError.message).toMatch(/outside the program/);
    expect(emu.lastError.hint).toMatch(/HLT/);
  });

  it('stops infinite loops at the step limit', () => {
    const emu = new Emulator({ maxSteps: 50 });
    emu.assemble('again: JMP again');
    emu.run();
    expect(emu.status).toBe('error');
    expect(emu.stepCount).toBe(50);
    expect(emu.lastError.message).toMatch(/infinite loop/);
  });

  it('highlights the next instruction line via the snapshot', () => {
    const emu = new Emulator();
    emu.assemble('; comment\nMOV AX, 1\n\nMOV BX, 2\nHLT');
    expect(emu.getSnapshot().currentLine).toBe(2);
    emu.step();
    expect(emu.getSnapshot().currentLine).toBe(4);
    expect(emu.getSnapshot().nextInstruction.asm).toBe('MOV BX, 0002h');
  });
});

describe('snapshots are read-only copies', () => {
  it('snapshot is deeply frozen and mutating it cannot change the CPU', () => {
    const emu = new Emulator();
    emu.assemble(SRC);
    emu.step();
    const snap = emu.getSnapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.registers)).toBe(true);
    expect(() => {
      'use strict';
      snap.registers.AX = 999;
    }).toThrow(TypeError);
    expect(emu.cpu.get('AX')).toBe(5);
  });

  it('trace entries are frozen', () => {
    const emu = new Emulator();
    emu.assemble(SRC);
    emu.step();
    expect(Object.isFrozen(emu.trace[0])).toBe(true);
    expect(Object.isFrozen(emu.trace[0].changes.registers)).toBe(true);
  });

  it('snapshot is JSON-serialisable (it is what the AI tutor receives)', () => {
    const emu = new Emulator();
    emu.assemble('.DATA\nv DW 7\n.CODE\nPUSH AX\nHLT');
    emu.run();
    const json = JSON.parse(JSON.stringify(emu.getSnapshot()));
    expect(json.registersHex.SP).toBe('FFFC');
    expect(json.flags).toHaveProperty('ZF');
    expect(json.variables[0]).toMatchObject({ name: 'v', value: '0007', size: 'WORD' });
    expect(json.stack[0].value).toBe('0000');
  });
});
