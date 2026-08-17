import Sidebar from "@/components/layout/Sidebar";
import NotificationsBell from "@/components/layout/NotificationsBell";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50">
      <Sidebar />
      <div className="ml-64 min-h-screen">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 px-6 py-3 shadow-sm backdrop-blur">
          <div className="flex items-center justify-end">
            <NotificationsBell />
          </div>
        </header>
        <main className="p-8">{children}</main>
      </div>
    </div>
  );
}
