import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pLimit from 'p-limit';
import { drive as driveApi } from '@googleapis/drive';
import type { OAuth2Client } from 'google-auth-library';
import { HttpError } from '../lib/http.js';
import type { FileRef } from '../db/schema.js';
import {
  SUPPORTED_MIME,
  downloadFile,
  extractDriveFileIds,
  getDriveItem,
  listFolderFiles,
  parseDriveFolderId,
  parseSpreadsheet,
  readSheet,
} from './google.js';
import { detectSheetLayout, groupFolderFiles, groupSheetRows, type RosterEntry, type SourceFile } from './matching.js';
import { prepareFile, MAX_PAGES_PER_SUBMISSION } from './images.js';
import { rowsToRoster } from './roster.js';
import { renderDemoPage } from './demo.js';

export type SourceType = 'DRIVE_FOLDER' | 'GOOGLE_SHEET';

export function parseSource(type: SourceType, url: string): string {
  if (type === 'DRIVE_FOLDER') {
    const id = parseDriveFolderId(url);
    if (!id) throw new HttpError(400, 'This does not look like a Google Drive folder link.', 'SOURCE_INVALID');
    return id;
  }
  const sheet = parseSpreadsheet(url);
  if (!sheet) throw new HttpError(400, 'This does not look like a Google Sheets link.', 'SOURCE_INVALID');
  return sheet.id;
}

const isSupported = (f: { mimeType: string; name: string }) =>
  SUPPORTED_MIME.test(f.mimeType) || /\.(jpe?g|png|webp|heic|heif|pdf|docx|txt)$/i.test(f.name);

/** Quick check used by "Verify Link": can we open it, and how many submissions does it hold? */
export async function verifySource(auth: OAuth2Client, type: SourceType, url: string) {
  if (type === 'DRIVE_FOLDER') {
    const id = parseSource(type, url);
    const files = (await listFolderFiles(auth, id)).filter(isSupported);
    const meta = await getDriveItem(auth, id);
    return { ok: true, sourceId: id, name: meta.name ?? 'Folder', fileCount: files.length, kind: 'folder' as const };
  }
  const sheet = parseSpreadsheet(url);
  if (!sheet) throw new HttpError(400, 'This does not look like a Google Sheets link.', 'SOURCE_INVALID');
  const { title, rows } = await readSheet(auth, sheet.id, sheet.gid);
  const layout = detectSheetLayout(rows);
  const responses = layout ? rows.slice(1).filter((r) => layout.fileCols.some((c) => /google\.com/.test(r[c] ?? ''))).length : 0;
  return {
    ok: true,
    sourceId: sheet.id,
    name: title,
    fileCount: responses,
    kind: layout ? ('responses' as const) : ('sheet' as const),
    warning: layout ? undefined : 'No file-upload column was found in this sheet. Use a Google Form responses sheet with an upload question.',
  };
}

export async function rosterFromSheet(auth: OAuth2Client, url: string) {
  const sheet = parseSpreadsheet(url);
  if (!sheet) throw new HttpError(400, 'This does not look like a Google Sheets link.', 'SOURCE_INVALID');
  const { rows } = await readSheet(auth, sheet.id, sheet.gid);
  return rowsToRoster(rows);
}

export type ScannedGroup = {
  groupKey: string;
  label: string;
  studentId: string | null;
  files: FileRef[];
  submittedAt: string | null;
};

const toRef = (f: SourceFile): FileRef => ({
  id: f.id,
  name: f.name,
  mimeType: f.mimeType,
  createdTime: f.createdTime,
  modifiedTime: f.modifiedTime,
  size: f.size,
});

/** Lists the source and returns one group per student submission. */
export async function scanSource(
  auth: OAuth2Client,
  type: SourceType,
  url: string,
  roster: RosterEntry[],
): Promise<{ groups: ScannedGroup[]; skippedFiles: number }> {
  if (type === 'DRIVE_FOLDER') {
    const id = parseSource(type, url);
    const all = await listFolderFiles(auth, id);
    const files = all.filter(isSupported);
    const groups = groupFolderFiles(files, roster).map((g) => ({ ...g, files: g.files.map(toRef) }));
    return { groups, skippedFiles: all.length - files.length };
  }

  const sheet = parseSpreadsheet(url);
  if (!sheet) throw new HttpError(400, 'This does not look like a Google Sheets link.', 'SOURCE_INVALID');
  const { rows } = await readSheet(auth, sheet.id, sheet.gid);
  const layout = detectSheetLayout(rows);
  if (!layout) {
    throw new HttpError(
      400,
      'No file-upload column was found in this sheet. Link the Google Form responses sheet that contains the uploaded files.',
      'SOURCE_INVALID',
    );
  }
  const rowGroups = groupSheetRows(rows, layout, roster, extractDriveFileIds);
  const limit = pLimit(8);
  let skipped = 0;
  const groups = await Promise.all(
    rowGroups.map(async (g) => {
      const metas = await Promise.all(
        g.fileIds.map((fid) =>
          limit(async () => {
            try {
              const m = await getDriveItem(auth, fid);
              if (m.trashed || !isSupported({ mimeType: m.mimeType ?? '', name: m.name ?? '' })) {
                skipped++;
                return null;
              }
              const ref: FileRef = {
                id: m.id!,
                name: m.name ?? 'file',
                mimeType: m.mimeType ?? 'application/octet-stream',
                createdTime: m.createdTime ?? null,
                modifiedTime: m.modifiedTime ?? null,
                size: m.size ? Number(m.size) : null,
              };
              return ref;
            } catch {
              skipped++;
              return null;
            }
          }),
        ),
      );
      const files = metas.filter((m): m is FileRef => m !== null);
      return { groupKey: g.groupKey, label: g.label, studentId: g.studentId, files, submittedAt: g.submittedAt ?? files.map((f) => f.createdTime).filter(Boolean).sort().at(-1) ?? null };
    }),
  );
  return { groups: groups.filter((g) => g.files.length > 0), skippedFiles: skipped };
}

// ---------- Downloading & page cache ----------

const CACHE_DIR = path.join(os.tmpdir(), 'gradelens-cache');
const keyFor = (f: FileRef) =>
  createHash('sha1')
    .update(`${f.id}:${f.modifiedTime ?? ''}:${f.size ?? ''}`)
    .digest('hex');

async function readCache(key: string): Promise<{ pages: Buffer[]; text: string } | null> {
  try {
    const dir = path.join(CACHE_DIR, key);
    const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8')) as { count: number; text: string };
    const pages = await Promise.all(Array.from({ length: meta.count }, (_, i) => fs.readFile(path.join(dir, `${i}.jpg`))));
    return { pages, text: meta.text };
  } catch {
    return null;
  }
}

async function writeCache(key: string, data: { pages: Buffer[]; text: string }) {
  try {
    const dir = path.join(CACHE_DIR, key);
    await fs.mkdir(dir, { recursive: true });
    await Promise.all(data.pages.map((p, i) => fs.writeFile(path.join(dir, `${i}.jpg`), p)));
    await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ count: data.pages.length, text: data.text }));
  } catch {
    /* cache is best-effort */
  }
}

/** Removes cached pages older than `maxAgeHours`. */
export async function pruneCache(maxAgeHours = 72) {
  try {
    const entries = await fs.readdir(CACHE_DIR);
    const cutoff = Date.now() - maxAgeHours * 3600_000;
    await Promise.all(
      entries.map(async (e) => {
        const p = path.join(CACHE_DIR, e);
        const st = await fs.stat(p);
        if (st.mtimeMs < cutoff) await fs.rm(p, { recursive: true, force: true });
      }),
    );
  } catch {
    /* nothing cached yet */
  }
}

/** Some phones upload HEIC which the image library may not decode: fall back to Drive's JPEG rendition. */
async function driveJpegRendition(auth: OAuth2Client, fileId: string): Promise<Buffer | null> {
  try {
    const res = await driveApi({ version: 'v3', auth }).files.get({ fileId, fields: 'thumbnailLink', supportsAllDrives: true });
    const link = res.data.thumbnailLink;
    if (!link) return null;
    const big = link.replace(/=s\d+$/, '=s1800');
    const img = await auth.request<ArrayBuffer>({ url: big, responseType: 'arraybuffer' });
    return Buffer.from(img.data);
  } catch {
    return null;
  }
}

export type PreparedSubmission = { pages: Buffer[]; text: string; notes: string[] };

/** Downloads every file of a submission and converts it into page images / text (cached on disk). */
export async function prepareSubmission(auth: OAuth2Client | (() => OAuth2Client), files: FileRef[]): Promise<PreparedSubmission> {
  const getAuth = typeof auth === 'function' ? auth : () => auth;
  const pages: Buffer[] = [];
  const texts: string[] = [];
  const notes: string[] = [];
  for (const f of files) {
    if (pages.length >= MAX_PAGES_PER_SUBMISSION) {
      notes.push(`Only the first ${MAX_PAGES_PER_SUBMISSION} pages were evaluated.`);
      break;
    }
    if (f.id.startsWith('demo:')) {
      pages.push(await renderDemoPage(f));
      continue;
    }
    const key = keyFor(f);
    let prepared = await readCache(key);
    if (!prepared) {
      const auth = getAuth();
      const { data, mimeType } = await downloadFile(auth, f);
      try {
        const out = await prepareFile(data, mimeType, f.name);
        notes.push(...out.notes);
        prepared = { pages: out.pages, text: out.text };
      } catch (err) {
        const fallback = mimeType.startsWith('image/') ? await driveJpegRendition(auth, f.id) : null;
        if (!fallback) {
          notes.push(`${f.name}: could not be read (${(err as Error).message.slice(0, 80)}).`);
          continue;
        }
        const out = await prepareFile(fallback, 'image/jpeg', `${f.name}.jpg`);
        prepared = { pages: out.pages, text: out.text };
      }
      await writeCache(key, prepared);
    }
    pages.push(...prepared.pages.slice(0, MAX_PAGES_PER_SUBMISSION - pages.length));
    if (prepared.text) texts.push(prepared.text);
  }
  return { pages, text: texts.join('\n\n'), notes };
}
