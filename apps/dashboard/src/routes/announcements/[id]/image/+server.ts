import { backend } from '#lib/server/backend.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const image = await backend((me) =>
		me.account().announcementImage({ announcementId: params.id })
	);

	return new Response(
		Uint8Array.from(atob(image.data), (char) => char.charCodeAt(0)),
		{
			headers: {
				'content-type': image.type,
				'cache-control': 'private, max-age=31536000, immutable',
				'x-content-type-options': 'nosniff'
			}
		}
	);
};
