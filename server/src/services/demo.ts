import sharp from 'sharp';
import type { FileRef } from '../db/schema.js';

const LINES = [
  'Q1. Merge sort is a divide and conquer algorithm.',
  'It divides the array into two halves, sorts each half',
  'recursively and then merges the two sorted halves.',
  'Example: [38, 27, 43, 3] -> [38, 27] [43, 3]',
  '-> [27, 38] [3, 43] -> [3, 27, 38, 43]',
  'Recurrence: T(n) = 2T(n/2) + O(n) = O(n log n)',
  'Q2. Worst case of quick sort occurs when the pivot',
  'is always the smallest or largest element.',
  'T(n) = T(n-1) + O(n) = O(n^2)',
];

/** Synthetic "handwritten" page for demo data created by scripts/seed-demo.ts (never used for real files). */
export async function renderDemoPage(file: FileRef): Promise<Buffer> {
  const seed = [...file.id].reduce((s, c) => s + c.charCodeAt(0), 0);
  const tilt = ((seed % 7) - 3) * 0.4;
  const ink = seed % 2 ? '#1d3b8f' : '#1b1b1b';
  const lines = LINES.map((l, i) => `<text x="${70 + (seed % 9)}" y="${170 + i * 64}" transform="rotate(${tilt} 600 800)">${l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</text>`).join('');
  const rules = Array.from({ length: 22 }, (_, i) => `<line x1="40" x2="1160" y1="${190 + i * 64}" y2="${190 + i * 64}" stroke="#c9d6ea" stroke-width="2"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600">
  <rect width="1200" height="1600" fill="#fbfaf6"/>
  ${rules}
  <line x1="110" x2="110" y1="0" y2="1600" stroke="#f2b8b8" stroke-width="2"/>
  <text x="70" y="90" font-family="'Comic Sans MS','Segoe Print','Bradley Hand',cursive" font-size="34" fill="${ink}">${file.name.replace(/\.[a-z]+$/i, '').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>
  <g font-family="'Comic Sans MS','Segoe Print','Bradley Hand',cursive" font-size="34" fill="${ink}">${lines}</g>
</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
}
