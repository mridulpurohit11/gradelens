import { useRef, useState, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import type { Me } from '@/lib/types';
import { Avatar, Icon, Spinner } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { useTeacherPhoto } from '@/components/layout/AppShell';

export const DESIGNATIONS = ['Professor', 'Associate Professor', 'Assistant Professor', 'Lecturer', 'Guest Faculty', 'Head of Department', 'Dean'];
export const CAMPUSES = ['Dehradun', 'Bhimtal', 'Haldwani', 'Other'];
export const DEPARTMENTS = [
  'Computer Applications',
  'Computer Science & Engineering',
  'Information Technology',
  'Electronics & Communication',
  'Mechanical Engineering',
  'Civil Engineering',
  'Management',
  'Commerce',
  'Mathematics',
  'Physics',
  'Chemistry',
  'English',
  'Other',
];

export function PhotoPicker({ me, size = 96 }: { me: Me; size?: number }) {
  const photo = useTeacherPhoto();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();

  const upload = async (file: File) => {
    if (file.size > 6 * 1024 * 1024) {
      toast.show('Please choose a photo smaller than 6 MB.', { kind: 'error' });
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('photo', file);
      const updated = await api<Me>('/me/photo', { method: 'POST', body: fd });
      qc.setQueryData(['me'], updated);
      toast.show('Profile photo updated.');
    } catch (e) {
      toast.show(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <Avatar name={me.name} src={photo} size={size} className="ring-4 ring-primary-tint" />
        <button
          type="button"
          aria-label="Change photo"
          onClick={() => input.current?.click()}
          className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full border-2 border-surface bg-primary text-primary-on"
        >
          {busy ? <Spinner className="h-4 w-4" /> : <Icon name="photo_camera" size={18} />}
        </button>
      </div>
      <div className="min-w-0">
        <button type="button" className="text-body font-semibold text-primary hover:underline" onClick={() => input.current?.click()}>
          Change / Upload Photo
        </button>
        <p className="mt-0.5 flex items-center gap-1 text-small text-muted">
          {me.hasPhoto ? (
            'Custom photo'
          ) : me.googlePicture ? (
            <>
              <Icon name="sync" size={16} className="text-accent" /> From your Google account
            </>
          ) : (
            'No photo yet'
          )}
        </p>
        <p className="text-caption text-muted">JPG or PNG, up to 6 MB</p>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

export function SubjectsInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (!value.some((s) => s.toLowerCase() === v.toLowerCase())) onChange([...value, v]);
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div className="flex min-h-12 flex-wrap items-center gap-2 rounded-ctl border border-line bg-surface p-2 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary-tint">
      {value.map((s) => (
        <span key={s} className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/20 bg-primary-tint py-1 pl-3 pr-1 text-small font-medium text-primary">
          <span className="truncate">{s}</span>
          <button type="button" aria-label={`Remove ${s}`} onClick={() => onChange(value.filter((x) => x !== s))} className="rounded-full p-0.5 hover:bg-primary/10">
            <Icon name="close" size={16} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={add}
        placeholder={value.length ? 'Add subject' : 'Type a subject and press Enter'}
        className="h-8 min-w-[160px] flex-1 bg-transparent px-1 text-body text-ink outline-none placeholder:text-muted/80"
        aria-label="Add subject"
      />
    </div>
  );
}
