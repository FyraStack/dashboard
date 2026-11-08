import { listCampaignTemplates } from '#lib/remote/email-campaign.remote.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({
	campaignCatalog: await listCampaignTemplates()
});
