import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';

const pageText = [
  'Fictional intake fixture. The example concerns section 379 IPC.',
  'Fictional second page. Bail was granted on 14.03.2025.',
];

function stream(data: Buffer | string, entries = ''): Buffer {
  return Buffer.concat([Buffer.from('<< /Length ' + Buffer.byteLength(data) + ' ' + entries + ' >>\nstream\n'),
    Buffer.from(data), Buffer.from('\nendstream')]);
}

export function fictionalOrderPdf(scan?: Buffer): Buffer {
  const objects: (string | Buffer)[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 180] /Contents 4 0 R /Resources << /Font << /F1 7 0 R >> >> >>',
    stream('BT /F1 12 Tf 28 116 Td (' + pageText[0] + ') Tj ET'),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 180] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >>'
      + (scan ? ' /XObject << /Im1 8 0 R >>' : '') + ' >> >>',
    scan ? stream('q 500 0 0 180 0 0 cm /Im1 Do Q') : stream('BT /F1 12 Tf 28 116 Td (' + pageText[1] + ') Tj ET'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  if (scan) objects.push(stream(scan, '/Type /XObject /Subtype /Image /Width 1000 /Height 360 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode'));

  let size = 0;
  const chunks: Buffer[] = [];
  const offsets: number[] = [];
  const append = (part: string | Buffer) => {
    const buffer = Buffer.from(part);
    chunks.push(buffer);
    size += buffer.length;
  };
  append('%PDF-1.4\n');
  for (const [index, object] of objects.entries()) {
    offsets.push(size);
    append((index + 1) + ' 0 obj\n');
    append(object);
    append('\nendobj\n');
  }
  const xref = size;
  append('xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n');
  for (const offset of offsets) append(String(offset).padStart(10, '0') + ' 00000 n \n');
  append('trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  return Buffer.concat(chunks);
}

export function fictionalBilingualImage() {
  const font = fileURLToPath(new URL('./fonts/NotoSansDevanagari-Regular.ttf', import.meta.url));
  if (!GlobalFonts.registerFromPath(font, 'Intake Hindi Fixture')) throw new Error('Could not register the test font');
  const canvas = createCanvas(1000, 360);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, 1000, 360);
  ctx.fillStyle = 'black';
  ctx.font = '50px sans-serif';
  ctx.fillText('Fictional test sentence.', 70, 132);
  ctx.font = '54px "Intake Hindi Fixture"';
  ctx.fillText('यह एक काल्पनिक वाक्य है।', 70, 235);
  return canvas;
}
