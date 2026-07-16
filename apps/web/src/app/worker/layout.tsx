import WorkerSidebar from '@/components/layout/WorkerSidebar';
import QueryProvider from '@/components/layout/QueryProvider';

export default function WorkerLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <div className="worker-theme flex h-screen bg-[#f6f2f8]" dir="rtl">
        <WorkerSidebar />
        <main className="flex-1 overflow-y-auto border-r border-primary-100">
          <div className="p-5 w-full max-w-none">{children}</div>
        </main>
      </div>
    </QueryProvider>
  );
}
