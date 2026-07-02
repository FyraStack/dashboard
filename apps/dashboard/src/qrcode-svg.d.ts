declare module 'qrcode-svg' {
	interface QRCodeOptions {
		content: string;
		width?: number;
		height?: number;
		padding?: number;
		color?: string;
		background?: string;
		ecl?: string;
	}
	class QRCode {
		constructor(options: QRCodeOptions);
		svg(): string;
	}
	export default QRCode;
}
