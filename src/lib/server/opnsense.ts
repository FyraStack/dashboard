import { getRuntimeEnv } from '$lib/server/env';

type OpnsenseMethod = 'GET' | 'POST';

type CreateVMIPMappingParams = {
	macAddress: string;
	ipAddresses: string[];
};

export class OpnsenseError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly details: unknown
	) {
		let details_string;
		try {
			details_string = JSON.stringify(details);
		} catch {
			details_string = 'Unable to stringify details';
		}

		super(`${message} - ${status} - ${details_string}`);
		this.name = 'OpnsenseError';
	}
}

function getOpnsenseConfig() {
	const env = getRuntimeEnv();
	if (!env.OPNSENSE_API_KEY || !env.OPNSENSE_API_SECRET || !env.OPNSENSE_API_URL) return null;

  return {
    apiKey: env.OPNSENSE_API_KEY,
    apiSecret: env.OPNSENSE_API_SECRET,
		apiUrl: env.OPNSENSE_API_URL.replace(/\/+$/, ''),
	};
}

async function parseResponse(response: Response) {
	const text = await response.text();
	if (!text) return null;

	try {
		return JSON.parse(text) as unknown;
	} catch {
		return text;
	}
}

async function opnsenseRequest<T>(route: string, method: OpnsenseMethod, data?: unknown): Promise<T | null> {
	const config = getOpnsenseConfig();
	if (!config) return null;

	const response = await fetch(`${config.apiUrl}${route}`, {
		headers: {
			'Authorization': 'Basic ' + Buffer.from(config.apiKey + ":" + config.apiSecret).toString('base64'),
      'Content-Type': 'application/json',
			'Accept': 'application/json, text/javascript',
		},
		method,
		...(data === undefined ? {} : { body: JSON.stringify(data) })
	});

	const body = await parseResponse(response);
	if (!response.ok) {
		console.error(data);
		throw new OpnsenseError(`Opnsense ${method} ${route} failed`, response.status, body);
	}

	return body as T;
}

async function createVMToIPMapping({
	macAddress,
	ipAddresses
}: CreateVMIPMappingParams) {
  const res = await opnsenseRequest(
    "https://localhost:10443/api/kea/dhcpv4/add_reservation/",
    "POST",
    {
      reservation: {
        subnet: '3d03f1af-47b0-4e66-9b4b-feac33351ce0',
        ip_address: '192.168.0.51',
        hw_address: 'AA:BB:CC:DD:EE:F1',
        hostname: '',
        description: ''
      }
    }
  )
}
