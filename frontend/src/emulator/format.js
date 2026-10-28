// Number formatting and address helpers.

export const hex8 = (v) => (v & 0xff).toString(16).toUpperCase().padStart(2, '0');
export const hex16 = (v) => (v & 0xffff).toString(16).toUpperCase().padStart(4, '0');
export const hex20 = (v) => v.toString(16).toUpperCase().padStart(5, '0');

/** Hex in assembler style, e.g. 0005h, 0FFFFh (a leading 0 is added when the first digit is a letter). */
export function asmHex(value, size = 16) {
  const digits = size === 8 ? hex8(value) : hex16(value);
  return (/^[A-F]/.test(digits) ? '0' : '') + digits + 'h';
}

export const bytesToHex = (bytes) => bytes.map(hex8).join(' ');

/** Physical address = segment × 16 + offset (may exceed 1 MiB; callers bounds-check it). */
export function physicalAddress(segment, offset) {
  return (segment & 0xffff) * 16 + (offset & 0xffff);
}

export function toSigned(value, size) {
  const sign = size === 8 ? 0x80 : 0x8000;
  const mask = size === 8 ? 0xff : 0xffff;
  value &= mask;
  return value & sign ? value - (mask + 1) : value;
}
