import { micromark } from 'micromark';
import {
	gfmAutolinkLiteral,
	gfmAutolinkLiteralHtml
} from 'micromark-extension-gfm-autolink-literal';
import { gfmStrikethrough, gfmStrikethroughHtml } from 'micromark-extension-gfm-strikethrough';

const withoutImages = { disable: { null: ['labelStartImage'] } };
const externalLinkAttributes = 'target="_blank" rel="noopener noreferrer nofollow"';

export function renderMarkdown(source: string): string {
	return micromark(source, {
		extensions: [gfmAutolinkLiteral(), gfmStrikethrough(), withoutImages],
		htmlExtensions: [gfmAutolinkLiteralHtml(), gfmStrikethroughHtml()]
	}).replaceAll('<a href=', `<a ${externalLinkAttributes} href=`);
}
