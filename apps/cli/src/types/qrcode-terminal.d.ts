export interface QrcodeTerminalOptions {
  readonly small?: boolean;
}

export type QrcodeTerminalCallback = (qr: string) => void;

interface QrcodeTerminal {
  generate(input: string, callback: QrcodeTerminalCallback): void;
  generate(input: string, options: QrcodeTerminalOptions, callback: QrcodeTerminalCallback): void;
}

declare const qrcode: QrcodeTerminal;
export default qrcode;
