import SidebarAdmin from "@/components/layout/SidebarAdmin";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <SidebarAdmin />
      <div className="ml-64 min-h-screen">
        <main className="p-8">{children}</main>
      </div>
    </div>
  );
}
