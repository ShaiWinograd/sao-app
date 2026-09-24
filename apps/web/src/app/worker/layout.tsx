import WorkerShell from '@/components/layout/WorkerShell';
import AuthorizationGate from '@/components/layout/AuthorizationGate';

export default function WorkerLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthorizationGate area="worker">
      <WorkerShell>{children}</WorkerShell>
    </AuthorizationGate>
  );
}
