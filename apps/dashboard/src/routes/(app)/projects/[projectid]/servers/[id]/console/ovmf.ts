const ESC = 0x1b;
const CSI = 0x5b;
const SEMICOLON = 0x3b;
const CUP = 0x48;
const XTWINOPS = 0x74;
const BANG = 0x21;
const SOFT_RESET = 0x70;
const HARD_RESET = 0x63;
const DIGIT_EIGHT = 0x38;
const MAX_HOLD = 24;

export interface ScreenSize {
	cols: number;
	rows: number;
}

export interface SerialFilterResult {
	bytes: Uint8Array;
	maxCol: number;
	maxRow: number;
	reset: boolean;
	screen: ScreenSize | null;
}

interface ScanState extends Omit<SerialFilterResult, 'bytes'> {
	out: Uint8Array;
	written: number;
}

type Match =
	| { kind: 'incomplete' }
	| { kind: 'none' }
	| { kind: 'cursor'; length: number; needsRepair: boolean; row: number; col: number }
	| { kind: 'screen'; length: number; rows: number; cols: number }
	| { kind: 'reset'; length: number };

const isDigit = (byte: number) => byte >= 0x30 && byte <= 0x39;
const isOvmfTens = (byte: number) => byte >= 0x3a && byte <= 0x40;

function matchCursor(buf: Uint8Array, start: number): Match {
	const expected = [
		isDigit,
		isDigit,
		(b: number) => b === SEMICOLON,
		(b: number) => isDigit(b) || isOvmfTens(b),
		isDigit,
		(b: number) => b === CUP
	];
	for (const [offset, accepts] of expected.entries()) {
		const index = start + 2 + offset;
		if (index >= buf.length) {
			return { kind: 'incomplete' };
		}
		if (!accepts(buf[index])) {
			return { kind: 'none' };
		}
	}
	const row = (buf[start + 2] - 0x30) * 10 + (buf[start + 3] - 0x30);
	const tens = buf[start + 5] - 0x30;
	const col = tens * 10 + (buf[start + 6] - 0x30);
	return { kind: 'cursor', length: 8, needsRepair: isOvmfTens(buf[start + 5]), row, col };
}

function readNumber(
	buf: Uint8Array,
	index: number
): { value: number; end: number } | 'incomplete' | null {
	let end = index;
	let value = 0;
	while (end < buf.length && isDigit(buf[end])) {
		value = value * 10 + (buf[end] - 0x30);
		end += 1;
	}
	if (end === buf.length) {
		return 'incomplete';
	}
	if (end === index) {
		return null;
	}
	return { value, end };
}

function matchScreen(buf: Uint8Array, start: number): Match {
	if (start + 2 >= buf.length) {
		return { kind: 'incomplete' };
	}
	if (buf[start + 2] !== DIGIT_EIGHT) {
		return { kind: 'none' };
	}
	if (start + 3 >= buf.length) {
		return { kind: 'incomplete' };
	}
	if (buf[start + 3] !== SEMICOLON) {
		return { kind: 'none' };
	}
	const rows = readNumber(buf, start + 4);
	if (rows === 'incomplete') {
		return { kind: 'incomplete' };
	}
	if (!rows || rows.end >= buf.length) {
		return rows ? { kind: 'incomplete' } : { kind: 'none' };
	}
	if (buf[rows.end] !== SEMICOLON) {
		return { kind: 'none' };
	}
	const cols = readNumber(buf, rows.end + 1);
	if (cols === 'incomplete') {
		return { kind: 'incomplete' };
	}
	if (!cols || cols.end >= buf.length) {
		return cols ? { kind: 'incomplete' } : { kind: 'none' };
	}
	if (buf[cols.end] !== XTWINOPS) {
		return { kind: 'none' };
	}
	return { kind: 'screen', length: cols.end + 1 - start, rows: rows.value, cols: cols.value };
}

function matchReset(buf: Uint8Array, start: number): Match {
	if (start + 1 >= buf.length) {
		return { kind: 'incomplete' };
	}
	if (buf[start + 1] === HARD_RESET) {
		return { kind: 'reset', length: 2 };
	}
	if (buf[start + 1] !== CSI) {
		return { kind: 'none' };
	}
	if (start + 2 >= buf.length) {
		return { kind: 'incomplete' };
	}
	if (buf[start + 2] !== BANG) {
		return { kind: 'none' };
	}
	if (start + 3 >= buf.length) {
		return { kind: 'incomplete' };
	}
	return buf[start + 3] === SOFT_RESET ? { kind: 'reset', length: 4 } : { kind: 'none' };
}

function matchAt(buf: Uint8Array, start: number): Match {
	if (start + 1 >= buf.length) {
		return { kind: 'incomplete' };
	}
	const reset = matchReset(buf, start);
	if (reset.kind === 'reset') {
		return reset;
	}
	if (buf[start + 1] !== CSI) {
		return reset;
	}
	const cursor = matchCursor(buf, start);
	if (cursor.kind === 'cursor') {
		return cursor;
	}
	const screen = matchScreen(buf, start);
	if (screen.kind === 'screen') {
		return screen;
	}
	if (cursor.kind === 'incomplete' || screen.kind === 'incomplete' || reset.kind === 'incomplete') {
		return { kind: 'incomplete' };
	}
	return { kind: 'none' };
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
	if (a.length === 0) {
		return b;
	}
	const out = new Uint8Array(a.length + b.length);
	out.set(a, 0);
	out.set(b, a.length);
	return out;
}

const encoder = new TextEncoder();

function cursorPosition(row: number, col: number) {
	return encoder.encode(`\x1b[${String(row).padStart(2, '0')};${col}H`);
}

function copy(state: ScanState, bytes: Uint8Array) {
	state.out.set(bytes, state.written);
	state.written += bytes.length;
}

function applyMatch(state: ScanState, input: Uint8Array, start: number, match: Match): number {
	if (match.kind === 'cursor') {
		state.maxRow = Math.max(state.maxRow, match.row);
		state.maxCol = Math.max(state.maxCol, match.col);
		if (match.needsRepair) {
			copy(state, cursorPosition(match.row, match.col));
			return match.length;
		}
	} else if (match.kind === 'screen') {
		state.screen = { rows: match.rows, cols: match.cols };
	} else if (match.kind === 'reset') {
		state.reset = true;
	}
	const length = match.kind === 'incomplete' || match.kind === 'none' ? 1 : match.length;
	copy(state, input.subarray(start, start + length));
	return length;
}

export class OvmfSerialFilter {
	private pending = new Uint8Array(0);

	push(chunk: Uint8Array): SerialFilterResult {
		const input = concat(this.pending, chunk);
		this.pending = new Uint8Array(0);
		const state: ScanState = {
			out: new Uint8Array(input.length + Math.ceil(input.length / 8) + 4),
			written: 0,
			screen: null,
			reset: false,
			maxRow: 0,
			maxCol: 0
		};

		let index = 0;
		while (index < input.length) {
			const nextEscape = input.indexOf(ESC, index);
			const plainEnd = nextEscape === -1 ? input.length : nextEscape;
			copy(state, input.subarray(index, plainEnd));
			index = plainEnd;
			if (index === input.length) {
				break;
			}

			const match = matchAt(input, index);
			if (match.kind === 'incomplete' && input.length - index <= MAX_HOLD) {
				this.pending = input.slice(index);
				break;
			}
			index += applyMatch(state, input, index, match);
		}

		const { out, written, ...result } = state;
		return { bytes: out.subarray(0, written), ...result };
	}

	flush(): Uint8Array {
		const held = this.pending;
		this.pending = new Uint8Array(0);
		return held;
	}
}
