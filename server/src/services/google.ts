import { OAuth2Client } from 'google-auth-library';
import { drive as driveApi, type drive_v3 } from '@googleapis/drive';
import { sheets as sheetsApi } from '@googleapis/sheets';
import { eq } from 'drizzle-orm';
import { env } from '../env.js';
import { HttpError } from '../lib/http.js';
import { encrypt, tryDecrypt } from '../lib/crypto.js';
import { db, schema } from '../db/index.js';
import type { Teacher } from '../db/schema.js';

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  // Read submissions from Drive folders and Form-response sheets the teacher can access.
  'https://www.googleapis.com/auth/drive.readonly',
  // Create the exported results spreadsheet (only files created by GradeLens).
  'https://www.googleapis.com/auth/drive.file',
];

export const REDIRECT_PATH = '/api/auth/google/callback';

export function oauthClient() {
  if (!env.googleConfigured) {
    throw new HttpError(503, 'Google sign-in is not configured on the server yet.', 'GOOGLE_NOT_CONFIGURED');
  }
  return new OAuth2Client({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: `${env.PUBLIC_API_URL.replace(/\/$/, '')}${REDIRECT_PATH}`,
  });
}

export function buildAuthUrl(state: string, forceConsent: boolean) {
  return oauthClient().generateAuthUrl({
    access_type: 'offline',
    scope: GOOGLE_SCOPES,
    include_granted_scopes: true,
    prompt: forceConsent ? 'consent' : 'select_account',
    state,
  });
}

export type GoogleIdentity = {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  refreshToken?: string | null;
  scopes?: string;
};

export async function exchangeCode(code: string): Promise<GoogleIdentity> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.id_token) throw new HttpError(400, 'Google did not return an identity token', 'GOOGLE_AUTH');
  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) throw new HttpError(400, 'Google account has no email', 'GOOGLE_AUTH');
  if (payload.email_verified === false) throw new HttpError(403, 'Google email is not verified', 'GOOGLE_AUTH');
  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name ?? payload.email.split('@')[0],
    picture: payload.picture,
    refreshToken: tokens.refresh_token,
    scopes: tokens.scope,
  };
}

/** Returns an authorised OAuth client acting as the teacher (uses the stored refresh token). */
export function clientForTeacher(teacher: Pick<Teacher, 'id' | 'googleRefreshTokenEnc'>) {
  if (!teacher.googleRefreshTokenEnc) {
    throw new HttpError(401, 'Please sign in with Google again to grant Drive access.', 'GOOGLE_REAUTH');
  }
  const refreshToken = tryDecrypt(teacher.googleRefreshTokenEnc);
  if (!refreshToken) {
    // Stored with an older TOKEN_ENCRYPTION_KEY: drop it so the next sign-in asks Google for a fresh one.
    db.update(schema.teachers).set({ googleRefreshTokenEnc: null }).where(eq(schema.teachers.id, teacher.id)).catch(() => undefined);
    throw new HttpError(401, 'Please sign in with Google again to grant Drive access.', 'GOOGLE_REAUTH');
  }
  const client = oauthClient();
  client.setCredentials({ refresh_token: refreshToken });
  client.on('tokens', (t) => {
    // Google can rotate refresh tokens; keep the newest one.
    if (t.refresh_token) {
      db.update(schema.teachers)
        .set({ googleRefreshTokenEnc: encrypt(t.refresh_token) })
        .where(eq(schema.teachers.id, teacher.id))
        .catch(() => undefined);
    }
  });
  return client;
}

export async function revokeTeacherToken(teacher: Pick<Teacher, 'googleRefreshTokenEnc'>) {
  if (!teacher.googleRefreshTokenEnc || !env.googleConfigured) return;
  try {
    const t = tryDecrypt(teacher.googleRefreshTokenEnc);
    if (t) await oauthClient().revokeToken(t);
  } catch {
    /* token may already be revoked */
  }
}

/** Converts Google API failures into friendly, typed errors. */
export function googleError(err: unknown, context = 'this link'): HttpError {
  if (err instanceof HttpError) return err;
  const e = err as { code?: number | string; status?: number; message?: string; response?: { status?: number; data?: { error?: string } } };
  const status = Number(e.status ?? e.response?.status ?? e.code);
  const msg = `${e.message ?? ''} ${e.response?.data?.error ?? ''}`;
  if (/invalid_grant|unauthorized_client|invalid_client/.test(msg) || status === 401) {
    return new HttpError(401, 'Your Google access has expired. Please sign in again.', 'GOOGLE_REAUTH');
  }
  if (status === 403 && /has not been used|is disabled|accessNotConfigured/i.test(msg)) {
    return new HttpError(503, 'Google Drive/Sheets API is not enabled for this project.', 'GOOGLE_API_DISABLED');
  }
  if (status === 403 && /insufficient|scope/i.test(msg)) {
    return new HttpError(401, 'Drive permission was not granted. Please sign in again and allow Drive access.', 'GOOGLE_REAUTH');
  }
  if (status === 403 || status === 404) {
    return new HttpError(400, `Unable to access ${context}. Please share it with your Google account.`, 'SOURCE_ACCESS');
  }
  if (status === 429) return new HttpError(429, 'Google is rate-limiting requests. Please retry in a minute.', 'GOOGLE_RATE_LIMIT');
  console.error('[google]', err);
  return new HttpError(502, 'Google Drive request failed. Please try again.', 'GOOGLE_ERROR');
}

// ---------- Link parsing ----------

export function parseDriveFolderId(input: string): string | null {
  const s = input.trim();
  const m = s.match(/\/folders\/([a-zA-Z0-9_-]{10,})/) ?? s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
  return null;
}

export function parseSpreadsheet(input: string): { id: string; gid: number | null } | null {
  const s = input.trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{10,})/);
  const id = m?.[1] ?? (/^[a-zA-Z0-9_-]{30,}$/.test(s) ? s : null);
  if (!id) return null;
  const g = s.match(/[#&?]gid=(\d+)/);
  return { id, gid: g ? Number(g[1]) : null };
}

/** Extracts every Drive file id from a cell (Form uploads store comma-separated links). */
export function extractDriveFileIds(cell: string): string[] {
  const ids = new Set<string>();
  const re = /(?:\/file\/d\/|[?&]id=|\/document\/d\/|\/presentation\/d\/)([a-zA-Z0-9_-]{10,})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cell))) ids.add(m[1]);
  return [...ids];
}

// ---------- Drive ----------

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string | null;
  modifiedTime: string | null;
  size: number | null;
  folderId: string;
  folderName: string;
  depth: number;
  /** First-level sub-folder under the submission folder (one folder per student), if any. */
  topFolderId: string | null;
  topFolderName: string | null;
};

const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const SUPPORTED_MIME = /^(image\/(jpeg|png|webp|heic|heif|gif)|application\/pdf|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|application\/vnd\.google-apps\.document|text\/plain)$/;

function driveClient(auth: OAuth2Client) {
  return driveApi({ version: 'v3', auth });
}

export async function getDriveItem(auth: OAuth2Client, id: string) {
  try {
    const res = await driveClient(auth).files.get({
      fileId: id,
      fields: 'id,name,mimeType,createdTime,modifiedTime,size,trashed',
      supportsAllDrives: true,
    });
    return res.data;
  } catch (err) {
    throw googleError(err, 'this Drive item');
  }
}

/** Lists submission files in a folder, descending into student sub-folders (max 2 levels). */
export async function listFolderFiles(auth: OAuth2Client, folderId: string, maxDepth = 2): Promise<DriveFile[]> {
  const drive = driveClient(auth);
  const out: DriveFile[] = [];
  const root = await getDriveItem(auth, folderId);
  if (root.mimeType !== FOLDER_MIME) {
    throw new HttpError(400, 'This link is not a Google Drive folder.', 'SOURCE_INVALID');
  }
  type Q = { id: string; name: string; depth: number; top: { id: string; name: string } | null };
  const queue: Q[] = [{ id: folderId, name: root.name ?? '', depth: 0, top: null }];
  while (queue.length) {
    const folder = queue.shift()!;
    let pageToken: string | undefined;
    do {
      let res: { data: drive_v3.Schema$FileList };
      try {
        res = await drive.files.list({
          q: `'${folder.id}' in parents and trashed = false`,
          fields: 'nextPageToken, files(id,name,mimeType,createdTime,modifiedTime,size,shortcutDetails)',
          pageSize: 1000,
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });
      } catch (err) {
        throw googleError(err, 'this Drive folder');
      }
      for (const f of res.data.files ?? []) {
        let id = f.id!;
        let mimeType = f.mimeType ?? '';
        if (mimeType === 'application/vnd.google-apps.shortcut' && f.shortcutDetails?.targetId) {
          id = f.shortcutDetails.targetId;
          mimeType = f.shortcutDetails.targetMimeType ?? '';
        }
        if (mimeType === FOLDER_MIME) {
          if (folder.depth + 1 <= maxDepth) {
            const name = f.name ?? '';
            queue.push({ id, name, depth: folder.depth + 1, top: folder.top ?? { id, name } });
          }
          continue;
        }
        out.push({
          id,
          name: f.name ?? 'Untitled',
          mimeType,
          createdTime: f.createdTime ?? null,
          modifiedTime: f.modifiedTime ?? null,
          size: f.size ? Number(f.size) : null,
          folderId: folder.id,
          folderName: folder.name,
          depth: folder.depth,
          topFolderId: folder.top?.id ?? null,
          topFolderName: folder.top?.name ?? null,
        });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  }
  return out;
}

export async function downloadFile(auth: OAuth2Client, file: { id: string; mimeType: string }): Promise<{ data: Buffer; mimeType: string }> {
  const drive = driveClient(auth);
  try {
    if (file.mimeType === 'application/vnd.google-apps.document') {
      const res = await drive.files.export({ fileId: file.id, mimeType: 'application/pdf' }, { responseType: 'arraybuffer' });
      return { data: Buffer.from(res.data as ArrayBuffer), mimeType: 'application/pdf' };
    }
    const res = await drive.files.get(
      { fileId: file.id, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' },
    );
    return { data: Buffer.from(res.data as unknown as ArrayBuffer), mimeType: file.mimeType };
  } catch (err) {
    throw googleError(err, 'a submission file');
  }
}

// ---------- Sheets ----------

export async function readSheet(auth: OAuth2Client, spreadsheetId: string, gid: number | null) {
  const api = sheetsApi({ version: 'v4', auth });
  try {
    const meta = await api.spreadsheets.get({ spreadsheetId, fields: 'properties.title,sheets.properties' });
    const tabs = meta.data.sheets ?? [];
    const tab = (gid !== null ? tabs.find((s) => s.properties?.sheetId === gid) : null) ?? tabs[0];
    const tabTitle = tab?.properties?.title ?? 'Sheet1';
    const values = await api.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabTitle.replace(/'/g, "''")}'`,
      valueRenderOption: 'FORMATTED_VALUE',
    });
    const rows = (values.data.values ?? []).map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c))));
    return { title: meta.data.properties?.title ?? 'Spreadsheet', tab: tabTitle, rows };
  } catch (err) {
    throw googleError(err, 'this Google Sheet');
  }
}

export async function createSpreadsheet(
  auth: OAuth2Client,
  title: string,
  tabs: { title: string; rows: (string | number | null)[][] }[],
): Promise<string> {
  const api = sheetsApi({ version: 'v4', auth });
  try {
    const created = await api.spreadsheets.create({
      requestBody: {
        properties: { title },
        sheets: tabs.map((t, i) => ({ properties: { title: t.title, sheetId: i, gridProperties: { frozenRowCount: 1 } } })),
      },
    });
    const id = created.data.spreadsheetId!;
    await api.spreadsheets.values.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        valueInputOption: 'RAW',
        data: tabs.map((t) => ({ range: `'${t.title}'!A1`, values: t.rows.map((r) => r.map((c) => (c === null ? '' : c))) })),
      },
    });
    await api.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: tabs.flatMap((_, i) => [
          {
            repeatCell: {
              range: { sheetId: i, startRowIndex: 0, endRowIndex: 1 },
              cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.91, green: 0.93, blue: 0.96 } } },
              fields: 'userEnteredFormat(textFormat,backgroundColor)',
            },
          },
          { autoResizeDimensions: { dimensions: { sheetId: i, dimension: 'COLUMNS', startIndex: 0, endIndex: 30 } } },
        ]),
      },
    });
    return created.data.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${id}/edit`;
  } catch (err) {
    throw googleError(err, 'Google Sheets');
  }
}
