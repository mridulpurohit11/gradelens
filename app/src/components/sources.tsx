import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { api, errorMessage } from '@/lib/api';
import type { RosterStudent, SourceType } from '@/lib/types';
import { Banner, Button, Field, Icon, Input, Segmented, Spinner } from '@/components/ui';

export type VerifyOutcome = { message: string; warning?: string };

/** Client-side check of a submission link. Returns an error message, or null when the link looks valid. */
export function sourceLinkError(type: SourceType, url: string): string | null {
  const s = url.trim();
  if (!s) return type === 'DRIVE_FOLDER' ? 'Google Drive folder link is required' : 'Google Sheet link is required';
  if (type === 'DRIVE_FOLDER') {
    if (/docs\.google\.com\/spreadsheets/.test(s)) return 'This is a Google Sheet link. Switch to "Google Sheet" above, or paste a Drive folder link.';
    if (/drive\.google\.com\/file\//.test(s)) return 'This is a link to a single file. Paste the link of the folder that contains the submissions.';
    if (!/\/folders\/[a-zA-Z0-9_-]{10,}/.test(s) && !/[?&]id=[a-zA-Z0-9_-]{10,}/.test(s)) return 'Enter a valid Google Drive folder link (https://drive.google.com/drive/folders/…)';
    return null;
  }
  if (/drive\.google\.com\/drive\/folders/.test(s)) return 'This is a Drive folder link. Switch to "Google Drive Folder" above, or paste a Google Sheet link.';
  if (!/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9_-]{10,}/.test(s)) return 'Enter a valid Google Sheet link (https://docs.google.com/spreadsheets/d/…)';
  return null;
}

export async function verifyLink(type: SourceType, url: string): Promise<VerifyOutcome> {
  const r = await api<{ fileCount: number; name: string; kind: string; warning?: string }>('/tools/sources/verify', {
    method: 'POST',
    body: { type, url },
  });
  if (type === 'DRIVE_FOLDER') return { message: `Link verified · ${r.fileCount} file${r.fileCount === 1 ? '' : 's'} found in “${r.name}”` };
  return {
    message: r.kind === 'responses' ? `Sheet verified · ${r.fileCount} response${r.fileCount === 1 ? '' : 's'} with uploads` : `Sheet “${r.name}” opened`,
    warning: r.warning,
  };
}

export function SourcePicker({
  type,
  url,
  onChange,
  verify = verifyLink,
  autoVerify,
  error,
}: {
  type: SourceType;
  url: string;
  onChange: (type: SourceType, url: string) => void;
  verify?: (type: SourceType, url: string) => Promise<VerifyOutcome>;
  autoVerify?: boolean;
  /** Validation error shown under the link field (e.g. "required"). */
  error?: string | null;
}) {
  const [state, setState] = useState<{ status: 'idle' | 'busy' | 'ok' | 'error'; message?: string; warning?: string }>({ status: 'idle' });
  const last = useRef('');

  const run = async () => {
    const invalid = sourceLinkError(type, url);
    if (invalid) {
      setState({ status: 'error', message: invalid });
      return;
    }
    setState({ status: 'busy' });
    last.current = `${type}|${url}`;
    try {
      const r = await verify(type, url.trim());
      setState({ status: 'ok', message: r.message, warning: r.warning });
    } catch (e) {
      setState({ status: 'error', message: errorMessage(e) });
    }
  };

  useEffect(() => {
    if (autoVerify && url && last.current !== `${type}|${url}`) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoVerify]);

  return (
    <div className="space-y-4">
      <Segmented
        value={type}
        onChange={(t) => {
          setState({ status: 'idle' });
          onChange(t, url);
        }}
        options={[
          { value: 'DRIVE_FOLDER', label: 'Google Drive Folder', icon: 'folder' },
          { value: 'GOOGLE_SHEET', label: 'Google Sheet', icon: 'table_chart' },
        ]}
      />
      <Field
        label={type === 'DRIVE_FOLDER' ? 'Shared folder link' : 'Form responses sheet link'}
        required
        error={state.status === 'error' ? null : error}
        hint={
          type === 'DRIVE_FOLDER'
            ? 'Students upload into this folder (files named with roll number, or one sub-folder per student).'
            : 'Use the Google Form responses sheet that has a file-upload question.'
        }
      >
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <Input
              value={url}
              onChange={(e) => {
                setState({ status: 'idle' });
                onChange(type, e.target.value);
              }}
              placeholder={type === 'DRIVE_FOLDER' ? 'https://drive.google.com/drive/folders/…' : 'https://docs.google.com/spreadsheets/d/…'}
              invalid={Boolean(error) || state.status === 'error'}
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              trailing={<Icon name="link" className="text-muted" />}
            />
          </div>
          <Button variant="secondary" onClick={run} loading={state.status === 'busy'} className="shrink-0">
            Verify
          </Button>
        </div>
      </Field>
      {state.status === 'ok' ? (
        <Banner tone="success" icon="check_circle">
          <span className="font-semibold text-success">{state.message}</span>
          {state.warning ? <span className="mt-1 block text-warning">{state.warning}</span> : null}
        </Banner>
      ) : state.status === 'error' ? (
        <Banner tone="danger">{state.message}</Banner>
      ) : null}
    </div>
  );
}

// ---------- Roster import ----------

type Mode = 'file' | 'sheet' | 'manual';

export function RosterImporter({ value, onChange }: { value: RosterStudent[]; onChange: (v: RosterStudent[]) => void }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [sheetUrl, setSheetUrl] = useState('');
  const [manual, setManual] = useState({ name: '', rollNo: '' });
  const [showAll, setShowAll] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const merge = (incoming: RosterStudent[]) => {
    const byRoll = new Map(value.map((s) => [s.rollNo.toUpperCase(), s]));
    for (const s of incoming) byRoll.set(s.rollNo.toUpperCase(), s);
    onChange([...byRoll.values()]);
  };

  const parse = async (body: FormData | { sheetUrl: string }) => {
    setBusy(true);
    setError(null);
    setWarnings([]);
    try {
      const r = await api<{ students: RosterStudent[]; warnings: string[] }>('/tools/roster/parse', { method: 'POST', body });
      if (!r.students.length) setError(r.warnings[0] ?? 'No students were found.');
      else {
        onChange(r.students);
        setWarnings(r.warnings);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const options: { id: Mode; icon: string; label: string }[] = [
    { id: 'file', icon: 'upload_file', label: 'Excel / CSV' },
    { id: 'sheet', icon: 'table_chart', label: 'Google Sheet' },
    { id: 'manual', icon: 'person_add', label: 'Add Manually' },
  ];

  const shown = showAll ? value : value.slice(0, 5);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => {
              setMode(o.id);
              setError(null);
              if (o.id === 'file') fileRef.current?.click();
            }}
            className={clsx(
              'relative flex flex-col items-center gap-2 rounded-card border bg-surface px-2 py-4 text-center text-small font-medium transition-colors',
              mode === o.id ? 'border-2 border-primary text-primary' : 'border-line text-ink hover:border-primary/50',
            )}
          >
            <span className={clsx('flex h-10 w-10 items-center justify-center rounded-ctl', mode === o.id ? 'bg-primary text-primary-on' : 'bg-subtle text-muted')}>
              <Icon name={o.icon} />
            </span>
            {o.label}
            {mode === o.id ? (
              <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-on">
                <Icon name="check" size={14} />
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            const fd = new FormData();
            fd.append('file', f);
            void parse(fd);
          }
          e.target.value = '';
        }}
      />

      {mode === 'file' ? (
        <p className="text-small text-muted">
          Upload an .xlsx or .csv file with columns <b>Name</b> and <b>Roll No / Student ID</b>.{' '}
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => fileRef.current?.click()}>
            Choose file
          </button>
        </p>
      ) : null}

      {mode === 'sheet' ? (
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <Input value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" inputMode="url" autoCapitalize="off" />
          </div>
          <Button variant="secondary" loading={busy} onClick={() => void parse({ sheetUrl })}>
            Import
          </Button>
        </div>
      ) : null}

      {mode === 'manual' ? (
        <form
          className="grid grid-cols-[1fr_1fr_auto] gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!manual.name.trim() || !manual.rollNo.trim()) {
              setError('Enter both the student name and Student ID.');
              return;
            }
            setError(null);
            merge([{ name: manual.name.trim(), rollNo: manual.rollNo.trim() }]);
            setManual({ name: '', rollNo: '' });
          }}
        >
          <Input value={manual.name} onChange={(e) => setManual((m) => ({ ...m, name: e.target.value }))} placeholder="Student name" aria-label="Student name" />
          <Input value={manual.rollNo} onChange={(e) => setManual((m) => ({ ...m, rollNo: e.target.value }))} placeholder="Student ID" aria-label="Student ID" autoCapitalize="characters" />
          <Button type="submit" icon="add" aria-label="Add student" className="px-3" />
        </form>
      ) : null}

      {busy && mode === 'file' ? (
        <p className="flex items-center gap-2 text-small text-muted">
          <Spinner className="h-4 w-4" /> Reading file…
        </p>
      ) : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {warnings.length ? (
        <Banner tone="warning">
          {warnings.map((w) => (
            <span key={w} className="block">
              {w}
            </span>
          ))}
        </Banner>
      ) : null}

      {value.length ? (
        <div className="overflow-hidden rounded-card border border-line">
          <div className="flex items-center justify-between border-b border-line bg-subtle/60 px-4 py-2.5">
            <span className="eyebrow">Roster preview</span>
            <span className="text-caption text-muted">
              Showing {shown.length} of {value.length}
            </span>
          </div>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line text-caption font-semibold uppercase tracking-[0.05em] text-muted">
                <th className="w-12 px-4 py-2">#</th>
                <th className="px-2 py-2">Student name</th>
                <th className="px-4 py-2 text-right">Student ID</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((s, i) => (
                <tr key={s.rollNo}>
                  <td className="tnum px-4 py-2.5 text-small text-muted">{i + 1}</td>
                  <td className="px-2 py-2.5 text-body text-ink">{s.name}</td>
                  <td className="tnum px-4 py-2.5 text-right text-body text-ink">{s.rollNo}</td>
                  <td className="pr-2">
                    <button type="button" aria-label={`Remove ${s.name}`} onClick={() => onChange(value.filter((x) => x.rollNo !== s.rollNo))} className="rounded p-1 text-muted hover:bg-danger-tint hover:text-danger">
                      <Icon name="close" size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {value.length > 5 ? (
            <button type="button" onClick={() => setShowAll((x) => !x)} className="w-full border-t border-line py-2.5 text-small font-semibold text-primary hover:bg-subtle">
              {showAll ? 'Show less' : `Show all ${value.length} students`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
