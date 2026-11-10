export function makeCountMap(rows: { key: string | null; count: number }[]) {
	const map = new Map<string, number>();
	for (const row of rows) {
		if (row.key) {
			map.set(row.key, row.count);
		}
	}
	return map;
}
