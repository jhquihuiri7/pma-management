"use client";

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";

export default function SessionProviderRGDP({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <NextAuthSessionProvider basePath="/rgdp/api/auth">
      {children}
    </NextAuthSessionProvider>
  );
}
