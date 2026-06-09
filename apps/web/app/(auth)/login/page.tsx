"use client";

import { Suspense } from "react";
import Image from "next/image";
import { GalleryVerticalEndIcon, Loader2 } from "lucide-react";
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <a href="#" className="flex items-center gap-2 font-medium">
            <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <GalleryVerticalEndIcon className="size-4" />
            </div>
            SIGTAR
          </a>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <Suspense
            fallback={
              <div className="flex min-h-[300px] w-full max-w-xs items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
              </div>
            }
          >
            <div className="w-full max-w-xs">
              <LoginForm />
            </div>
          </Suspense>
        </div>
      </div>
      <div className="relative hidden bg-muted lg:block">
        <Image
          src="/imgs/geo/login.png"
          alt="Vista aérea costera del geoportal ambiental"
          fill
          priority
          sizes="50vw"
          className="object-cover dark:brightness-[0.2] dark:grayscale"
        />
      </div>
    </div>
  );
}
