import { Link } from 'react-router-dom';
import { Page } from '@/components/layout/AppShell';
import { Button, EmptyState } from '@/components/ui';

export default function NotFound() {
  return (
    <Page title="Page not found" back="/">
      <EmptyState
        icon="explore_off"
        title="Page not found"
        body="The page you are looking for does not exist or has been moved."
        action={
          <Link to="/">
            <Button icon="space_dashboard">Go to Dashboard</Button>
          </Link>
        }
      />
    </Page>
  );
}
