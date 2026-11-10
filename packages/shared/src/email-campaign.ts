const placeholderPattern = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function placeholder(name: string): string {
	return `{{${name}}}`;
}

export function fieldToken(name: string): string {
	return `[[FIELD:${name}]]`;
}

export function applyPlaceholders(template: string, row: Record<string, string>): string {
	return template.replace(placeholderPattern, (_, name: string) => row[name.trim()] ?? '');
}

export function extractPlaceholders(template: string): string[] {
	return [...template.matchAll(placeholderPattern)].map((match) => match[1].trim());
}
