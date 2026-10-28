"""Builds the chat messages sent to the language model.

The model only ever sees a read-only description of the emulator state. It has no tools
and no way to change anything; its reply is plain text shown to the student.
"""

from __future__ import annotations

import json

from .schemas import TutorRequest

DEFAULT_SUPPORTED = (
    "MOV XCHG LEA PUSH POP ADD ADC SUB SBB CMP INC DEC NEG MUL DIV AND OR XOR NOT TEST "
    "SHL/SAL SHR SAR JMP JE/JZ JNE/JNZ JA JAE JB JBE JG JGE JL JLE JS JNS JO JNO JP JNP JC JNC "
    "JCXZ LOOP CALL RET CLC STC CMC CLD STD CLI STI NOP HLT"
)

SYSTEM_PROMPT = """You are a friendly, precise tutor for Intel 8086 assembly language, built into an \
educational browser emulator used by beginners.

Ground rules (always follow them):
1. The emulator engine is the ONLY source of truth for execution results. Register, flag, memory and \
trace values in the context were produced by the emulator. Quote them exactly; never invent values \
that are not in the context.
2. You cannot execute instructions or change registers, flags or memory, and you must never claim \
that you ran the program. When predicting what code would do, say it is a prediction and suggest \
the student press Step in the emulator to confirm.
3. The emulator implements only this subset of the 8086: {supported}. If the student uses anything \
else, say it is not supported here and suggest an equivalent from the subset.
4. Numbers in the context are hexadecimal unless stated otherwise.
5. Memory model used by this emulator: code at CS=1000h, data at DS=ES=2000h, stack at SS=3000h with \
SP starting at FFFEh. Physical address = segment x 16 + offset. Words are little-endian.
6. Be concise and beginner friendly: short paragraphs or bullet points, explain the flags involved, \
and show corrected code in ```asm code blocks.
7. If the context does not contain enough information to answer, say what is missing instead of guessing."""

TASKS = {
    "explain_instruction": "Explain the selected line of the program: what the instruction does, its "
    "operands, which flags it affects, and how it fits into the program.",
    "explain_state": "Explain the current register and flag values in the snapshot: what each "
    "non-zero register holds and why each set flag is set, based on the most recent instructions.",
    "explain_trace": "Walk through the execution trace step by step in plain language, explaining "
    "how registers, flags and memory changed and why.",
    "diagnose_errors": "Diagnose the assembler or runtime errors. For each one, explain the cause in "
    "simple words and show a corrected version of the line.",
    "question": "Answer the student's question using the program and emulator state as context.",
}


def _json(value, limit: int) -> str:
    text = json.dumps(value, indent=1, default=str)
    return text if len(text) <= limit else text[:limit] + "\n... (truncated)"


def build_messages(req: TutorRequest) -> list[dict[str, str]]:
    supported = ", ".join(req.supported_instructions) if req.supported_instructions else DEFAULT_SUPPORTED
    numbered = "\n".join(f"{i + 1:>3}: {line}" for i, line in enumerate(req.program.splitlines()))

    parts = [f"TASK: {TASKS[req.mode]}"]
    if req.question.strip():
        parts.append(f"STUDENT QUESTION:\n{req.question.strip()}")
    if req.selected_line:
        parts.append(f"SELECTED LINE {req.selected_line}: {req.selected_text.strip() or '(empty)'}")
    parts.append(f"PROGRAM (with line numbers):\n{numbered or '(empty)'}")
    if req.errors:
        parts.append("ASSEMBLER / RUNTIME ERRORS:\n" + _json([e.model_dump() for e in req.errors], 4000))
    if req.snapshot:
        parts.append("READ-ONLY EMULATOR SNAPSHOT (produced by the emulator):\n" + _json(req.snapshot, 8000))
    if req.trace:
        parts.append(
            "EXECUTION TRACE (most recent steps, produced by the emulator):\n"
            + _json([t.model_dump(exclude_none=True) for t in req.trace], 8000)
        )

    return [
        {"role": "system", "content": SYSTEM_PROMPT.format(supported=supported)},
        {"role": "user", "content": "\n\n".join(parts)},
    ]
