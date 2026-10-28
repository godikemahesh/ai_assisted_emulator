// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { assemble, parseNumber, decode, disassemble } from '../src/emulator/index.js';
import { asmError, bytesOf } from './helpers.js';

describe('machine-code encoding matches the 8086 instruction set', () => {
  const cases = [
    ['MOV AX, 1234h', [0xb8, 0x34, 0x12]],
    ['MOV AL, 5', [0xb0, 0x05]],
    ['MOV BX, AX', [0x89, 0xc3]],
    ['MOV [BX+SI+4], AL', [0x88, 0x40, 0x04]],
    ['MOV AX, [BP]', [0x8b, 0x46, 0x00]],
    ['MOV WORD PTR [1000h], 5', [0xc7, 0x06, 0x00, 0x10, 0x05, 0x00]],
    ['MOV DS, AX', [0x8e, 0xd8]],
    ['MOV AX, DS', [0x8c, 0xd8]],
    ['MOV AX, ES:[BX]', [0x26, 0x8b, 0x07]],
    ['MOV CX, [BX+DI+1234h]', [0x8b, 0x89, 0x34, 0x12]],
    ['ADD AX, 5', [0x83, 0xc0, 0x05]],
    ['ADD AL, 5', [0x04, 0x05]],
    ['ADD AX, 1000h', [0x05, 0x00, 0x10]],
    ['ADD BX, 1000h', [0x81, 0xc3, 0x00, 0x10]],
    ['ADD BL, 7', [0x80, 0xc3, 0x07]],
    ['SUB CX, BX', [0x29, 0xd9]],
    ['CMP AL, BL', [0x38, 0xd8]],
    ['CMP AX, [SI]', [0x3b, 0x04]],
    ['XOR AX, AX', [0x31, 0xc0]],
    ['AND AL, 0Fh', [0x24, 0x0f]],
    ['OR DX, 0FFFFh', [0x83, 0xca, 0xff]],
    ['INC AX', [0x40]],
    ['INC AL', [0xfe, 0xc0]],
    ['DEC WORD PTR [BX]', [0xff, 0x0f]],
    ['NOT AX', [0xf7, 0xd0]],
    ['NEG AL', [0xf6, 0xd8]],
    ['MUL BL', [0xf6, 0xe3]],
    ['DIV CX', [0xf7, 0xf1]],
    ['TEST AL, 1', [0xa8, 0x01]],
    ['TEST BX, CX', [0x85, 0xcb]],
    ['SHL AX, 1', [0xd1, 0xe0]],
    ['SHR BX, CL', [0xd3, 0xeb]],
    ['SAR AL, 1', [0xd0, 0xf8]],
    ['PUSH AX', [0x50]],
    ['PUSH ES', [0x06]],
    ['POP DS', [0x1f]],
    ['POP DI', [0x5f]],
    ['LEA SI, [BX+DI+10h]', [0x8d, 0x71, 0x10]],
    ['NOP', [0x90]],
    ['HLT', [0xf4]],
    ['RET', [0xc3]],
    ['CLC', [0xf8]],
    ['STC', [0xf9]],
  ];
  it.each(cases)('%s', (src, bytes) => {
    expect(bytesOf(src)).toEqual(bytes);
  });

  it.each(cases)('decoder round-trips %s', (src, bytes) => {
    const instr = decode((i) => bytes[i], 0);
    expect(instr.length).toBe(bytes.length);
    const re = bytesOf(disassemble(instr));
    expect(re).toEqual(bytes);
  });
});

describe('number formats', () => {
  it('parses decimal, hex, binary and characters', () => {
    expect(parseNumber('25')).toBe(25);
    expect(parseNumber('25d')).toBe(25);
    expect(parseNumber('19h')).toBe(25);
    expect(parseNumber('0FFh')).toBe(255);
    expect(parseNumber('0x1F')).toBe(31);
    expect(parseNumber('1010b')).toBe(10);
    expect(parseNumber("'A'")).toBe(65);
    expect(parseNumber('FFh')).toBe(null); // must start with a digit
    expect(parseNumber('abc')).toBe(null);
  });

  it('accepts EQU constants, negative values and expressions', () => {
    expect(bytesOf('MOV AX, -1')).toEqual([0xb8, 0xff, 0xff]);
    expect(bytesOf("MOV AL, 'a'")).toEqual([0xb0, 0x61]);
    expect(bytesOf('MOV AX, 10h+2-1')).toEqual([0xb8, 0x11, 0x00]);
  });

  it('assembles data definitions with DUP and strings', () => {
    const emuBytes = (src) => {
      const err = asmError(src);
      if (err) throw new Error(err.message);
    };
    expect(() => emuBytes(".DATA\nmsg DB 'Hi', 0\nbuf DB 3 DUP(?)\nw DW 1, 2\nCOUNT EQU 5\n.CODE\nMOV CX, COUNT\nHLT")).not.toThrow();
  });
});

describe('syntax and operand errors give line numbers and hints', () => {
  const cases = [
    ['MOVE AX, 1\nHLT', /Unknown instruction 'MOVE'/, /MOV/],
    ['IMUL BX\nHLT', /not support/, /reference/],
    ['PUSHA\nHLT', /80186/, null],
    ['MOV AX\nHLT', /expects 2 operands/, /Syntax/],
    ['MOV AX, BL\nHLT', /size mismatch/, /same size/],
    ['MOV [BX], 5\nHLT', /ambiguous/, /WORD PTR/],
    ['.DATA\na DW 1\nb DW 2\n.CODE\nMOV [a], [b]\nHLT', /two memory operands/, /register first/],
    ['MOV DS, 2000h\nHLT', /directly into DS/, /MOV AX, 2000h/],
    ['MOV CS, AX\nHLT', /MOV CS/, null],
    ['MOV AL, 300\nHLT', /does not fit/, /−128..255/],
    ['MOV AL, FFh\nHLT', /not a valid number/, /0FFh/],
    ['MOV AX, [CX]\nHLT', /CX cannot be used inside/, /BX or BP/],
    ['MOV AX, [BX+BP]\nHLT', /Invalid addressing mode/, /at most one base/],
    ['MOV AX, [SI+DI]\nHLT', /Invalid addressing mode/, null],
    ['JMP nowhere\nHLT', /Undefined label 'nowhere'/, null],
    ['SHL AX, 3\nHLT', /must be 1 or CL/, /MOV CL, 3/],
    ['PUSH 5\nHLT', /80186/, /MOV AX, 5/],
    ['PUSH AL\nHLT', /16-bit operands only/, null],
    ['MUL 5\nHLT', /constant/, /MOV BL, 5/],
    ['ADD 5, AX\nHLT', /cannot be a constant/, null],
    ['ADD DS, AX\nHLT', /Segment register DS cannot be used with ADD/, /MOV AX, DS/],
    ['x: NOP\nx: HLT', /defined more than once/, null],
    ['AX: NOP\nHLT', /reserved word/, null],
    ['DB 5\nHLT', /\.DATA section/, null],
    ['.DATA\nMOV AX, 1', /\.DATA section/, /\.CODE/],
    ['ORG 100h\nHLT', /ORG is not supported/, null],
    ['.DATA\nv DW 1\n.CODE\nMOV AL, [v]\nHLT', /size mismatch/, /BYTE PTR/],
    ['', /no instructions/, null],
  ];
  it.each(cases)('%j', (src, message, hint) => {
    const err = asmError(src);
    expect(err).not.toBeNull();
    expect(err.message).toMatch(message);
    if (hint) expect(err.hint).toMatch(hint);
  });

  it('reports every error, each with its own line number', () => {
    const program = assemble('MOV AX, 1\nFOO\nMOV AX, BL\nHLT');
    expect(program.ok).toBe(false);
    expect(program.errors.map((e) => e.line)).toEqual([2, 3]);
    expect(program.errors[0].source).toBe('FOO');
  });

  it('ignores comments, blank lines and case', () => {
    expect(asmError('; comment only\n\n  mov ax, 5 ; set ax\n  Hlt')).toBeNull();
    expect(asmError("MOV AL, ';'\nHLT")).toBeNull(); // semicolon inside quotes is not a comment
  });

  it('warns when HLT is missing', () => {
    const program = assemble('MOV AX, 1');
    expect(program.ok).toBe(true);
    expect(program.warnings[0].message).toMatch(/no HLT/);
  });
});
