import Sidebar from '@/components/layout/Sidebar';
import QueryProvider from '@/components/layout/QueryProvider';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <div className="flex h-screen bg-white">
        {/* Sidebar */}
        <Sidebar />
        
        {/* Main Content */}
        <main className="flex-1 overflow-y-auto border-r border-gray-200">
          <div className="p-5 w-full max-w-none">
            {children}
          </div>
        </main>
      </div>
    </QueryProvider>
  );
}
