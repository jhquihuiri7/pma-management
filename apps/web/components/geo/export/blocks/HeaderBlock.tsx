"use client";

import { useEffect, useState } from "react";
import { Building2, Navigation } from "lucide-react";
import type { CartographicBlockProps } from "./shared";
import { cx } from "./shared";

export type HeaderTitleAlignment = "left" | "center" | "right";

export interface HeaderBlockProps
  extends Omit<CartographicBlockProps, "title"> {
  logoSrc?: string | null;
  logoAlt?: string;
  institution?: string;
  unit?: string;
  title?: string;
  subtitle?: string;
  system?: string;
  showLogo?: boolean;
  showTitle?: boolean;
  showSubtitle?: boolean;
  showNorth?: boolean;
  logoSizeMm?: number;
  titleSizeEm?: number;
  titleAlignment?: HeaderTitleAlignment;
  titleBold?: boolean;
}

export function HeaderBlock({
  logoSrc,
  logoAlt = "Logo institucional",
  institution = "Consejo de Gobierno del Régimen Especial de Galápagos",
  unit = "Dirección Distrital Santa Cruz",
  title = "MAPA TÉCNICO GEOGRÁFICO",
  subtitle = "Sector y ámbito territorial del mapa",
  system = "Sistema de Información Territorial",
  showLogo = true,
  showTitle = true,
  showSubtitle = true,
  showNorth = true,
  logoSizeMm = 14,
  titleSizeEm = 2.1,
  titleAlignment = "center",
  titleBold = true,
  className,
  ...rootProps
}: HeaderBlockProps) {
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    setLogoFailed(false);
  }, [logoSrc]);

  const showImage = Boolean(logoSrc) && !logoFailed;

  return (
    <header
      {...rootProps}
      title="Encabezado cartográfico"
      aria-label="Encabezado cartográfico"
      className={cx(
        "flex h-full w-full min-h-0 items-center gap-[0.8em] overflow-hidden border border-[#1f3a5f] bg-white px-[0.6em]",
        className,
      )}
    >
      {showLogo && (
        <div
          className="flex shrink-0 items-center justify-center overflow-hidden text-[#1f3a5f]"
          style={{ width: `${logoSizeMm}mm`, height: `${logoSizeMm}mm` }}
          title={showImage ? logoAlt : "Identidad institucional"}
        >
          {showImage ? (
            // The native element is required because logos can come from public/ or an uploaded data URL.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoSrc ?? undefined}
              alt={logoAlt}
              className="h-full w-full object-contain"
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <Building2
              aria-label="Identidad institucional"
              className="h-[3.2em] w-[3.2em]"
              strokeWidth={1.35}
            />
          )}
        </div>
      )}

      <div className="min-w-0 max-w-[24%]">
        <p className="m-0 text-[0.92em] font-bold leading-[1.15] text-slate-900">
          {institution}
        </p>
        {unit && (
          <p className="mb-0 mt-[0.15em] text-[0.78em] leading-[1.2] text-slate-700">
            {unit}
          </p>
        )}
      </div>

      <div className="h-[70%] w-px shrink-0 bg-slate-300" aria-hidden="true" />

      <div className="min-w-0 flex-1" style={{ textAlign: titleAlignment }}>
        {showTitle && (
          <h1
            className="m-0 leading-[1.1] tracking-[0.01em] text-slate-900"
            style={{
              fontSize: `${titleSizeEm}em`,
              fontWeight: titleBold ? 700 : 500,
            }}
          >
            {title}
          </h1>
        )}
        {showSubtitle && subtitle && (
          <p className="mb-0 mt-[0.25em] text-[1.05em] leading-[1.2] text-slate-700">
            {subtitle}
          </p>
        )}
      </div>

      {system && (
        <p className="m-0 max-w-[18%] text-right text-[0.75em] leading-[1.3] text-slate-600">
          {system}
        </p>
      )}

      {showNorth && (
        <div
          className="flex w-[2.8em] shrink-0 flex-col items-center justify-center text-slate-900"
          title="Norte cartográfico"
          aria-label="Norte cartográfico"
        >
          <span className="text-[1.05em] font-bold leading-none">N</span>
          <Navigation
            aria-hidden="true"
            className="mt-[0.15em] h-[2.5em] w-[1.6em] -rotate-45 fill-slate-900"
            strokeWidth={1.5}
          />
        </div>
      )}
    </header>
  );
}

export default HeaderBlock;
