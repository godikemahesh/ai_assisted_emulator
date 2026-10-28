// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { CPU } from '../src/emulator/index.js';
import { runProgram, reg } from './helpers.js';

describe('register reads and writes', () => {
  it('8-bit halves alias the 16-bit registers', () => {
    const cpu = new CPU();
    cpu.set('AX', 0x1234);
    expect(cpu.get('AH')).toBe(0x12);
    expect(cpu.get('AL')).toBe(0x34);
    cpu.set('AL', 0xff);
    expect(cpu.get('AX')).toBe(0x12ff);
    cpu.set('AH', 0x00);
    expect(cpu.get('AX')).toBe(0x00ff);
  });

  it('all general, pointer and segment registers are independent', () => {
    const cpu = new CPU();
    const names = ['AX', 'BX', 'CX', 'DX', 'SI', 'DI', 'BP', 'SP', 'CS', 'DS', 'SS', 'ES'];
    names.forEach((n, i) => cpu.set(n, 0x1100 + i));
    names.forEach((n, i) => expect(cpu.get(n)).toBe(0x1100 + i));
    expect(cpu.get('BL')).toBe(0x01);
    expect(cpu.get('CH')).toBe(0x11);
    expect(cpu.get('DL')).toBe(0x03);
  });

  it('values are truncated to the register width', () => {
    const cpu = new CPU();
    cpu.set('AX', 0x12345);
    expect(cpu.get('AX')).toBe(0x2345);
    cpu.set('BL', 0x1ff);
    expect(cpu.get('BL')).toBe(0xff);
    expect(cpu.get('BH')).toBe(0x00);
  });

  it('reset puts the documented initial values in place', () => {
    const cpu = new CPU();
    cpu.set('AX', 5);
    cpu.reset();
    expect(cpu.get('AX')).toBe(0);
    expect(cpu.get('CS')).toBe(0x1000);
    expect(cpu.get('DS')).toBe(0x2000);
    expect(cpu.get('SS')).toBe(0x3000);
    expect(cpu.get('ES')).toBe(0x2000);
    expect(cpu.get('SP')).toBe(0xfffe);
    expect(cpu.get('IP')).toBe(0);
    expect(cpu.get('FLAGS')).toBe(0x0002); // reserved bit 1 always reads 1
  });

  it('MOV between registers of every size works through executed code', () => {
    const emu = runProgram(`
      MOV AX, 1234h
      MOV BX, AX
      MOV CL, AH
      MOV CH, AL
      MOV SI, 0FFFFh
      MOV DI, SI
      MOV BP, 7
      MOV DX, BP
      MOV ES, AX
      MOV SP, 100h
      HLT`);
    expect(reg(emu, 'BX')).toBe(0x1234);
    expect(reg(emu, 'CX')).toBe(0x3412);
    expect(reg(emu, 'DI')).toBe(0xffff);
    expect(reg(emu, 'DX')).toBe(7);
    expect(reg(emu, 'ES')).toBe(0x1234);
    expect(reg(emu, 'SP')).toBe(0x100);
  });

  it('XCHG swaps registers', () => {
    const emu = runProgram('MOV AX, 1\nMOV BX, 2\nXCHG AX, BX\nMOV CX, 0AB12h\nXCHG CH, CL\nHLT');
    expect(reg(emu, 'AX')).toBe(2);
    expect(reg(emu, 'BX')).toBe(1);
    expect(reg(emu, 'CX')).toBe(0x12ab);
  });
});
