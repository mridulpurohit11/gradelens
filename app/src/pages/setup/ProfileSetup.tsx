import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { api, errorMessage } from '@/lib/api';
import { applyTheme } from '@/lib/theme';
import type { Me, Strictness, Theme } from '@/lib/types';
import { Banner, Button, Card, Field, Icon, Input, Segmented, Select, Stepper, Toggle } from '@/components/ui';
import { CAMPUSES, DEPARTMENTS, DESIGNATIONS, PhotoPicker, SubjectsInput } from '@/components/profile';
import { SetupShell } from './SetupShell';

const STEPS = ['Basic Info', 'Department', 'Preferences'];

export default function ProfileSetup() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const initialStep = useMemo(() => {
    if (!me) return 0;
    if (!me.designation) return 0;
    if (!me.department || !me.university) return 1;
    return 2;
  }, [me]);
  const [step, setStep] = useState(initialStep);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const deptKnown = me?.department ? DEPARTMENTS.includes(me.department) : true;
  const [form, setForm] = useState({
    name: me?.name ?? '',
    designation: me?.designation ?? '',
    phone: (me?.phone ?? '').replace(/^\+91\s*/, ''),
    university: me?.university ?? 'Graphic Era Hill University',
    campus: me?.campus ?? 'Dehradun',
    department: deptKnown ? (me?.department ?? '') : 'Other',
    departmentOther: deptKnown ? '' : (me?.department ?? ''),
    employeeId: me?.employeeId ?? '',
    subjects: me?.subjects ?? [],
  });
  const [prefs, setPrefs] = useState({
    strictness: (me?.preferences.strictness ?? 'STANDARD') as Strictness,
    fraudDetection: me?.preferences.fraudDetection ?? true,
    handwritingCheck: me?.preferences.handwritingCheck ?? true,
    theme: (me?.preferences.theme ?? 'SYSTEM') as Theme,
  });

  useEffect(() => {
    document.title = 'Set up your profile · GradeLens';
  }, []);
  useEffect(() => {
    setTouched(false);
    setError(null);
    window.scrollTo(0, 0);
  }, [step]);

  if (!me) return null;
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const department = form.department === 'Other' ? form.departmentOther.trim() : form.department;

  const errors = {
    name: form.name.trim().length < 2 ? 'This field is required' : null,
    designation: !form.designation ? 'This field is required' : null,
    phone: form.phone && !/^[0-9\s-]{8,15}$/.test(form.phone) ? 'Enter a valid phone number' : null,
    university: !form.university.trim() ? 'This field is required' : null,
    department: !department ? 'This field is required' : null,
  };
  const stepValid = step === 0 ? !errors.name && !errors.designation && !errors.phone : step === 1 ? !errors.university && !errors.department : true;

  const save = async () => {
    setTouched(true);
    if (!stepValid) return;
    setSaving(true);
    setError(null);
    try {
      if (step === 0) {
        const u = await api<Me>('/me', { method: 'PUT', body: { name: form.name.trim(), designation: form.designation, phone: form.phone ? `+91 ${form.phone.trim()}` : null } });
        qc.setQueryData(['me'], u);
        setStep(1);
      } else if (step === 1) {
        const u = await api<Me>('/me', {
          method: 'PUT',
          body: { university: form.university.trim(), campus: form.campus, department, employeeId: form.employeeId.trim() || null, subjects: form.subjects },
        });
        qc.setQueryData(['me'], u);
        setStep(2);
      } else {
        await api<Me>('/me/preferences', { method: 'PUT', body: prefs });
        const u = await api<Me>('/me', { method: 'PUT', body: { profileComplete: true } });
        qc.setQueryData(['me'], u);
        nav('/setup/complete', { replace: true });
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const show = (k: keyof typeof errors) => (touched ? errors[k] : null);

  const footer = (
    <div className="flex gap-3">
      {step > 0 ? (
        <Button variant="secondary" size="lg" icon="arrow_back" onClick={() => setStep(step - 1)} className="flex-1 sm:flex-none sm:px-8">
          Back
        </Button>
      ) : null}
      <Button size="lg" onClick={save} loading={saving} iconRight={step === 2 ? 'check' : 'arrow_forward'} className="flex-[2]">
        {step === 2 ? 'Complete Setup' : step === 1 ? 'Continue to Preferences' : 'Continue'}
      </Button>
    </div>
  );

  return (
    <SetupShell>
      <h1 className="text-h1 text-primary dark:text-ink">Set up your faculty profile</h1>
      <p className="mt-1 text-body text-muted">This takes less than 2 minutes.</p>
      <div className="mt-6">
        <Stepper steps={STEPS} current={step} onStep={(i) => setStep(i)} />
      </div>

      {error ? <Banner tone="danger" className="mt-5">{error}</Banner> : null}

      <Card className="mt-6 space-y-5">
        {step === 0 ? (
          <>
            <PhotoPicker me={me} />
            <hr className="border-line" />
            <Field label="Full Name" required error={show('name')} htmlFor="name">
              <Input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} invalid={!!show('name')} placeholder="e.g. Dr. Neha Rawat" autoComplete="name" />
            </Field>
            <Field label="Official Email" right={<span className="text-caption text-muted">From Google</span>} hint="Linked to your Google account and cannot be changed here.">
              <Input value={me.email} disabled trailing={<Icon name="lock" className="text-muted" />} />
            </Field>
            <Field label="Designation" required error={show('designation')} htmlFor="designation">
              <Select id="designation" value={form.designation} onChange={(e) => set('designation', e.target.value)} invalid={!!show('designation')} placeholder="Select designation">
                {DESIGNATIONS.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </Select>
            </Field>
            <Field label="Phone Number" optional error={show('phone')} htmlFor="phone">
              <div className="flex">
                <span className="flex h-12 items-center rounded-l-ctl border border-r-0 border-line bg-primary-tint px-3 text-body font-medium text-primary lg:h-11">IN +91</span>
                <Input id="phone" inputMode="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} className="rounded-l-none" placeholder="98765 43210" invalid={!!show('phone')} />
              </div>
            </Field>
          </>
        ) : step === 1 ? (
          <>
            <Field label="University" required error={show('university')} htmlFor="uni">
              <Input id="uni" value={form.university} onChange={(e) => set('university', e.target.value)} invalid={!!show('university')} trailing={<Icon name="account_balance" className="text-muted" />} />
            </Field>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field label="Campus" htmlFor="campus">
                <Select id="campus" value={form.campus} onChange={(e) => set('campus', e.target.value)}>
                  {CAMPUSES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Department" required error={form.department !== 'Other' ? show('department') : null} htmlFor="dept">
                <Select id="dept" value={form.department} onChange={(e) => set('department', e.target.value)} placeholder="Select department" invalid={form.department !== 'Other' && !!show('department')}>
                  {DEPARTMENTS.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </Select>
              </Field>
            </div>
            {form.department === 'Other' ? (
              <Field label="Department name" required error={show('department')}>
                <Input value={form.departmentOther} onChange={(e) => set('departmentOther', e.target.value)} placeholder="e.g. Biotechnology" invalid={!!show('department')} />
              </Field>
            ) : null}
            <Field label="Employee ID" optional htmlFor="emp">
              <Input id="emp" value={form.employeeId} onChange={(e) => set('employeeId', e.target.value)} placeholder="e.g. GEHU-FAC-0894" />
            </Field>
            <Field label="Subjects Taught" hint="Press Enter after each subject." right={<span className="text-caption text-muted">{form.subjects.length} added</span>}>
              <SubjectsInput value={form.subjects} onChange={(v) => set('subjects', v)} />
            </Field>
          </>
        ) : (
          <>
            <div>
              <p className="text-body font-semibold text-ink">Default Grading Strictness</p>
              <p className="mb-3 text-small text-muted">Used for new assignments. You can change it per assignment.</p>
              <Segmented
                value={prefs.strictness}
                onChange={(v) => setPrefs((p) => ({ ...p, strictness: v }))}
                options={[
                  { value: 'LENIENT', label: 'Lenient' },
                  { value: 'STANDARD', label: 'Standard' },
                  { value: 'STRICT', label: 'Strict' },
                ]}
              />
            </div>
            <hr className="border-line" />
            <Toggle
              icon="policy"
              label="Fraud Detection"
              description="Flag duplicate photos and copied answers between students."
              checked={prefs.fraudDetection}
              onChange={(v) => setPrefs((p) => ({ ...p, fraudDetection: v }))}
            />
            <Toggle
              icon="draw"
              label="Handwriting Verification"
              description="Compare each submission's handwriting with the student's earlier submissions."
              checked={prefs.handwritingCheck}
              onChange={(v) => setPrefs((p) => ({ ...p, handwritingCheck: v }))}
            />
            <hr className="border-line" />
            <div>
              <p className="mb-3 text-body font-semibold text-ink">Theme</p>
              <Segmented
                value={prefs.theme}
                onChange={(v) => {
                  setPrefs((p) => ({ ...p, theme: v }));
                  applyTheme(v);
                }}
                options={[
                  { value: 'LIGHT', label: 'Light', icon: 'light_mode' },
                  { value: 'DARK', label: 'Dark', icon: 'dark_mode' },
                  { value: 'SYSTEM', label: 'System', icon: 'contrast' },
                ]}
              />
            </div>
            <Banner tone="info">You can change these anytime in Settings.</Banner>
          </>
        )}
      </Card>

      <div className="mt-6 hidden sm:block">{footer}</div>
      <p className="mt-3 hidden text-center text-caption text-muted sm:block">Step {step + 1} of 3</p>
      <div className="safe-bottom fixed inset-x-0 bottom-0 border-t border-line bg-surface px-4 pt-3 sm:hidden">
        <div className="pb-2">{footer}</div>
        <p className="pb-2 text-center text-caption text-muted">Step {step + 1} of 3</p>
      </div>
    </SetupShell>
  );
}
