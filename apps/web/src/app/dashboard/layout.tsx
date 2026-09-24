import AppShell from '@/components/layout/AppShell';
import AuthorizationGate from '@/components/layout/AuthorizationGate';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthorizationGate area="owner">
      <AppShell area="owner">{children}</AppShell>
    </AuthorizationGate>
  );
}
