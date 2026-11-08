import { RpcTarget } from 'cloudflare:workers';
import { inScope, type Scope } from '#lib/server/context.js';
import {
	listCampaignTemplates,
	type PreviewCampaignEmailInput,
	previewCampaignEmail,
	type RenderCampaignEditorInput,
	renderCampaignEditor,
	type SendCampaignEmailsInput,
	sendCampaignEmails
} from '#lib/server/handlers/email-campaign.js';

export class AdminEmails extends RpcTarget {
	readonly #scope: Scope;

	constructor(scope: Scope) {
		super();
		this.#scope = scope;
	}

	templates() {
		return inScope(this.#scope, () => listCampaignTemplates());
	}

	renderEditor(input: RenderCampaignEditorInput) {
		return inScope(this.#scope, () => renderCampaignEditor(input));
	}

	preview(input: PreviewCampaignEmailInput) {
		return inScope(this.#scope, () => previewCampaignEmail(input));
	}

	send(input: SendCampaignEmailsInput) {
		return inScope(this.#scope, () => sendCampaignEmails(input));
	}
}
