"use client";

import type { ReactNode, SyntheticEvent } from "react";
import { FileQuestion, MapPinned } from "lucide-react";
import type { CartographicBlockProps } from "./shared";
import { BlockFrame, EmptyBlockState, cx } from "./shared";

export interface LocatorLevel {
  id: string;
  label: string;
  preview?: ReactNode;
  imageSrc?: string | null;
  imageAlt?: string;
}

export interface LocatorBlockProps extends CartographicBlockProps {
  levels?: readonly LocatorLevel[];
  showLabels?: boolean;
  showBorders?: boolean;
  emptyMessage?: string;
}

function LocatorCell({
  level,
  showLabel,
  showBorder,
}: {
  level: LocatorLevel;
  showLabel: boolean;
  showBorder: boolean;
}) {
  const hasResource = Boolean(level.preview || level.imageSrc);
  const hideBrokenImage = (event: SyntheticEvent<HTMLImageElement>) => {
    event.currentTarget.style.display = "none";
  };

  return (
    <div
      className={cx(
        "relative flex min-w-0 flex-1 flex-col overflow-hidden bg-white",
        showBorder && "border border-slate-300",
      )}
      title={level.label}
    >
      {showLabel && (
        <p className="m-0 shrink-0 bg-[#eef2f6] px-[0.2em] py-[0.15em] text-center text-[0.6em] font-bold uppercase leading-[1.15] text-slate-900">
          {level.label}
        </p>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-white">
        {hasResource ? (
          <>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-[0.15em] border border-dashed border-slate-200 bg-slate-50 text-slate-400">
              <FileQuestion
                aria-hidden="true"
                className="h-[1em] w-[1em]"
                strokeWidth={1.5}
              />
              <p className="m-0 text-[0.52em] font-medium leading-[1.15]">
                Recurso no disponible
              </p>
            </div>
            {level.preview && (
              <div className="absolute inset-0 overflow-hidden bg-white">
                {level.preview}
              </div>
            )}
            {level.imageSrc && (
              // Locator images are generated previews and may be data URLs.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={level.imageSrc}
                alt={level.imageAlt ?? `Ubicación: ${level.label}`}
                className="absolute inset-0 h-full w-full bg-white object-contain"
                onError={hideBrokenImage}
              />
            )}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-[0.15em] border border-dashed border-slate-300 bg-slate-50 text-slate-400">
            <FileQuestion
              aria-hidden="true"
              className="h-[1em] w-[1em]"
              strokeWidth={1.5}
            />
            <p className="m-0 text-[0.52em] font-medium leading-[1.15]">
              Recurso no disponible
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function LocatorBlock({
  levels = [],
  showLabels = true,
  showBorders = true,
  emptyMessage = "No hay recursos territoriales para el mapa de ubicación",
  title = "Mapa de ubicación",
  ...rootProps
}: LocatorBlockProps) {
  return (
    <BlockFrame
      {...rootProps}
      title={title}
      bodyClassName="flex min-h-0 p-[0.3em]"
    >
      {levels.length > 0 ? (
        <div className="flex min-h-0 flex-1 gap-[0.35em] overflow-hidden">
          {levels.map((level) => (
            <LocatorCell
              key={level.id}
              level={level}
              showLabel={showLabels}
              showBorder={showBorders}
            />
          ))}
        </div>
      ) : (
        <EmptyBlockState icon={MapPinned} message={emptyMessage} />
      )}
    </BlockFrame>
  );
}

export default LocatorBlock;
