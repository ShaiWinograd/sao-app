import WorkerShell from '@/components/layout/WorkerShell';
import QueryProvider from '@/components/layout/QueryProvider';
import AuthorizationGate from '@/components/layout/AuthorizationGate';

export default function WorkerLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <AuthorizationGate area="worker">
        <WorkerShell>{children}</WorkerShell>
      </AuthorizationGate>
    </QueryProvider>
  );
}
