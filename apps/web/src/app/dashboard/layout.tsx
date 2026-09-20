import AppShell from '@/components/layout/AppShell';
import QueryProvider from '@/components/layout/QueryProvider';
import AuthorizationGate from '@/components/layout/AuthorizationGate';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <AuthorizationGate area="owner">
        <AppShell area="owner">{children}</AppShell>
      </AuthorizationGate>
    </QueryProvider>
  );
}
