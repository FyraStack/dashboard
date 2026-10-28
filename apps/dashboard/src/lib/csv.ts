export interface ParsedCsv {
	columns: string[];
	rows: Record<string, string>[];
}

interface QuotedField {
	end: number;
	value: string;
}

function readQuotedField(text: string, start: number): QuotedField {
	let value = '';
	let index = start;
	while (index < text.length) {
		const char = text[index];
		if (char !== '"') {
			value += char;
			index += 1;
		} else if (text[index + 1] === '"') {
			value += '"';
			index += 2;
		} else {
			return { value, end: index + 1 };
		}
	}
	return { value, end: index };
}

function parseRecords(text: string): string[][] {
	const records: string[][] = [];
	let record: string[] = [];
	let field = '';
	let index = 0;

	while (index < text.length) {
		const char = text[index];
		if (char === '"') {
			const quoted = readQuotedField(text, index + 1);
			field += quoted.value;
			index = quoted.end;
		} else if (char === ',') {
			record.push(field);
			field = '';
			index += 1;
		} else if (char === '\n' || char === '\r') {
			record.push(field);
			field = '';
			records.push(record);
			record = [];
			index += char === '\r' && text[index + 1] === '\n' ? 2 : 1;
		} else {
			field += char;
			index += 1;
		}
	}

	if (field !== '' || record.length > 0) {
		record.push(field);
		records.push(record);
	}

	return records;
}

export function parseCsv(text: string): ParsedCsv {
	const records = parseRecords(text);
	if (records.length === 0) {
		return { columns: [], rows: [] };
	}

	const header = records[0].map((cell) => cell.trim());
	const columns = header.filter((name) => name !== '');
	const rows = records
		.slice(1)
		.filter((record) => record.some((cell) => cell.trim() !== ''))
		.map((record) => {
			const row: Record<string, string> = {};
			header.forEach((name, index) => {
				if (name !== '') {
					row[name] = (record[index] ?? '').trim();
				}
			});
			return row;
		});

	return { columns, rows };
}
