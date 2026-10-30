import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { AppShell, NotificationsPage } from '@/components/layout/AppShell';
import Splash from '@/pages/Splash';
import Login from '@/pages/Login';
import AuthCallback from '@/pages/AuthCallback';
import Dashboard from '@/pages/Dashboard';
import { SkeletonList } from '@/components/ui';

const ProfileSetup = lazy(() => import('@/pages/setup/ProfileSetup'));
const SetupComplete = lazy(() => import('@/pages/setup/SetupComplete'));
const ClassesList = lazy(() => import('@/pages/classes/ClassesList'));
const ClassForm = lazy(() => import('@/pages/classes/ClassForm'));
const ClassDetail = lazy(() => import('@/pages/classes/ClassDetail'));
const AssignmentsList = lazy(() => import('@/pages/assignments/AssignmentsList'));
const AssignmentWizard = lazy(() => import('@/pages/assignments/AssignmentWizard'));
const AssignmentRedirect = lazy(() => import('@/pages/assignments/AssignmentRedirect'));
const AnswerKey = lazy(() => import('@/pages/assignments/AnswerKey'));
const Progress = lazy(() => import('@/pages/assignments/Progress'));
const Results = lazy(() => import('@/pages/assignments/Results'));
const ExportPage = lazy(() => import('@/pages/assignments/Export'));
const SubmissionDetail = lazy(() => import('@/pages/SubmissionDetail'));
const FraudComparison = lazy(() => import('@/pages/FraudComparison'));
const Reports = lazy(() => import('@/pages/Reports'));
const Profile = lazy(() => import('@/pages/profile/Profile'));
const EditProfile = lazy(() => import('@/pages/profile/EditProfile'));
const Settings = lazy(() => import('@/pages/profile/Settings'));
const NotFound = lazy(() => import('@/pages/NotFound'));

function RequireAuth({ children }: { children: ReactNode }) {
  const { ready, token, me, meLoading, meError } = useAuth();
  const loc = useLocation();
  if (!ready || (token && meLoading)) return <Splash />;
  if (!token) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (!me && meError) return <Splash error={meError} />;
  if (me && !me.profileComplete && !loc.pathname.startsWith('/setup')) return <Navigate to="/setup" replace />;
  return <>{children}</>;
}

const Loading = () => (
  <div className="mx-auto w-full max-w-content px-4 pt-6 lg:px-8">
    <SkeletonList rows={3} />
  </div>
);

function Shell() {
  return (
    <RequireAuth>
      <AppShell>
        <Suspense fallback={<Loading />}>
          <Outlet />
        </Suspense>
      </AppShell>
    </RequireAuth>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route
        path="/setup"
        element={
          <RequireAuth>
            <Suspense fallback={<Splash />}>
              <ProfileSetup />
            </Suspense>
          </RequireAuth>
        }
      />
      <Route
        path="/setup/complete"
        element={
          <RequireAuth>
            <Suspense fallback={<Splash />}>
              <SetupComplete />
            </Suspense>
          </RequireAuth>
        }
      />
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="classes" element={<ClassesList />} />
        <Route path="classes/new" element={<ClassForm />} />
        <Route path="classes/:id" element={<ClassDetail />} />
        <Route path="classes/:id/edit" element={<ClassForm />} />
        <Route path="assignments" element={<AssignmentsList />} />
        <Route path="assignments/new" element={<AssignmentWizard />} />
        <Route path="assignments/:id" element={<AssignmentRedirect />} />
        <Route path="assignments/:id/edit" element={<AssignmentWizard />} />
        <Route path="assignments/:id/key" element={<AnswerKey />} />
        <Route path="assignments/:id/progress" element={<Progress />} />
        <Route path="assignments/:id/results" element={<Results />} />
        <Route path="assignments/:id/export" element={<ExportPage />} />
        <Route path="submissions/:id" element={<SubmissionDetail />} />
        <Route path="flags/:id" element={<FraudComparison />} />
        <Route path="reports" element={<Reports />} />
        <Route path="profile" element={<Profile />} />
        <Route path="profile/edit" element={<EditProfile />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
