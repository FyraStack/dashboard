export type ParsedCsv = {
	columns: string[];
	rows: Record<string, string>[];
};

function parseRecords(text: string): string[][] {
	const records: string[][] = [];
	let record: string[] = [];
	let field = '';
	let inQuotes = false;

	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (inQuotes) {
			if (char === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				field += char;
			}
		} else if (char === '"') {
			inQuotes = true;
		} else if (char === ',') {
			record.push(field);
			field = '';
		} else if (char === '\n' || char === '\r') {
			if (char === '\r' && text[i + 1] === '\n') {
				i++;
			}
			record.push(field);
			field = '';
			records.push(record);
			record = [];
		} else {
			field += char;
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
