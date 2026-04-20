import SessionProviderRGDP from "@/components/providers/SessionProviderRGDP";

export default function RGDPLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <SessionProviderRGDP>{children}</SessionProviderRGDP>;
}
