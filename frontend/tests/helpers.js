import { Emulator } from '../src/emulator/index.js';

/** Assemble + run a program; throws if assembly fails so tests show the reason. */
export function runProgram(source, options) {
  const emu = new Emulator(options);
  const program = emu.assemble(source);
  if (!program.ok) throw new Error(`Assembly failed: ${JSON.stringify(program.errors, null, 2)}`);
  emu.run();
  return emu;
}

export const reg = (emu, name) => emu.cpu.get(name);
export const flag = (emu, name) => emu.cpu.getFlag(name);

/** Assemble and return the first error (or null). */
export function asmError(source) {
  const emu = new Emulator();
  const program = emu.assemble(source);
  return program.ok ? null : program.errors[0];
}

/** Machine-code bytes of a single instruction. */
export function bytesOf(line) {
  const emu = new Emulator();
  const program = emu.assemble(`${line}\nHLT`);
  if (!program.ok) throw new Error(program.errors[0].message);
  return program.listing[0].bytes;
}
