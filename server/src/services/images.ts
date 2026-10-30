import sharp from 'sharp';
import mammoth from 'mammoth';

export const MAX_LONG_EDGE = 1800; // keeps handwriting legible while staying cheap for vision models
export const MAX_PAGES_PER_SUBMISSION = 12;

export type PreparedContent = {
  pages: Buffer[]; // JPEG page images
  text: string; // extracted text for typed documents (DOCX / TXT)
  notes: string[];
};

let mupdfMod: typeof import('mupdf') | null = null;
async function mupdf() {
  mupdfMod ??= await import('mupdf');
  return mupdfMod;
}

/** Straightens (EXIF), downsizes and contrast-normalises a photo of a page. */
export async function enhancePage(input: Buffer): Promise<Buffer> {
  return sharp(input, { failOn: 'none' })
    .rotate()
    .resize({ width: MAX_LONG_EDGE, height: MAX_LONG_EDGE, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .normalise({ lower: 1, upper: 99 })
    .sharpen({ sigma: 0.6 })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}

export async function renderPdf(input: Buffer, maxPages = MAX_PAGES_PER_SUBMISSION): Promise<{ pages: Buffer[]; total: number }> {
  const m = await mupdf();
  const doc = m.Document.openDocument(input, 'application/pdf');
  const total = doc.countPages();
  const pages: Buffer[] = [];
  try {
    for (let i = 0; i < Math.min(total, maxPages); i++) {
      const page = doc.loadPage(i);
      const [x0, y0, x1, y1] = page.getBounds();
      const longEdge = Math.max(x1 - x0, y1 - y0) || 842;
      const scale = Math.min(3, MAX_LONG_EDGE / longEdge);
      const pix = page.toPixmap(m.Matrix.scale(scale, scale), m.ColorSpace.DeviceRGB, false, true);
      const png = Buffer.from(pix.asPNG());
      pix.destroy();
      page.destroy();
      pages.push(await enhancePage(png));
    }
  } finally {
    doc.destroy();
  }
  return { pages, total };
}

/** Converts any supported submission file into page images and/or text. */
export async function prepareFile(data: Buffer, mimeType: string, name: string): Promise<PreparedContent> {
  const notes: string[] = [];
  const lower = name.toLowerCase();
  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) {
    const { pages, total } = await renderPdf(data);
    if (total > pages.length) notes.push(`${name}: only the first ${pages.length} of ${total} pages were evaluated.`);
    return { pages, text: '', notes };
  }
  if (mimeType.includes('wordprocessingml') || lower.endsWith('.docx')) {
    const { value } = await mammoth.extractRawText({ buffer: data });
    return { pages: [], text: value.trim(), notes };
  }
  if (mimeType.startsWith('text/') || lower.endsWith('.txt')) {
    return { pages: [], text: data.toString('utf8').trim(), notes };
  }
  if (mimeType.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|gif|tiff?)$/.test(lower)) {
    return { pages: [await enhancePage(data)], text: '', notes };
  }
  notes.push(`${name}: unsupported file type (${mimeType}) was skipped.`);
  return { pages: [], text: '', notes };
}

const FP_W = 48;
const FP_H = 64;

/**
 * Page fingerprint = 64-bit difference hash + a 48x64 signed horizontal-gradient signature.
 * Horizontal gradients ignore ruled notebook lines and lighting, so the signature follows the
 * actual pen strokes: re-uploads of the same photo/scan correlate strongly, different pages don't.
 */
export async function fingerprint(image: Buffer): Promise<string> {
  const base = sharp(image).rotate().grayscale().normalise();
  const { data: small } = await base.clone().resize(9, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += small[y * 9 + x] > small[y * 9 + x + 1] ? '1' : '0';
  const hash = BigInt('0b' + bits).toString(16).padStart(16, '0');

  const W = FP_W + 1;
  const { data } = await base.clone().resize(W, FP_H, { fit: 'fill', kernel: 'cubic' }).raw().toBuffer({ resolveWithObject: true });
  const grad = new Int8Array(FP_W * FP_H);
  for (let y = 0; y < FP_H; y++) {
    for (let x = 0; x < FP_W; x++) {
      const v = data[y * W + x + 1] - data[y * W + x];
      grad[y * FP_W + x] = Math.max(-127, Math.min(127, v));
    }
  }
  return `${hash}|${Buffer.from(grad.buffer).toString('base64')}`;
}

export function hamming(a: string, b: string): number {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let count = 0;
  while (x) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

function pearson(a: Int8Array, b: Int8Array): number {
  const n = Math.min(a.length, b.length);
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  if (!da || !db) return 0;
  return num / Math.sqrt(da * db);
}

/** 0..1 visual similarity between two page fingerprints. */
export function pageSimilarity(fpA: string, fpB: string): number {
  const [ha, va] = fpA.split('|');
  const [hb, vb] = fpB.split('|');
  if (!va || !vb) return 1 - hamming(ha, hb) / 64;
  const a = new Int8Array(Buffer.from(va, 'base64'));
  const b = new Int8Array(Buffer.from(vb, 'base64'));
  return Math.max(0, pearson(a, b));
}

/** Small preview used in the app's submission viewer. */
export async function thumbnail(image: Buffer, width = 480): Promise<Buffer> {
  return sharp(image).resize({ width, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
}
