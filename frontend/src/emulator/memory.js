// Physical memory: a bounds-checked 1 MiB byte array.

import { MEMORY_SIZE } from './constants.js';
import { hex20 } from './format.js';

export class MemoryError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'MemoryError';
    this.hint = hint;
  }
}

export class Memory {
  constructor(size = MEMORY_SIZE) {
    this.size = size;
    this.bytes = new Uint8Array(size);
    this.protectedRanges = [];
    this.log = null;
  }

  clear() {
    this.bytes.fill(0);
    this.protectedRanges = [];
    this.log = null;
  }

  check(address, length) {
    if (!Number.isInteger(address) || address < 0 || address + length > this.size) {
      throw new MemoryError(
        `Physical address ${hex20(Math.max(0, address))}h is outside the 1 MB address space (00000h–FFFFFh).`,
        'Check the segment register and offset: physical = segment × 16 + offset.',
      );
    }
  }

  readByte(address) {
    this.check(address, 1);
    return this.bytes[address];
  }

  /** Words are little-endian: low byte at the lower address. */
  readWord(address) {
    this.check(address, 2);
    return this.bytes[address] | (this.bytes[address + 1] << 8);
  }

  writeByte(address, value) {
    this.check(address, 1);
    const range = this.protectedRanges.find((r) => address >= r.start && address < r.start + r.length);
    if (range) {
      throw new MemoryError(
        `Write to ${hex20(address)}h blocked: that address holds the program's ${range.label}.`,
        'This emulator protects loaded code from being overwritten. Check your segment registers and addresses.',
      );
    }
    const before = this.bytes[address];
    this.bytes[address] = value & 0xff;
    if (this.log) this.log.push({ address, before, after: value & 0xff });
  }

  writeWord(address, value) {
    this.check(address, 2);
    this.writeByte(address, value & 0xff);
    this.writeByte(address + 1, (value >> 8) & 0xff);
  }

  /** Loads bytes without logging or protection checks (used when a program is loaded). */
  load(address, bytes) {
    this.check(address, bytes.length);
    this.bytes.set(bytes, address);
  }

  protect(start, length, label) {
    if (length > 0) this.protectedRanges.push({ start, length, label });
  }

  startLog() {
    this.log = [];
  }

  stopLog() {
    const log = this.log || [];
    this.log = null;
    return log;
  }

  /** Undo the writes recorded in a log (newest first). */
  rollback(log) {
    for (let i = log.length - 1; i >= 0; i--) this.bytes[log[i].address] = log[i].before;
  }

  slice(address, length) {
    const start = Math.max(0, Math.min(address, this.size));
    const end = Math.max(start, Math.min(address + length, this.size));
    return Array.from(this.bytes.subarray(start, end));
  }
}
