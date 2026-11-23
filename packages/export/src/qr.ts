import qrcode from 'qrcode';
import jsqr from 'jsqr';

const digestPrefixLength = 16;

export interface ReceiptLookup {
  receiptId: string;
  keyId: string;
  receiptDigestPrefix: string;
}

function parseLookup(value: unknown): ReceiptLookup | undefined {
  if (value === null || typeof value !== 'object' || Object.keys(value).length !== 3) return undefined;
  const lookup = value as Partial<ReceiptLookup>;
  if (typeof lookup.receiptId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(lookup.receiptId)
    || typeof lookup.keyId !== 'string' || !/^[a-f0-9]{64}$/.test(lookup.keyId)
    || typeof lookup.receiptDigestPrefix !== 'string' || !/^[a-f0-9]{16}$/.test(lookup.receiptDigestPrefix)) {
    return undefined;
  }
  return {
    receiptId: lookup.receiptId,
    keyId: lookup.keyId,
    receiptDigestPrefix: lookup.receiptDigestPrefix,
  };
}

export function encodeReceiptQr(receiptId: string, keyId: string, receiptDigest: string): Promise<string> {
  const lookup = parseLookup({ receiptId, keyId, receiptDigestPrefix: receiptDigest.slice(0, digestPrefixLength) });
  if (!lookup || !/^[a-f0-9]{64}$/.test(receiptDigest)) throw new Error('Invalid receipt lookup values');
  return qrcode.toDataURL(JSON.stringify(lookup), { errorCorrectionLevel: 'M', width: 320 });
}

/** Decode the RGBA pixel buffer supplied by a canvas or image decoder. */
export function decodeReceiptQr(image: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}): ReceiptLookup | undefined {
  const { data, width, height } = image;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
    || data.length !== width * height * 4) return undefined;
  const code = jsqr(data, width, height);
  if (!code) return undefined;
  try {
    return parseLookup(JSON.parse(code.data));
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}
