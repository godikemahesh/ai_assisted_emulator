// CPU register file: general registers, segment registers, IP and FLAGS.

import {
  REG16, REG8, SREG, DEFAULT_SEGMENTS, DEFAULT_SP, FLAG_BITS, FLAGS_RESERVED,
} from './constants.js';

export class CPU {
  constructor() {
    this.reset();
  }

  reset(segments = DEFAULT_SEGMENTS, sp = DEFAULT_SP) {
    this.regs = new Uint16Array(8); // AX CX DX BX SP BP SI DI
    this.sregs = new Uint16Array(4); // ES CS SS DS
    this.sregs[0] = segments.ES;
    this.sregs[1] = segments.CS;
    this.sregs[2] = segments.SS;
    this.sregs[3] = segments.DS;
    this.regs[4] = sp;
    this.ip = 0;
    this.flags = FLAGS_RESERVED;
    this.halted = false;
  }

  getReg16(index) {
    return this.regs[index];
  }

  setReg16(index, value) {
    this.regs[index] = value & 0xffff;
  }

  /** 8-bit index 0–3 = AL CL DL BL (low byte of AX CX DX BX), 4–7 = AH CH DH BH (high byte). */
  getReg8(index) {
    return index < 4 ? this.regs[index] & 0xff : this.regs[index - 4] >> 8;
  }

  setReg8(index, value) {
    value &= 0xff;
    if (index < 4) this.regs[index] = (this.regs[index] & 0xff00) | value;
    else this.regs[index - 4] = (this.regs[index - 4] & 0x00ff) | (value << 8);
  }

  /** Read any register by name (AX, AL, CS, IP, FLAGS ...). */
  get(name) {
    name = name.toUpperCase();
    if (REG16.includes(name)) return this.getReg16(REG16.indexOf(name));
    if (REG8.includes(name)) return this.getReg8(REG8.indexOf(name));
    if (SREG.includes(name)) return this.sregs[SREG.indexOf(name)];
    if (name === 'IP') return this.ip;
    if (name === 'FLAGS') return this.flags;
    throw new Error(`Unknown register ${name}`);
  }

  set(name, value) {
    name = name.toUpperCase();
    if (REG16.includes(name)) return this.setReg16(REG16.indexOf(name), value);
    if (REG8.includes(name)) return this.setReg8(REG8.indexOf(name), value);
    if (SREG.includes(name)) {
      this.sregs[SREG.indexOf(name)] = value & 0xffff;
      return undefined;
    }
    if (name === 'IP') {
      this.ip = value & 0xffff;
      return undefined;
    }
    if (name === 'FLAGS') {
      this.flags = (value & 0x0fd5) | FLAGS_RESERVED;
      return undefined;
    }
    throw new Error(`Unknown register ${name}`);
  }

  getFlag(name) {
    return (this.flags >> FLAG_BITS[name]) & 1;
  }

  setFlag(name, on) {
    const bit = 1 << FLAG_BITS[name];
    this.flags = on ? this.flags | bit : this.flags & ~bit;
  }

  /** Set several flags at once, e.g. setFlags({ CF: true, ZF: false }). */
  setFlags(values) {
    for (const [name, on] of Object.entries(values)) this.setFlag(name, on);
  }

  /** Plain-object copy of all registers (used for diffs, snapshots and rollback). */
  save() {
    return {
      AX: this.regs[0], BX: this.regs[3], CX: this.regs[1], DX: this.regs[2],
      SI: this.regs[6], DI: this.regs[7], BP: this.regs[5], SP: this.regs[4],
      CS: this.sregs[1], DS: this.sregs[3], SS: this.sregs[2], ES: this.sregs[0],
      IP: this.ip, FLAGS: this.flags, halted: this.halted,
    };
  }

  restore(state) {
    for (const name of ['AX', 'BX', 'CX', 'DX', 'SI', 'DI', 'BP', 'SP', 'CS', 'DS', 'SS', 'ES']) {
      this.set(name, state[name]);
    }
    this.ip = state.IP;
    this.flags = state.FLAGS;
    this.halted = state.halted;
  }
}
