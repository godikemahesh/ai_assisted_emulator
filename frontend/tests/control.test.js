// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Emulator } from '../src/emulator/index.js';
import { runProgram, reg, asmError, bytesOf } from './helpers.js';

/** Runs CMP a, b then a jump; returns 1 if the jump was taken. */
function taken(jcc, a, b, size = 16) {
  const r = size === 16 ? 'AX' : 'AL';
  const emu = runProgram(`
      MOV ${r}, ${a}
      CMP ${r}, ${b}
      MOV DX, 0
      ${jcc} yes
      HLT
    yes:
      MOV DX, 1
      HLT`);
  return reg(emu, 'DX');
}

describe('comparisons and conditional jumps', () => {
  it('JE/JZ and JNE/JNZ', () => {
    expect(taken('JE', 5, 5)).toBe(1);
    expect(taken('JZ', 5, 6)).toBe(0);
    expect(taken('JNE', 5, 6)).toBe(1);
    expect(taken('JNZ', 5, 5)).toBe(0);
  });

  it('unsigned comparisons JA, JAE, JB, JBE (and aliases)', () => {
    expect(taken('JA', '0FFFFh', 1)).toBe(1); // 65535 > 1 unsigned
    expect(taken('JB', 1, '0FFFFh')).toBe(1);
    expect(taken('JAE', 3, 3)).toBe(1);
    expect(taken('JBE', 3, 3)).toBe(1);
    expect(taken('JNC', 4, 3)).toBe(1);
    expect(taken('JC', 4, 3)).toBe(0);
    expect(taken('JNBE', 3, 3)).toBe(0);
  });

  it('signed comparisons JG, JGE, JL, JLE treat 0FFFFh as -1', () => {
    expect(taken('JG', '0FFFFh', 1)).toBe(0); // -1 > 1 is false
    expect(taken('JL', '0FFFFh', 1)).toBe(1);
    expect(taken('JGE', -5, -5)).toBe(1);
    expect(taken('JLE', -6, -5)).toBe(1);
    expect(taken('JNL', 2, 1)).toBe(1);
    expect(taken('JNG', 2, 1)).toBe(0);
  });

  it('sign, overflow and parity jumps', () => {
    expect(taken('JS', 1, 2)).toBe(1);
    expect(taken('JNS', 2, 1)).toBe(1);
    expect(taken('JO', '80h', 1, 8)).toBe(1); // -128 - 1 overflows
    expect(taken('JNO', 5, 1)).toBe(1);
    expect(taken('JP', 3, 0)).toBe(1); // 03h has two 1-bits -> even parity
    expect(taken('JNP', 1, 0)).toBe(1);
    expect(taken('JPE', 3, 0)).toBe(1);
    expect(taken('JPO', 3, 0)).toBe(0);
  });

  it('JCXZ jumps only when CX = 0', () => {
    let emu = runProgram('MOV CX, 0\nMOV DX, 0\nJCXZ z\nHLT\nz: MOV DX, 1\nHLT');
    expect(reg(emu, 'DX')).toBe(1);
    emu = runProgram('MOV CX, 2\nMOV DX, 0\nJCXZ z\nHLT\nz: MOV DX, 1\nHLT');
    expect(reg(emu, 'DX')).toBe(0);
  });
});

describe('loops, calls and IP updates', () => {
  it('LOOP decrements CX and repeats', () => {
    const emu = runProgram('MOV CX, 5\nMOV AX, 0\nnext: ADD AX, CX\nLOOP next\nHLT');
    expect(reg(emu, 'AX')).toBe(15);
    expect(reg(emu, 'CX')).toBe(0);
    expect(emu.stepCount).toBe(2 + 5 * 2 + 1);
  });

  it('LOOP does not change flags', () => {
    const emu = runProgram('MOV AX, 1\nCMP AX, 2\nMOV CX, 1\nl: LOOP l\nHLT');
    expect(emu.cpu.getFlag('ZF')).toBe(0);
    expect(emu.cpu.getFlag('CF')).toBe(1);
  });

  it('IP advances by the instruction length', () => {
    const emu = new Emulator();
    emu.assemble('MOV AX, 1234h\nMOV AL, 1\nNOP\nHLT');
    expect(emu.cpu.ip).toBe(0);
    emu.step();
    expect(emu.cpu.ip).toBe(3); // B8 34 12
    emu.step();
    expect(emu.cpu.ip).toBe(5); // B0 01
    emu.step();
    expect(emu.cpu.ip).toBe(6); // 90
    emu.step();
    expect(emu.cpu.ip).toBe(7); // F4: after HLT, IP points past it
    expect(emu.status).toBe('halted');
  });

  it('a jump sets IP to the label address', () => {
    const emu = new Emulator();
    const program = emu.assemble('JMP target\nNOP\nNOP\ntarget: HLT');
    emu.step();
    expect(emu.cpu.ip).toBe(program.labels.TARGET);
    expect(program.labels.TARGET).toBe(4);
  });

  it('CALL pushes the return address and RET pops it', () => {
    const emu = new Emulator();
    const program = emu.assemble('CALL f\nHLT\nf: MOV AX, 7\nRET');
    emu.step(); // CALL
    expect(emu.cpu.ip).toBe(program.labels.F);
    expect(reg(emu, 'SP')).toBe(0xfffc);
    expect(emu.memory.readWord(0x30000 + 0xfffc)).toBe(3); // return address = after CALL (3 bytes)
    emu.run();
    expect(reg(emu, 'AX')).toBe(7);
    expect(reg(emu, 'SP')).toBe(0xfffe);
    expect(emu.status).toBe('halted');
  });

  it('the assembler picks short JMP when close and near JMP when far', () => {
    expect(bytesOf('x: JMP x')).toEqual([0xeb, 0xfe]);
    const far = `JMP far_away\n${'MOV AX, 1234h\n'.repeat(50)}far_away: HLT`;
    const emu = new Emulator();
    const program = emu.assemble(far);
    expect(program.listing[0].bytes[0]).toBe(0xe9);
    emu.step();
    expect(emu.cpu.ip).toBe(program.labels.FAR_AWAY);
  });

  it('conditional jumps out of short range are reported, with a fix', () => {
    const err = asmError(`JE far_away\n${'MOV AX, 1234h\n'.repeat(50)}far_away: HLT`);
    expect(err.message).toMatch(/−128..\+127/);
    expect(err.hint).toMatch(/JMP/);
    expect(err.line).toBe(1);
  });

  it('backward and forward conditional jumps encode correct displacements', () => {
    expect(bytesOf('back: JNZ back')).toEqual([0x75, 0xfe]);
    const emu = new Emulator();
    const program = emu.assemble('JE fwd\nNOP\nfwd: HLT');
    expect(program.listing[0].bytes).toEqual([0x74, 0x01]);
  });
});
