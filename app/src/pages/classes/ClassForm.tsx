import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import type { ClassItem, RosterStudent, SourceType } from '@/lib/types';
import { Page } from '@/components/layout/AppShell';
import { Banner, Button, Card, Chip, ConfirmDialog, ErrorState, Field, Input, Select, SkeletonList } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { RosterImporter, SourcePicker, sourceLinkError, verifyLink } from '@/components/sources';

export const COURSES = ['MCA', 'BCA', 'B.Tech', 'M.Tech', 'MBA', 'BBA', 'B.Sc', 'M.Sc', 'B.Com', 'M.Com', 'BA', 'MA', 'Ph.D', 'Other'];
export const SEMESTERS = [...Array.from({ length: 10 }, (_, i) => `Semester ${i + 1}`), 'Year 1', 'Year 2', 'Year 3', 'Year 4'];

export default function ClassForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const existing = useQuery({ queryKey: ['class', id], queryFn: () => api<ClassItem>(`/classes/${id}`), enabled: editing });

  const [form, setForm] = useState({ course: 'MCA', courseOther: '', semester: 'Semester 1', section: '', subjectCode: '', subjectName: '' });
  const [source, setSource] = useState<{ type: SourceType; url: string }>({ type: 'DRIVE_FOLDER', url: '' });
  const [students, setStudents] = useState<RosterStudent[]>([]);
  const [touched, setTouched] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const c = existing.data;
    if (!c) return;
    const known = COURSES.includes(c.course);
    setForm({ course: known ? c.course : 'Other', courseOther: known ? '' : c.course, semester: c.semester, section: c.section, subjectCode: c.subjectCode ?? '', subjectName: c.subjectName });
    setSource({ type: c.sourceType ?? 'DRIVE_FOLDER', url: c.sourceUrl ?? '' });
  }, [existing.data]);

  const course = form.course === 'Other' ? form.courseOther.trim() : form.course;
  const errors = {
    course: !course ? 'Course is required' : null,
    section: !form.section.trim() ? 'Section is required' : null,
    subjectName: form.subjectName.trim().length < 2 ? 'Subject name is required' : null,
    source: sourceLinkError(source.type, source.url),
  };
  const show = (k: keyof typeof errors) => (touched ? errors[k] : null);
  const set = <K extends keyof typeof form>(k: K, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setTouched(true);
    setSourceError(errors.source);
    if (Object.values(errors).some(Boolean)) {
      setError('Please fill all required fields.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setSaving(true);
    setError(null);
    // Make sure GradeLens can actually open the folder/sheet before saving the class.
    try {
      await verifyLink(source.type, source.url.trim());
    } catch (e) {
      setSourceError(errorMessage(e));
      setError('The submission link could not be opened. Check the link and that it is shared with your Google account.');
      setSaving(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const body = {
      course,
      semester: form.semester,
      section: form.section.trim(),
      subjectCode: form.subjectCode.trim() || null,
      subjectName: form.subjectName.trim(),
      sourceType: source.type,
      sourceUrl: source.url.trim(),
      ...(editing ? {} : { students }),
    };
    try {
      const c = await api<ClassItem>(editing ? `/classes/${id}` : '/classes', { method: editing ? 'PUT' : 'POST', body });
      await qc.invalidateQueries({ queryKey: ['classes'] });
      await qc.invalidateQueries({ queryKey: ['class', c.id] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.show(editing ? 'Class updated.' : 'Class saved.');
      nav(`/classes/${c.id}`, { replace: true });
    } catch (e) {
      setError(errorMessage(e));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api(`/classes/${id}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: ['classes'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.show('Class deleted.');
      nav('/classes', { replace: true });
    } catch (e) {
      toast.show(errorMessage(e), { kind: 'error' });
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  if (editing && existing.isLoading)
    return (
      <Page title="Edit Class" back={-1}>
        <SkeletonList rows={2} />
      </Page>
    );
  if (editing && existing.error)
    return (
      <Page title="Edit Class" back="/classes">
        <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />
      </Page>
    );

  return (
    <Page
      title={editing ? 'Edit Class' : 'Add Class'}
      back={editing ? `/classes/${id}` : '/classes'}
      bottomBar={
        <Button size="lg" onClick={save} loading={saving} iconRight="check" className="lg:min-w-[200px]">
          Save Class
        </Button>
      }
    >
      <div className="mx-auto max-w-3xl space-y-6">
        {error ? <Banner tone="danger">{error}</Banner> : null}

        <Card className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Course" required error={form.course !== 'Other' ? show('course') : null}>
              <Select value={form.course} onChange={(e) => set('course', e.target.value)}>
                {COURSES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Semester / Year" required>
              <Select value={form.semester} onChange={(e) => set('semester', e.target.value)}>
                {SEMESTERS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </Field>
          </div>
          {form.course === 'Other' ? (
            <Field label="Course name" required error={show('course')}>
              <Input value={form.courseOther} onChange={(e) => set('courseOther', e.target.value)} placeholder="e.g. B.Pharm" invalid={!!show('course')} />
            </Field>
          ) : null}
          <div className="grid grid-cols-[110px_1fr] gap-4 sm:grid-cols-[160px_1fr]">
            <Field label="Section" required error={show('section')}>
              <Input value={form.section} onChange={(e) => set('section', e.target.value)} placeholder="e.g. A" className="text-center uppercase placeholder:normal-case" maxLength={10} invalid={!!show('section')} />
            </Field>
            <Field label="Subject Code" optional>
              <Input value={form.subjectCode} onChange={(e) => set('subjectCode', e.target.value)} placeholder="e.g. TMC-301" autoCapitalize="characters" />
            </Field>
          </div>
          <Field label="Subject Name" required error={show('subjectName')}>
            <Input value={form.subjectName} onChange={(e) => set('subjectName', e.target.value)} placeholder="e.g. Design and Analysis of Algorithms" invalid={!!show('subjectName')} />
          </Field>
        </Card>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-h3 text-primary dark:text-ink">Submission Source</h2>
            <span className="text-caption font-semibold text-danger">Required</span>
          </div>
          <Card>
            <SourcePicker
              type={source.type}
              url={source.url}
              error={touched ? sourceError : null}
              onChange={(type, url) => {
                setSource({ type, url });
                if (touched) setSourceError(sourceLinkError(type, url));
              }}
            />
          </Card>
        </section>

        {!editing ? (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-h3 text-primary dark:text-ink">Students</h2>
              {students.length ? <Chip tone="success" icon="check">{students.length} imported</Chip> : <span className="text-caption text-muted">You can also add them later</span>}
            </div>
            <Card>
              <RosterImporter value={students} onChange={setStudents} />
            </Card>
          </section>
        ) : (
          <Card className="flex flex-col gap-4 border-danger/30 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-h3 text-ink">Delete class</h2>
              <p className="text-small text-muted">Removes the class, its students, assignments and results permanently.</p>
            </div>
            <Button variant="danger" icon="delete" onClick={() => setConfirmDelete(true)}>
              Delete Class
            </Button>
          </Card>
        )}
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        loading={deleting}
        tone="danger"
        title="Delete this class?"
        body="All students, assignments and evaluation results of this class will be permanently deleted. This cannot be undone."
        confirmLabel="Delete Class"
      />
    </Page>
  );
}
