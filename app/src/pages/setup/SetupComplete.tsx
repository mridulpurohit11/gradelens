import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Avatar, Button, Card, Chip, Icon } from '@/components/ui';
import { useTeacherPhoto } from '@/components/layout/AppShell';
import { SetupShell } from './SetupShell';

export default function SetupComplete() {
  const { me } = useAuth();
  const photo = useTeacherPhoto();
  useEffect(() => {
    document.title = 'Welcome · GradeLens';
  }, []);
  if (!me) return null;
  return (
    <SetupShell badge={<Chip tone="success" icon="check_circle">Setup complete</Chip>}>
      <Card className="mt-4 flex flex-col items-center px-6 py-10 text-center sm:px-10">
        <span className="flex h-24 w-24 items-center justify-center rounded-full bg-success-tint">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success text-white">
            <Icon name="check" size={34} />
          </span>
        </span>
        <h1 className="mt-6 text-h1 text-primary dark:text-ink">Welcome, {me.name}</h1>
        <p className="mt-2 max-w-md text-body text-muted">Your profile is ready. Start by registering your first class, then create an assignment to evaluate.</p>

        <div className="mt-6 flex w-full items-center gap-4 rounded-card border border-line bg-primary-tint/50 p-4 text-left">
          <Avatar name={me.name} src={photo} size={56} />
          <div className="min-w-0">
            <p className="truncate text-h3 text-ink">{me.name}</p>
            <p className="truncate text-small text-muted">
              {me.designation}
              {me.department ? ` · Dept. of ${me.department}` : ''}
            </p>
            <p className="truncate text-small text-muted">{me.university}</p>
          </div>
        </div>

        <Link to="/classes/new" className="mt-8 w-full">
          <Button size="lg" full icon="add_circle">
            Add Your First Class
          </Button>
        </Link>
        <Link to="/" className="mt-4 inline-flex items-center gap-1 text-body font-semibold text-primary hover:underline">
          Go to Dashboard <Icon name="arrow_forward" size={18} />
        </Link>
      </Card>
    </SetupShell>
  );
}
