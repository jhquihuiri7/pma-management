import SidebarPG2030 from "@/components/layout/SidebarPG2030";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50">
      <SidebarPG2030 />
      <div className="ml-64 min-h-screen">
        <main className="p-8">{children}</main>
      </div>
    </div>
  );
}
