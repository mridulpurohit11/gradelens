import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import type { AssignmentListItem, ClassItem, RosterStudent, StudentRow } from '@/lib/types';
import { fmtNum, fmtPct } from '@/lib/format';
import { Page } from '@/components/layout/AppShell';
import { Button, Card, Chip, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, Icon, IconButton, Input, Segmented, SkeletonList, Tabs } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { AssignmentCard } from '@/components/assignment';
import { RosterImporter } from '@/components/sources';
import { BarList } from '@/components/charts';

type Tab = 'assignments' | 'students' | 'analytics';

export default function ClassDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'assignments';
  const cls = useQuery({ queryKey: ['class', id], queryFn: () => api<ClassItem>(`/classes/${id}`) });

  if (cls.isLoading)
    return (
      <Page title="Class Details" back="/classes">
        <SkeletonList rows={3} />
      </Page>
    );
  if (cls.error || !cls.data)
    return (
      <Page title="Class Details" back="/classes">
        <ErrorState error={cls.error} onRetry={() => void cls.refetch()} />
      </Page>
    );
  const c = cls.data;

  return (
    <Page title="Class Details" back="/classes" actions={<IconButton icon="edit" label="Edit class" onClick={() => nav(`/classes/${id}/edit`)} />}>
      <Card className="mb-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="eyebrow">{c.subjectCode ? `Subject code ${c.subjectCode}` : 'Class'}</p>
            <h1 className="mt-1 text-h1 text-primary dark:text-ink">{c.label}</h1>
            <p className="text-body text-ink">{c.subjectName}</p>
          </div>
          <Button variant="secondary" icon="edit_note" onClick={() => nav(`/classes/${id}/edit`)} className="hidden lg:inline-flex">
            Edit Class
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
          <Chip tone="primary" icon="group">
            {c.studentCount} Students
          </Chip>
          {c.sourceType ? (
            <Chip tone="success" icon="cloud_done">
              Source: {c.sourceType === 'DRIVE_FOLDER' ? 'Google Drive' : 'Google Sheet'}
            </Chip>
          ) : (
            <Chip tone="outline" icon="cloud_off">
              No source linked
            </Chip>
          )}
          <Chip tone="neutral" icon="assignment">
            {c.assignmentCount} Assignments
          </Chip>
        </div>
      </Card>

      <div className="card mb-5 overflow-hidden">
        <Tabs<Tab>
          value={tab}
          onChange={(t) => setParams({ tab: t }, { replace: true })}
          tabs={[
            { value: 'assignments', label: 'Assignments' },
            { value: 'students', label: 'Students' },
            { value: 'analytics', label: 'Analytics' },
          ]}
          className="border-b-0"
        />
      </div>

      {tab === 'assignments' ? <AssignmentsTab classId={c.id} /> : tab === 'students' ? <StudentsTab c={c} /> : <AnalyticsTab classId={c.id} />}
    </Page>
  );
}

function AssignmentsTab({ classId }: { classId: string }) {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['assignments', { classId }], queryFn: () => api<AssignmentListItem[]>(`/assignments?classId=${classId}`) });
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-h3 text-ink">{q.data ? `${q.data.length} Assignment${q.data.length === 1 ? '' : 's'}` : 'Assignments'}</h2>
        <Button icon="add" size="sm" onClick={() => nav(`/assignments/new?classId=${classId}`)}>
          New
        </Button>
      </div>
      {q.isLoading ? (
        <SkeletonList rows={2} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState
          icon="assignment_add"
          title="No assignments yet"
          body="Create the first assignment for this class."
          action={
            <Button icon="add" onClick={() => nav(`/assignments/new?classId=${classId}`)}>
              New Assignment
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {q.data.map((a) => (
            <AssignmentCard key={a.id} a={a} showClass={false} />
          ))}
        </div>
      )}
    </section>
  );
}

function StudentsTab({ c }: { c: ClassItem }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['students', c.id], queryFn: () => api<StudentRow[]>(`/classes/${c.id}/students`) });
  const [search, setSearch] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [incoming, setIncoming] = useState<RosterStudent[]>([]);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<StudentRow | null>(null);
  const [del, setDel] = useState<StudentRow | null>(null);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['students', c.id] });
    await qc.invalidateQueries({ queryKey: ['class', c.id] });
    void qc.invalidateQueries({ queryKey: ['classes'] });
  };

  const doImport = async () => {
    if (!incoming.length) return;
    setBusy(true);
    try {
      const r = await api<{ added: number; updated: number; removed: number }>(`/classes/${c.id}/students`, { method: 'POST', body: { students: incoming, mode } });
      toast.show(`${r.added} added, ${r.updated} updated${r.removed ? `, ${r.removed} removed` : ''}.`);
      setImportOpen(false);
      setIncoming([]);
      await refresh();
    } catch (e) {
      toast.show(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      await api(`/classes/${c.id}/students/${edit.id}`, { method: 'PUT', body: { name: edit.name, rollNo: edit.rollNo } });
      toast.show('Student updated.');
      setEdit(null);
      await refresh();
    } catch (e) {
      toast.show(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!del) return;
    setBusy(true);
    try {
      await api(`/classes/${c.id}/students/${del.id}`, { method: 'DELETE' });
      toast.show('Student removed.');
      setDel(null);
      await refresh();
    } catch (e) {
      toast.show(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const list = (q.data ?? []).filter((s) => {
    const n = search.trim().toLowerCase();
    return !n || s.name.toLowerCase().includes(n) || s.rollNo.toLowerCase().includes(n);
  });

  return (
    <section>
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="sm:w-80">
          <Input icon="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or ID" aria-label="Search students" />
        </div>
        <Button icon="person_add" variant="secondary" onClick={() => setImportOpen(true)}>
          Add / Import Students
        </Button>
      </div>
      {q.isLoading ? (
        <SkeletonList rows={2} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState icon="group_add" title="No students yet" body="Import the class roster from Excel, CSV or a Google Sheet." action={<Button icon="upload_file" onClick={() => setImportOpen(true)}>Import Students</Button>} />
      ) : (
        <Card padded={false} className="overflow-hidden">
          <table className="w-full text-left">
            <thead className="border-b border-line bg-subtle/60">
              <tr className="text-caption font-semibold uppercase tracking-[0.05em] text-muted">
                <th className="px-4 py-3">Student</th>
                <th className="hidden px-3 py-3 sm:table-cell">Student ID</th>
                <th className="hidden px-3 py-3 text-right md:table-cell">Submitted</th>
                <th className="px-3 py-3 text-right">Average</th>
                <th className="w-20 px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3">
                    <p className="text-body font-medium text-ink">{s.name}</p>
                    <p className="tnum text-caption text-muted sm:hidden">{s.rollNo}</p>
                  </td>
                  <td className="tnum hidden px-3 py-3 text-body text-ink sm:table-cell">{s.rollNo}</td>
                  <td className="tnum hidden px-3 py-3 text-right text-body text-ink md:table-cell">{s.submitted ?? 0}</td>
                  <td className="tnum px-3 py-3 text-right text-body font-semibold text-ink">{fmtPct(s.averagePercent)}</td>
                  <td className="px-2 py-2 text-right">
                    <div className="flex justify-end">
                      <IconButton icon="edit" label={`Edit ${s.name}`} onClick={() => setEdit({ ...s })} className="h-9 w-9" />
                      <IconButton icon="delete" label={`Remove ${s.name}`} onClick={() => setDel(s)} className="h-9 w-9 hover:text-danger" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-4 py-3 text-small text-muted">
            {list.length} of {q.data.length} students
          </p>
        </Card>
      )}

      <Dialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Add or import students"
        wide
        actions={
          <>
            <Button variant="secondary" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button onClick={doImport} loading={busy} disabled={!incoming.length}>
              Save {incoming.length ? `${incoming.length} student${incoming.length === 1 ? '' : 's'}` : ''}
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-ink">
          <RosterImporter value={incoming} onChange={setIncoming} />
          <Field label="How should these students be saved?">
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: 'merge', label: 'Add / update' },
                { value: 'replace', label: 'Replace roster' },
              ]}
            />
          </Field>
          {mode === 'replace' ? <p className="text-small text-warning">Students not in this list will be removed from the class.</p> : null}
        </div>
      </Dialog>

      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        title="Edit student"
        actions={
          <>
            <Button variant="secondary" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} loading={busy}>
              Save
            </Button>
          </>
        }
      >
        {edit ? (
          <div className="space-y-4 text-ink">
            <Field label="Student name" required>
              <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label="Student ID" required>
              <Input value={edit.rollNo} onChange={(e) => setEdit({ ...edit, rollNo: e.target.value })} />
            </Field>
          </div>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={!!del}
        onClose={() => setDel(null)}
        onConfirm={doDelete}
        loading={busy}
        tone="danger"
        title={`Remove ${del?.name ?? 'student'}?`}
        body="The student will be removed from this class. Their evaluated submissions stay in past results as unmatched uploads."
        confirmLabel="Remove"
      />
    </section>
  );
}

function AnalyticsTab({ classId }: { classId: string }) {
  const q = useQuery({
    queryKey: ['class-analytics', classId],
    queryFn: () =>
      api<{ rosterSize: number; assignments: { id: string; title: string; status: string; totalMarks: number; average: number | null; averagePercent: number | null; graded: number; submissions: number }[] }>(
        `/classes/${classId}/analytics`,
      ),
  });
  if (q.isLoading) return <SkeletonList rows={2} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const evaluated = (q.data?.assignments ?? []).filter((a) => a.averagePercent !== null);
  if (!evaluated.length) return <EmptyState icon="monitoring" title="No data yet" body="Analytics appear after the first assignment is evaluated." />;
  const overall = evaluated.reduce((s, a) => s + (a.averagePercent ?? 0), 0) / evaluated.length;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
      <Card>
        <p className="text-small text-muted">Class average (all assignments)</p>
        <p className="mt-2 text-stat text-ink">{fmtPct(overall)}</p>
        <p className="mt-1 text-small text-muted">Across {evaluated.length} evaluated assignment{evaluated.length === 1 ? '' : 's'}</p>
      </Card>
      <Card>
        <h3 className="text-h3 text-ink">Average score per assignment</h3>
        <p className="mb-5 text-small text-muted">Mean marks as a share of the total</p>
        <BarList
          data={evaluated.map((a) => ({
            key: a.id,
            label: a.title,
            value: a.average ?? 0,
            max: a.totalMarks,
            display: `${fmtNum(a.average)} / ${fmtNum(a.totalMarks)}`,
            tooltip: `${a.title}: ${fmtPct(a.averagePercent)} average · ${a.graded} evaluated`,
          }))}
        />
        <p className="mt-4 text-caption text-muted">
          <Link to="/reports" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
            Open detailed reports <Icon name="arrow_forward" size={16} />
          </Link>
        </p>
      </Card>
    </div>
  );
}
