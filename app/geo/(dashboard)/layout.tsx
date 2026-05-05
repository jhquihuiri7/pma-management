import SidebarGeo from "@/components/layout/SidebarGeo";

export default function GeoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <SidebarGeo />
      <div className="ml-64 min-h-screen">
        <main>{children}</main>
      </div>
    </div>
  );
}
