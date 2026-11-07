import type { CampaignTemplateCatalog } from 'stack-backend/types';

export type { CampaignTemplateCatalog } from 'stack-backend/types';

export type CampaignTemplate = CampaignTemplateCatalog['templates'][number];

export type CampaignField = CampaignTemplate['fields'][number];

const placeholderPattern = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function extractPlaceholders(template: string) {
	return [...template.matchAll(placeholderPattern)].map((match) => match[1].trim());
}

export function fieldToken(name: string) {
	return `[[FIELD:${name}]]`;
}
