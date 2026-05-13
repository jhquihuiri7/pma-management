import SidebarRGDP from "@/components/layout/SidebarRGDP";
import NotificationsBellRGDP from "@/components/layout/NotificationsBellRGDP";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50">
      <SidebarRGDP />
      <div className="ml-64 min-h-screen">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-slate-50/95 px-8 py-3 backdrop-blur">
          <div className="flex items-center justify-end">
            <NotificationsBellRGDP />
          </div>
        </header>
        <main className="p-8">{children}</main>
      </div>
    </div>
  );
}
