// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { EXAMPLES } from '../src/examples/programs.js';
import { runProgram } from './helpers.js';

describe('example programs produce their documented results', () => {
  it.each(EXAMPLES.map((e) => [e.title, e]))('%s', (_title, example) => {
    const emu = runProgram(example.source);
    expect(emu.status).toBe('halted');
    const { registers = {}, flags = {}, variables = {}, memory = {} } = example.expected;
    for (const [name, value] of Object.entries(registers)) {
      expect({ [name]: emu.cpu.get(name) }).toEqual({ [name]: value });
    }
    for (const [name, value] of Object.entries(flags)) {
      expect({ [name]: emu.cpu.getFlag(name) }).toEqual({ [name]: value });
    }
    for (const [name, value] of Object.entries(variables)) {
      const v = emu.program.variables[name.toUpperCase()];
      const addr = 0x20000 + v.offset;
      const actual = v.size === 8 ? emu.memory.readByte(addr) : emu.memory.readWord(addr);
      expect({ [name]: actual }).toEqual({ [name]: value });
    }
    for (const [address, bytes] of Object.entries(memory)) {
      expect(emu.readBytes(Number(address), bytes.length)).toEqual(bytes);
    }
  });
});
