// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { runProgram, reg, flag } from './helpers.js';

const flagsOf = (emu) => Object.fromEntries(['CF', 'PF', 'AF', 'ZF', 'SF', 'OF'].map((f) => [f, flag(emu, f)]));

describe('ADD / ADC flags', () => {
  it('simple addition clears all arithmetic flags except PF where appropriate', () => {
    const emu = runProgram('MOV AX, 1234h\nADD AX, 0F00h\nHLT');
    expect(reg(emu, 'AX')).toBe(0x2134);
    // 34h = 0011 0100 has 3 ones -> odd parity -> PF = 0
    expect(flagsOf(emu)).toEqual({ CF: 0, PF: 0, AF: 0, ZF: 0, SF: 0, OF: 0 });
  });

  it('8-bit unsigned overflow sets CF, ZF, AF, PF', () => {
    const emu = runProgram('MOV AL, 0FFh\nADD AL, 1\nHLT');
    expect(reg(emu, 'AL')).toBe(0);
    expect(flagsOf(emu)).toEqual({ CF: 1, PF: 1, AF: 1, ZF: 1, SF: 0, OF: 0 });
  });

  it('signed overflow 7Fh + 1 sets OF and SF but not CF', () => {
    const emu = runProgram('MOV AL, 7Fh\nADD AL, 1\nHLT');
    expect(reg(emu, 'AL')).toBe(0x80);
    expect(flagsOf(emu)).toEqual({ CF: 0, PF: 0, AF: 1, ZF: 0, SF: 1, OF: 1 });
  });

  it('16-bit signed overflow 8000h + 8000h sets CF, OF, ZF', () => {
    const emu = runProgram('MOV AX, 8000h\nADD AX, 8000h\nHLT');
    expect(reg(emu, 'AX')).toBe(0);
    expect(flag(emu, 'CF')).toBe(1);
    expect(flag(emu, 'OF')).toBe(1);
    expect(flag(emu, 'ZF')).toBe(1);
  });

  it('ADC adds the carry: 32-bit addition 0001FFFFh + 00000001h', () => {
    const emu = runProgram(`
      MOV AX, 0FFFFh
      MOV DX, 0001h
      ADD AX, 1
      ADC DX, 0
      HLT`);
    expect(reg(emu, 'AX')).toBe(0);
    expect(reg(emu, 'DX')).toBe(2);
    expect(flag(emu, 'CF')).toBe(0);
  });

  it('adds memory and register operands', () => {
    const emu = runProgram('.DATA\nv DW 10\n.CODE\nMOV AX, 5\nADD AX, [v]\nADD [v], AX\nMOV BX, [v]\nHLT');
    expect(reg(emu, 'AX')).toBe(15);
    expect(reg(emu, 'BX')).toBe(25);
  });
});

describe('SUB / SBB / CMP / NEG flags', () => {
  it('borrow sets CF and SF', () => {
    const emu = runProgram('MOV AX, 50h\nSUB AX, 75h\nHLT');
    expect(reg(emu, 'AX')).toBe(0xffdb);
    expect(flagsOf(emu)).toEqual({ CF: 1, PF: 1, AF: 1, ZF: 0, SF: 1, OF: 0 });
  });

  it('equal values give ZF=1, CF=0', () => {
    const emu = runProgram('MOV CX, 10\nSUB CX, 10\nHLT');
    expect(reg(emu, 'CX')).toBe(0);
    expect(flagsOf(emu)).toMatchObject({ ZF: 1, CF: 0, SF: 0, OF: 0, PF: 1 });
  });

  it('signed overflow 80h - 1 sets OF', () => {
    const emu = runProgram('MOV AL, 80h\nSUB AL, 1\nHLT');
    expect(reg(emu, 'AL')).toBe(0x7f);
    expect(flag(emu, 'OF')).toBe(1);
    expect(flag(emu, 'SF')).toBe(0);
    expect(flag(emu, 'CF')).toBe(0);
  });

  it('SBB subtracts the borrow', () => {
    const emu = runProgram('STC\nMOV AX, 10\nSBB AX, 3\nHLT');
    expect(reg(emu, 'AX')).toBe(6);
  });

  it('CMP sets flags but does not change the destination', () => {
    const emu = runProgram('MOV AX, 3\nCMP AX, 5\nHLT');
    expect(reg(emu, 'AX')).toBe(3);
    expect(flag(emu, 'CF')).toBe(1);
    expect(flag(emu, 'SF')).toBe(1);
    expect(flag(emu, 'ZF')).toBe(0);
  });

  it('NEG computes the two\'s complement and sets CF unless the operand is 0', () => {
    let emu = runProgram('MOV AX, 1\nNEG AX\nHLT');
    expect(reg(emu, 'AX')).toBe(0xffff);
    expect(flag(emu, 'CF')).toBe(1);
    emu = runProgram('MOV AX, 0\nNEG AX\nHLT');
    expect(flag(emu, 'CF')).toBe(0);
    expect(flag(emu, 'ZF')).toBe(1);
    emu = runProgram('MOV AL, 80h\nNEG AL\nHLT');
    expect(reg(emu, 'AL')).toBe(0x80);
    expect(flag(emu, 'OF')).toBe(1);
  });
});

describe('INC / DEC', () => {
  it('INC and DEC never change CF', () => {
    let emu = runProgram('STC\nMOV AL, 0FFh\nINC AL\nHLT');
    expect(reg(emu, 'AL')).toBe(0);
    expect(flag(emu, 'ZF')).toBe(1);
    expect(flag(emu, 'CF')).toBe(1);
    emu = runProgram('CLC\nMOV BX, 0\nDEC BX\nHLT');
    expect(reg(emu, 'BX')).toBe(0xffff);
    expect(flag(emu, 'CF')).toBe(0);
    expect(flag(emu, 'SF')).toBe(1);
  });

  it('INC 7FFFh sets OF', () => {
    const emu = runProgram('MOV AX, 7FFFh\nINC AX\nHLT');
    expect(reg(emu, 'AX')).toBe(0x8000);
    expect(flag(emu, 'OF')).toBe(1);
  });

  it('INC and DEC work on memory with explicit size', () => {
    const emu = runProgram('.DATA\nb DB 9\nw DW 0FFFFh\n.CODE\nINC BYTE PTR [b]\nINC WORD PTR [w]\nMOV AL, [b]\nMOV BX, [w]\nHLT');
    expect(reg(emu, 'AL')).toBe(10);
    expect(reg(emu, 'BX')).toBe(0);
  });
});

describe('MUL / DIV', () => {
  it('8-bit MUL stores AX = AL * src and sets CF/OF when AH is non-zero', () => {
    let emu = runProgram('MOV AL, 12\nMOV BL, 10\nMUL BL\nHLT');
    expect(reg(emu, 'AX')).toBe(120);
    expect(flag(emu, 'CF')).toBe(0);
    emu = runProgram('MOV AL, 200\nMOV BL, 2\nMUL BL\nHLT');
    expect(reg(emu, 'AX')).toBe(400);
    expect(flag(emu, 'CF')).toBe(1);
    expect(flag(emu, 'OF')).toBe(1);
  });

  it('16-bit MUL stores DX:AX', () => {
    const emu = runProgram('MOV AX, 1000h\nMOV CX, 100h\nMUL CX\nHLT');
    expect(reg(emu, 'DX')).toBe(0x0010);
    expect(reg(emu, 'AX')).toBe(0x0000);
    expect(flag(emu, 'CF')).toBe(1);
  });

  it('DIV gives quotient and remainder', () => {
    let emu = runProgram('MOV AX, 1000\nMOV DX, 0\nMOV CX, 7\nDIV CX\nHLT');
    expect(reg(emu, 'AX')).toBe(142);
    expect(reg(emu, 'DX')).toBe(6);
    emu = runProgram('MOV AX, 100\nMOV BL, 7\nDIV BL\nHLT');
    expect(reg(emu, 'AL')).toBe(14);
    expect(reg(emu, 'AH')).toBe(2);
  });

  it('division by zero and quotient overflow stop with a divide error', () => {
    let emu = runProgram('MOV AX, 5\nMOV BL, 0\nDIV BL\nHLT');
    expect(emu.status).toBe('error');
    expect(emu.lastError.message).toMatch(/division by zero/);
    emu = runProgram('MOV AX, 1000\nMOV BL, 2\nDIV BL\nHLT');
    expect(emu.status).toBe('error');
    expect(emu.lastError.message).toMatch(/does not fit in AL/);
    expect(reg(emu, 'AX')).toBe(1000); // state unchanged by the failed instruction
  });
});

describe('logic instructions', () => {
  it('AND, OR, XOR, NOT', () => {
    const emu = runProgram(`
      MOV AL, 0F0h
      AND AL, 3Ch    ; 30h
      MOV BL, 0F0h
      OR BL, 0Fh     ; FFh
      MOV CX, 1234h
      XOR CX, CX     ; 0
      MOV DL, 55h
      NOT DL         ; AAh
      HLT`);
    expect(reg(emu, 'AL')).toBe(0x30);
    expect(reg(emu, 'BL')).toBe(0xff);
    expect(reg(emu, 'CX')).toBe(0);
    expect(reg(emu, 'DL')).toBe(0xaa);
  });

  it('logic ops clear CF and OF; XOR reg,reg sets ZF', () => {
    const emu = runProgram('STC\nMOV AX, 5\nXOR AX, AX\nHLT');
    expect(flag(emu, 'CF')).toBe(0);
    expect(flag(emu, 'OF')).toBe(0);
    expect(flag(emu, 'ZF')).toBe(1);
    expect(flag(emu, 'PF')).toBe(1);
  });

  it('NOT does not change flags', () => {
    const emu = runProgram('MOV AX, 0\nCMP AX, 0\nNOT AX\nHLT');
    expect(reg(emu, 'AX')).toBe(0xffff);
    expect(flag(emu, 'ZF')).toBe(1); // still from CMP
  });

  it('TEST sets flags without storing', () => {
    const emu = runProgram('MOV AL, 6\nTEST AL, 1\nHLT');
    expect(reg(emu, 'AL')).toBe(6);
    expect(flag(emu, 'ZF')).toBe(1);
  });
});

describe('shifts', () => {
  it('SHL by 1 sets CF from the old top bit', () => {
    const emu = runProgram('MOV AL, 81h\nSHL AL, 1\nHLT');
    expect(reg(emu, 'AL')).toBe(0x02);
    expect(flag(emu, 'CF')).toBe(1);
    expect(flag(emu, 'OF')).toBe(1); // top bit changed
  });

  it('SHR by CL', () => {
    const emu = runProgram('MOV BX, 0102h\nMOV CL, 4\nSHR BX, CL\nHLT');
    expect(reg(emu, 'BX')).toBe(0x0010);
    expect(flag(emu, 'CF')).toBe(0);
  });

  it('SAR keeps the sign', () => {
    const emu = runProgram('MOV AL, 0F0h\nSAR AL, 1\nHLT');
    expect(reg(emu, 'AL')).toBe(0xf8);
    expect(flag(emu, 'SF')).toBe(1);
    expect(flag(emu, 'OF')).toBe(0);
  });

  it('a shift count of 0 changes nothing', () => {
    const emu = runProgram('STC\nMOV AX, 1\nMOV CL, 0\nSHL AX, CL\nHLT');
    expect(reg(emu, 'AX')).toBe(1);
    expect(flag(emu, 'CF')).toBe(1);
  });

  it('SAL is an alias of SHL', () => {
    const emu = runProgram('MOV AX, 3\nSAL AX, 1\nHLT');
    expect(reg(emu, 'AX')).toBe(6);
  });
});

describe('flag-control instructions', () => {
  it('STC, CLC, CMC, STD, CLD, STI, CLI', () => {
    let emu = runProgram('STC\nCMC\nHLT');
    expect(flag(emu, 'CF')).toBe(0);
    emu = runProgram('CLC\nCMC\nSTD\nSTI\nHLT');
    expect(flag(emu, 'CF')).toBe(1);
    expect(flag(emu, 'DF')).toBe(1);
    expect(flag(emu, 'IF')).toBe(1);
    emu = runProgram('STD\nCLD\nSTI\nCLI\nHLT');
    expect(flag(emu, 'DF')).toBe(0);
    expect(flag(emu, 'IF')).toBe(0);
  });
});
