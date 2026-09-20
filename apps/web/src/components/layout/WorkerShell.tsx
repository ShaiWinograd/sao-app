import AppShell from './AppShell';

export default function WorkerShell({ children }: { children: React.ReactNode }) {
  return <AppShell area="worker">{children}</AppShell>;
}
