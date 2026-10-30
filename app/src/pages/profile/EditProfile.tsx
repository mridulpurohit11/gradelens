import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { api, errorMessage } from '@/lib/api';
import type { Me } from '@/lib/types';
import { Page } from '@/components/layout/AppShell';
import { Banner, Button, Card, Field, Icon, Input, Select } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { CAMPUSES, DEPARTMENTS, DESIGNATIONS, PhotoPicker, SubjectsInput } from '@/components/profile';

export default function EditProfile() {
  const { me } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const deptKnown = me?.department ? DEPARTMENTS.includes(me.department) : true;
  const [f, setF] = useState({
    name: me?.name ?? '',
    designation: me?.designation ?? '',
    phone: me?.phone ?? '',
    university: me?.university ?? '',
    campus: me?.campus ?? 'Dehradun',
    department: deptKnown ? (me?.department ?? '') : 'Other',
    departmentOther: deptKnown ? '' : (me?.department ?? ''),
    employeeId: me?.employeeId ?? '',
    subjects: me?.subjects ?? [],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const department = f.department === 'Other' ? f.departmentOther.trim() : f.department;

  const save = async () => {
    if (f.name.trim().length < 2 || !f.designation || !f.university.trim() || !department) {
      setError('Please fill all required fields.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const u = await api<Me>('/me', {
        method: 'PUT',
        body: {
          name: f.name.trim(),
          designation: f.designation,
          phone: f.phone.trim() || null,
          university: f.university.trim(),
          campus: f.campus,
          department,
          employeeId: f.employeeId.trim() || null,
          subjects: f.subjects,
        },
      });
      qc.setQueryData(['me'], u);
      toast.show('Profile updated.');
      nav('/profile');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page
      title="Edit Profile"
      back="/profile"
      bottomBar={
        <Button size="lg" onClick={save} loading={saving} iconRight="check" className="lg:min-w-[200px]">
          Save Changes
        </Button>
      }
    >
      <div className="mx-auto max-w-2xl space-y-5">
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Card>
          <PhotoPicker me={me} />
        </Card>
        <Card className="space-y-5">
          <Field label="Full Name" required>
            <Input value={f.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Designation" required>
            <Select value={f.designation} onChange={(e) => set('designation', e.target.value)} placeholder="Select designation">
              {DESIGNATIONS.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </Select>
          </Field>
          <Field label="Official Email" hint="Linked to your Google account.">
            <Input value={me.email} disabled trailing={<Icon name="lock" className="text-muted" />} />
          </Field>
          <Field label="Phone" optional>
            <Input value={f.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" placeholder="+91 98765 43210" />
          </Field>
        </Card>
        <Card className="space-y-5">
          <Field label="College / University" required>
            <Input value={f.university} onChange={(e) => set('university', e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="Campus">
              <Select value={f.campus} onChange={(e) => set('campus', e.target.value)}>
                {CAMPUSES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Department" required>
              <Select value={f.department} onChange={(e) => set('department', e.target.value)} placeholder="Select department">
                {DEPARTMENTS.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </Select>
            </Field>
          </div>
          {f.department === 'Other' ? (
            <Field label="Department name" required>
              <Input value={f.departmentOther} onChange={(e) => set('departmentOther', e.target.value)} />
            </Field>
          ) : null}
          <Field label="Employee ID" optional>
            <Input value={f.employeeId} onChange={(e) => set('employeeId', e.target.value)} />
          </Field>
          <Field label="Subjects" hint="Press Enter after each subject.">
            <SubjectsInput value={f.subjects} onChange={(v) => set('subjects', v)} />
          </Field>
        </Card>
      </div>
    </Page>
  );
}
