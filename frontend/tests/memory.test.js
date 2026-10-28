// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Emulator, Memory, physicalAddress } from '../src/emulator/index.js';
import { MemoryError } from '../src/emulator/memory.js';
import { runProgram, reg } from './helpers.js';

describe('address calculation', () => {
  it('physical = segment × 16 + offset', () => {
    expect(physicalAddress(0x2000, 0x0010)).toBe(0x20010);
    expect(physicalAddress(0x1234, 0x5678)).toBe(0x179b8);
    expect(physicalAddress(0xffff, 0x000f)).toBe(0xfffff); // last byte of memory
    expect(physicalAddress(0xffff, 0x0010)).toBe(0x100000); // just past 1 MB (caller must reject)
  });

  it('data variables are placed at DS:offset and read little-endian', () => {
    const emu = runProgram('.DATA\nw DW 1234h\nb DB 0ABh\n.CODE\nMOV AX, [w]\nMOV BL, [b]\nHLT');
    expect(emu.memory.readByte(0x20000)).toBe(0x34);
    expect(emu.memory.readByte(0x20001)).toBe(0x12);
    expect(emu.memory.readByte(0x20002)).toBe(0xab);
    expect(reg(emu, 'AX')).toBe(0x1234);
    expect(reg(emu, 'BL')).toBe(0xab);
  });

  it('register-indirect and based-indexed addressing', () => {
    const emu = runProgram(`
      .DATA
      arr DB 10h, 20h, 30h, 40h, 50h
      .CODE
      MOV BX, OFFSET arr
      MOV SI, 2
      MOV AL, [BX+SI]       ; 30h
      MOV AH, [BX+SI+1]     ; 40h
      MOV DL, arr[SI+2]     ; 50h (MASM style)
      MOV DH, [arr+1]       ; 20h
      HLT`);
    expect(reg(emu, 'AX')).toBe(0x4030);
    expect(reg(emu, 'DX')).toBe(0x2050);
  });

  it('BP-based addresses default to the stack segment (SS)', () => {
    const emu = runProgram('MOV BP, 10h\nMOV WORD PTR [BP], 0BEEFh\nMOV AX, [BP]\nHLT');
    expect(emu.memory.readWord(0x30010)).toBe(0xbeef);
    expect(emu.memory.readWord(0x20010)).toBe(0);
    expect(reg(emu, 'AX')).toBe(0xbeef);
  });

  it('segment override prefixes select another segment', () => {
    const emu = runProgram(`
      MOV AX, 4000h
      MOV ES, AX
      MOV BX, 8
      MOV WORD PTR ES:[BX], 1111h
      MOV WORD PTR [BX], 2222h
      MOV CX, ES:[BX]
      HLT`);
    expect(emu.memory.readWord(0x40008)).toBe(0x1111);
    expect(emu.memory.readWord(0x20008)).toBe(0x2222);
    expect(reg(emu, 'CX')).toBe(0x1111);
  });

  it('changing DS changes where [offset] points', () => {
    const emu = runProgram('MOV AX, 5000h\nMOV DS, AX\nMOV BYTE PTR [0003h], 77h\nHLT');
    expect(emu.memory.readByte(0x50003)).toBe(0x77);
  });

  it('effective addresses wrap at 64 KB inside the segment', () => {
    const emu = runProgram('MOV BX, 0FFFFh\nMOV BYTE PTR [BX+1], 9\nHLT');
    expect(emu.memory.readByte(0x20000)).toBe(9);
  });
});

describe('bounds checking and protection', () => {
  it('Memory rejects addresses outside 1 MB', () => {
    const mem = new Memory();
    expect(() => mem.readByte(0x100000)).toThrow(MemoryError);
    expect(() => mem.writeByte(-1, 0)).toThrow(MemoryError);
    expect(() => mem.readWord(0xfffff)).toThrow(MemoryError);
    expect(() => mem.readByte(0xfffff)).not.toThrow();
  });

  it('an access beyond 1 MB stops execution with an error and changes nothing', () => {
    const emu = runProgram('MOV AX, 0FFFFh\nMOV DS, AX\nMOV BX, 20h\nMOV BYTE PTR [BX], 1\nHLT');
    expect(emu.status).toBe('error');
    expect(emu.lastError.message).toMatch(/outside the 1 MB/);
    expect(emu.lastError.line).toBe(4);
    expect(reg(emu, 'IP')).toBe(emu.program.listing[3].offset); // IP left on the failing instruction
  });

  it('word access at offset FFFFh is rejected', () => {
    const emu = runProgram('MOV BX, 0FFFFh\nMOV AX, [BX]\nHLT');
    expect(emu.status).toBe('error');
    expect(emu.lastError.message).toMatch(/cross the end/);
  });

  it('writes into the loaded machine code are blocked', () => {
    const emu = runProgram('MOV AX, CS\nMOV DS, AX\nMOV BYTE PTR [0000h], 90h\nHLT');
    expect(emu.status).toBe('error');
    expect(emu.lastError.message).toMatch(/machine code/);
    expect(emu.memory.readByte(0x10000)).toBe(0x8c); // first code byte unchanged
  });

  it('a failing instruction is rolled back completely (no partial writes)', () => {
    // 0FFFh:000Fh = physical 0FFFFh. The word write's first byte (0FFFFh) is allowed,
    // the second byte (10000h) is the first byte of the protected code.
    const emu = runProgram('MOV AX, 0FFFh\nMOV DS, AX\nMOV BX, 0Fh\nMOV WORD PTR [BX], 1234h\nHLT');
    expect(emu.status).toBe('error');
    expect(emu.lastError.message).toMatch(/machine code/);
    expect(emu.memory.readByte(0x0ffff)).toBe(0); // the first byte was rolled back
    expect(emu.trace.at(-1).error).toBeTruthy();
  });

  it('stack underflow and overflow are detected', () => {
    let emu = runProgram('POP AX\nHLT');
    expect(emu.status).toBe('error');
    expect(emu.lastError.message).toMatch(/underflow/);
    emu = runProgram('RET');
    expect(emu.lastError.message).toMatch(/underflow/);
    emu = runProgram('MOV SP, 0\nPUSH AX\nHLT');
    expect(emu.lastError.message).toMatch(/overflow/);
  });
});

describe('stack operations', () => {
  it('PUSH/POP are last-in first-out and use SS:SP', () => {
    const emu = new Emulator();
    emu.assemble('MOV AX, 1111h\nMOV BX, 2222h\nPUSH AX\nPUSH BX\nPOP CX\nPOP DX\nHLT');
    emu.run(4);
    expect(reg(emu, 'SP')).toBe(0xfffa);
    expect(emu.memory.readWord(0x3fffc)).toBe(0x1111);
    expect(emu.memory.readWord(0x3fffa)).toBe(0x2222);
    expect(emu.stackWords().map((w) => w.value)).toEqual(['2222', '1111']);
    emu.run();
    expect(reg(emu, 'CX')).toBe(0x2222);
    expect(reg(emu, 'DX')).toBe(0x1111);
    expect(reg(emu, 'SP')).toBe(0xfffe);
  });

  it('PUSH/POP segment registers and memory', () => {
    const emu = runProgram('.DATA\nv DW 0ABCDh\n.CODE\nPUSH DS\nPOP ES\nPUSH WORD PTR [v]\nPOP AX\nHLT');
    expect(reg(emu, 'ES')).toBe(0x2000);
    expect(reg(emu, 'AX')).toBe(0xabcd);
  });

  it('PUSH SP stores the decremented value (8086 behaviour)', () => {
    const emu = runProgram('PUSH SP\nPOP AX\nHLT');
    expect(reg(emu, 'AX')).toBe(0xfffc);
  });

  it('LEA computes an address without reading memory', () => {
    const emu = runProgram('MOV BX, 100h\nMOV SI, 20h\nLEA DI, [BX+SI+5]\nHLT');
    expect(reg(emu, 'DI')).toBe(0x125);
  });
});
