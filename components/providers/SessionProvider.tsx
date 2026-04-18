"use client";

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";

export default function SessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <NextAuthSessionProvider basePath="/pma/api/auth">
      {children}
    </NextAuthSessionProvider>
  );
}
