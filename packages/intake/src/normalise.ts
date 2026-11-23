/** Preserve page and paragraph boundaries while repairing PDF text-layer line breaks. */
export function normaliseOrderText(text: string): string {
  return text.split('\f').map(page => page.replace(/\r\n?/gu, '\n')
    .replace(/([\p{L}\p{M}])[-‐‑]\n[ \t]*([\p{L}\p{M}])/gu, '$1$2')
    .replace(/([\p{Ll}])\n[ \t]*(?=[\p{Ll}])/gu, '$1 ')
    .replace(/[ \t]{2,}/gu, ' ')).join('\f');
}
