import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { api, apiBlob, errorMessage } from '@/lib/api';
import { applyTheme } from '@/lib/theme';
import { saveFile } from '@/lib/platform';
import type { Me, TeacherStats } from '@/lib/types';
import { fmtInr } from '@/lib/format';
import { Page, LogoutDialog, useTeacherPhoto } from '@/components/layout/AppShell';
import { Avatar, Button, Chip, Dialog, Icon, Input, Segmented, Select, Toggle } from '@/components/ui';
import { useToast } from '@/components/ui/toast';

const USD_TO_INR = 86;

function Section({ icon, title, children, aside }: { icon: string; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line bg-primary-tint/50 px-4 py-3 lg:px-5">
        <h2 className="flex items-center gap-2 text-h3 text-primary dark:text-ink">
          <Icon name={icon} /> {title}
        </h2>
        {aside}
      </div>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

const Row = ({ children }: { children: ReactNode }) => <div className="px-4 py-4 lg:px-5">{children}</div>;

export default function Settings() {
  const { me, signOut, signInWithGoogle, config } = useAuth();
  const photo = useTeacherPhoto();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const stats = useQuery({ queryKey: ['me-stats'], queryFn: () => api<TeacherStats>('/me/stats') });
  const [logout, setLogout] = useState(false);
  const [del, setDel] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  if (!me) return null;
  const p = me.preferences;

  const update = async (patch: Partial<Me['preferences']>) => {
    qc.setQueryData<Me>(['me'], (old) => (old ? { ...old, preferences: { ...old.preferences, ...patch } } : old));
    if (patch.theme) applyTheme(patch.theme);
    try {
      const u = await api<Me>('/me/preferences', { method: 'PUT', body: patch });
      qc.setQueryData(['me'], u);
    } catch (e) {
      toast.show(errorMessage(e), { kind: 'error' });
      void qc.invalidateQueries({ queryKey: ['me'] });
    }
  };

  const exportData = async () => {
    setBusy('export');
    try {
      const { blob, filename } = await apiBlob('/me/export');
      await saveFile(blob, filename ?? 'gradelens-data.json');
      toast.show('Your data was exported.');
    } catch (e) {
      toast.show(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const clearCache = async () => {
    qc.removeQueries({ predicate: (q) => !['me', 'auth-config'].includes(String(q.queryKey[0])) });
    try {
      if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k);
    } catch {
      /* ignore */
    }
    toast.show('Local cache cleared.');
  };

  const deleteAccount = async () => {
    setBusy('delete');
    try {
      await api('/me', { method: 'DELETE', body: { confirm: 'DELETE' } });
      toast.show('Your account and data were deleted.');
      await signOut();
      nav('/login', { replace: true });
    } catch (e) {
      toast.show(errorMessage(e), { kind: 'error' });
      setBusy(null);
    }
  };

  return (
    <Page title="Settings & Preferences" mobileTitle="Settings" back="/profile">
      <div className="mx-auto max-w-2xl space-y-5">
        <div className="card flex items-center gap-4 p-4">
          <Avatar name={me.name} src={photo} size={52} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-h3 text-ink">{me.name}</p>
            <p className="truncate text-small text-muted">{me.department ? `Dept. of ${me.department}` : me.email}</p>
          </div>
          <Button variant="text" onClick={() => nav('/profile/edit')}>
            Edit
          </Button>
        </div>

        <Section icon="rule" title="Evaluation defaults">
          <Row>
            <label className="mb-2 block text-body font-semibold text-ink" htmlFor="strict">
              Default grading strictness
            </label>
            <Select id="strict" value={p.strictness} onChange={(e) => void update({ strictness: e.target.value as Me['preferences']['strictness'] })}>
              <option value="LENIENT">Lenient — generous partial credit</option>
              <option value="STANDARD">Standard — balanced marking</option>
              <option value="STRICT">Strict — complete answers only</option>
            </Select>
          </Row>
          <Row>
            <Toggle label="Fraud detection" description="Detect duplicate photos and copied answers for new assignments." checked={p.fraudDetection} onChange={(v) => void update({ fraudDetection: v })} />
          </Row>
          <Row>
            <Toggle label="Handwriting verification" description="Compare handwriting against each student's earlier submissions." checked={p.handwritingCheck} onChange={(v) => void update({ handwritingCheck: v })} />
          </Row>
          <Row>
            <Toggle
              label="Second AI opinion"
              description="Unclear or low-confidence submissions are re-checked automatically by the stronger model."
              checked={p.smartEscalation}
              onChange={(v) => void update({ smartEscalation: v })}
            />
          </Row>
        </Section>

        <Section icon="hub" title="Account & connected services">
          <Row>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-small text-muted">Connected Google account</p>
                <p className="truncate text-body font-semibold text-ink">{me.email}</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => void signInWithGoogle()} disabled={!config?.googleConfigured}>
                Reconnect
              </Button>
            </div>
          </Row>
          <Row>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-body text-ink">
                <Icon name="add_to_drive" className="text-muted" /> Google Drive access
              </span>
              {me.driveAccess ? <Chip tone="success" icon="check_circle">Connected</Chip> : <Chip tone="warning" icon="error">Not granted</Chip>}
            </div>
          </Row>
          <Row>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-body text-ink">
                <Icon name="smart_toy" className="text-muted" /> AI evaluation (Claude)
              </span>
              {config?.aiConfigured ? <Chip tone="success" icon="check_circle">Ready</Chip> : <Chip tone="warning" icon="error">Not configured</Chip>}
            </div>
          </Row>
        </Section>

        <Section icon="palette" title="Appearance">
          <Row>
            <p className="mb-2 text-body font-semibold text-ink">Theme</p>
            <Segmented
              value={p.theme}
              onChange={(v) => void update({ theme: v })}
              options={[
                { value: 'LIGHT', label: 'Light', icon: 'light_mode' },
                { value: 'DARK', label: 'Dark', icon: 'dark_mode' },
                { value: 'SYSTEM', label: 'System', icon: 'contrast' },
              ]}
            />
          </Row>
        </Section>

        <Section icon="notifications" title="Notifications">
          <Row>
            <Toggle label="Evaluation completed" checked={p.notifyEvalComplete} onChange={(v) => void update({ notifyEvalComplete: v })} />
          </Row>
          <Row>
            <Toggle label="Academic integrity & fraud alerts" checked={p.notifyFraud} onChange={(v) => void update({ notifyFraud: v })} />
          </Row>
        </Section>

        <Section icon="shield" title="Data & privacy">
          <button type="button" onClick={exportData} disabled={busy === 'export'} className="flex w-full items-center justify-between px-4 py-4 text-left hover:bg-subtle lg:px-5">
            <span className="flex items-center gap-3 text-body text-ink">
              <Icon name="download" className="text-muted" /> Export my data
            </span>
            <Icon name="chevron_right" className="text-muted" />
          </button>
          <button type="button" onClick={clearCache} className="flex w-full items-center justify-between px-4 py-4 text-left hover:bg-subtle lg:px-5">
            <span className="flex items-center gap-3 text-body text-ink">
              <Icon name="cleaning_services" className="text-muted" /> Clear local cache
            </span>
            <Icon name="chevron_right" className="text-muted" />
          </button>
          <button type="button" onClick={() => setDel(true)} className="flex w-full items-center justify-between px-4 py-4 text-left hover:bg-danger-tint lg:px-5">
            <span className="flex items-center gap-3 text-body text-danger">
              <Icon name="delete_forever" /> Delete account and all data
            </span>
            <Icon name="chevron_right" className="text-danger" />
          </button>
        </Section>

        <Section icon="info" title="About">
          <Row>
            <div className="flex justify-between text-body">
              <span className="text-muted">Version</span>
              <span className="text-ink">1.0.0</span>
            </div>
          </Row>
          {stats.data ? (
            <Row>
              <div className="flex justify-between text-body">
                <span className="text-muted">AI usage so far (approx.)</span>
                <span className="text-ink">{fmtInr(stats.data.totalCostUsd * USD_TO_INR)}</span>
              </div>
            </Row>
          ) : null}
          <Row>
            <p className="text-small text-muted">
              Marks are suggested by AI and must be reviewed by the teacher. Student submissions are read from your Google Drive and processed by the Claude API for evaluation.
            </p>
          </Row>
        </Section>

        <Button size="lg" full variant="danger" icon="logout" onClick={() => setLogout(true)}>
          Log Out
        </Button>
      </div>

      <LogoutDialog open={logout} onClose={() => setLogout(false)} onConfirm={() => void signOut()} />
      <Dialog
        open={del}
        onClose={() => setDel(false)}
        tone="danger"
        icon="delete_forever"
        title="Delete your GradeLens account?"
        actions={
          <>
            <Button variant="secondary" onClick={() => setDel(false)}>
              Cancel
            </Button>
            <Button variant="danger-solid" disabled={confirmText !== 'DELETE'} loading={busy === 'delete'} onClick={deleteAccount}>
              Delete permanently
            </Button>
          </>
        }
      >
        <p>All classes, students, assignments and evaluation results will be permanently deleted. Files in your Google Drive are not touched.</p>
        <p className="mt-3 text-ink">
          Type <b>DELETE</b> to confirm.
        </p>
        <div className="mt-2">
          <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoCapitalize="characters" aria-label="Type DELETE to confirm" />
        </div>
      </Dialog>
    </Page>
  );
}
