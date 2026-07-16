import WorkerSidebar from '@/components/layout/WorkerSidebar';
import QueryProvider from '@/components/layout/QueryProvider';

export default function WorkerLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <div className="flex h-screen bg-white" dir="rtl">
        <WorkerSidebar />
        <main className="flex-1 overflow-y-auto border-r border-gray-200">
          <div className="p-5 w-full max-w-none">{children}</div>
        </main>
      </div>
    </QueryProvider>
  );
}
