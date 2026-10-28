// Example programs. `expected` values are checked by tests/examples.test.js,
// so they are verified against the emulator, not written by hand and hoped for.

export const EXAMPLES = [
  {
    id: 'addition',
    title: 'Addition of two numbers',
    description: 'Loads two 16-bit numbers from memory, adds them and stores the sum.',
    source: `; Addition of two 16-bit numbers
.DATA
num1   DW 1234h
num2   DW 0F00h
result DW ?

.CODE
start:
    MOV AX, [num1]     ; AX = 1234h
    MOV BX, [num2]     ; BX = 0F00h
    ADD AX, BX         ; AX = 1234h + 0F00h = 2134h
    MOV [result], AX   ; store the sum in memory
    HLT
`,
    expected: {
      registers: { AX: 0x2134, BX: 0x0f00 },
      flags: { CF: 0, ZF: 0, SF: 0, OF: 0 },
      variables: { result: 0x2134 },
    },
  },
  {
    id: 'subtraction',
    title: 'Subtraction of two numbers',
    description: 'Subtracts a larger number from a smaller one (borrow) and shows the zero flag.',
    source: `; Subtraction and the borrow / zero flags
.DATA
a    DW 0050h
b    DW 0075h
diff DW ?

.CODE
    MOV AX, [a]        ; AX = 0050h
    SUB AX, [b]        ; 50h - 75h = FFDBh (-37): CF=1 (borrow), SF=1
    MOV [diff], AX     ; store the result
    MOV CX, 10
    SUB CX, 10         ; CX = 0 so ZF=1
    HLT
`,
    expected: {
      registers: { AX: 0xffdb, CX: 0x0000 },
      flags: { CF: 0, ZF: 1, SF: 0, OF: 0 },
      variables: { diff: 0xffdb },
    },
  },
  {
    id: 'incdec',
    title: 'Increment and decrement',
    description: 'INC and DEC change ZF, SF, OF, AF, PF but never CF.',
    source: `; INC and DEC (note: they do NOT change CF)
    STC                ; CF = 1 so we can see that INC/DEC keep it
    MOV AL, 0FEh
    INC AL             ; AL = FFh, SF=1
    INC AL             ; AL = 00h, ZF=1 (CF still 1)
    MOV BX, 1
    DEC BX             ; BX = 0000h, ZF=1
    DEC BX             ; BX = FFFFh, SF=1
    HLT
`,
    expected: {
      registers: { AX: 0x0000, BX: 0xffff },
      flags: { CF: 1, ZF: 0, SF: 1 },
    },
  },
  {
    id: 'compare',
    title: 'Comparison and conditional jumps',
    description: 'Finds the larger of two numbers with CMP + JGE, then tests equality with JE / JNE.',
    source: `; Find the larger of two numbers, then test it
.DATA
x   DW 25
y   DW 40
max DW ?

.CODE
    MOV AX, [x]        ; AX = 25
    MOV BX, [y]        ; BX = 40
    CMP AX, BX         ; flags from 25 - 40
    JGE keep_ax        ; signed: jump if AX >= BX (not taken)
    MOV AX, BX         ; AX = larger value = 40
keep_ax:
    MOV [max], AX
    CMP AX, 40
    JE is_forty        ; ZF=1, so this jump is taken
    MOV DX, 0
    JMP done
is_forty:
    MOV DX, 1          ; DX = 1 means "max was 40"
done:
    CMP DX, 1
    JNE done           ; not taken (DX = 1)
    HLT
`,
    expected: {
      registers: { AX: 40, BX: 40, DX: 1 },
      flags: { ZF: 1, CF: 0 },
      variables: { max: 40 },
    },
  },
  {
    id: 'loop',
    title: 'Simple loop (sum 1 to 5)',
    description: 'Uses LOOP (which decrements CX) to add 5 + 4 + 3 + 2 + 1.',
    source: `; Sum of 1..5 using LOOP
    MOV CX, 5          ; loop counter
    MOV AX, 0          ; running total
next:
    ADD AX, CX         ; AX = AX + CX
    LOOP next          ; CX = CX - 1, repeat while CX != 0
    MOV BX, AX         ; BX = 15 (000Fh)

; The same idea with DEC + JNZ
    MOV DX, 3
    MOV SI, 0
again:
    INC SI
    DEC DX
    JNZ again          ; runs 3 times, SI = 3
    HLT
`,
    expected: {
      registers: { AX: 15, BX: 15, CX: 0, DX: 0, SI: 3 },
      flags: { ZF: 1 },
    },
  },
  {
    id: 'memory',
    title: 'Register and memory operations',
    description: 'Copies an array with SI/DI, reads a little-endian word, writes with WORD PTR and swaps bytes.',
    source: `; Register and memory operations
.DATA
src DB 11h, 22h, 33h, 44h
dst DB 4 DUP(0)

.CODE
    MOV SI, OFFSET src     ; SI = address of src (0000h)
    MOV DI, OFFSET dst     ; DI = address of dst (0004h)
    MOV CX, 4
copy:
    MOV AL, [SI]           ; read one byte
    MOV [DI], AL           ; write it to dst
    INC SI
    INC DI
    LOOP copy
    MOV BX, OFFSET src
    MOV AX, [BX+2]         ; little-endian word: AX = 4433h
    XCHG AH, AL            ; AX = 3344h
    MOV WORD PTR [dst+2], 0BEEFh  ; dst bytes 2,3 = EFh, BEh
    LEA DX, [BX+SI]        ; DX = 0000h + 0004h = 0004h (no memory read)
    HLT
`,
    expected: {
      registers: { AX: 0x3344, BX: 0x0000, SI: 0x0004, DI: 0x0008, DX: 0x0004 },
      memory: { 0x20004: [0x11, 0x22, 0xef, 0xbe] },
    },
  },
  {
    id: 'flags',
    title: 'Flags: carry, overflow and sign',
    description: 'Shows the difference between unsigned carry (CF) and signed overflow (OF).',
    source: `; Carry vs overflow
    MOV AL, 0FFh
    ADD AL, 1          ; 255 + 1 = 256: AL = 00h, CF=1, ZF=1, AF=1
    MOV BL, 7Fh
    ADD BL, 1          ; 127 + 1 = 128: BL = 80h, OF=1 (signed overflow), SF=1
    MOV CX, 0
    SUB CX, 1          ; 0 - 1: CX = FFFFh, CF=1 (borrow), SF=1
    HLT
`,
    expected: {
      registers: { AX: 0x0000, BX: 0x0080, CX: 0xffff },
      flags: { CF: 1, SF: 1, OF: 0, ZF: 0 },
    },
  },
  {
    id: 'stack',
    title: 'Stack, CALL and RET',
    description: 'PUSH/POP swap two registers (last in, first out), then a procedure doubles CX.',
    source: `; Stack and procedures
    MOV AX, 1111h
    MOV BX, 2222h
    PUSH AX            ; stack: 1111h
    PUSH BX            ; stack: 2222h, 1111h
    POP AX             ; AX = 2222h (last in, first out)
    POP BX             ; BX = 1111h -> registers swapped
    MOV CX, 7
    CALL double_cx     ; pushes return address, jumps
    HLT

double_cx:
    ADD CX, CX         ; CX = 14
    RET                ; pops return address into IP
`,
    expected: {
      registers: { AX: 0x2222, BX: 0x1111, CX: 14, SP: 0xfffe },
    },
  },
  {
    id: 'muldiv',
    title: 'Multiply, divide and shift',
    description: 'MUL, DIV and the 8086 shift forms (count 1 or CL).',
    source: `; MUL, DIV and shifts
    MOV AL, 12
    MOV BL, 10
    MUL BL             ; AX = 12 * 10 = 120 (0078h)
    MOV AX, 1000
    MOV DX, 0          ; DX:AX = 1000
    MOV CX, 7
    DIV CX             ; AX = 142 (008Eh), DX = remainder 6
    MOV BX, 0081h
    SHL BX, 1          ; BX = 0102h
    MOV CL, 4
    SHR BX, CL         ; BX = 0010h
    HLT
`,
    expected: {
      registers: { AX: 142, DX: 6, BX: 0x0010, CX: 0x0004 },
    },
  },
];

export const getExample = (id) => EXAMPLES.find((e) => e.id === id);
