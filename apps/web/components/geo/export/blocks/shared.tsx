import type {
  CSSProperties,
  HTMLAttributes,
  PointerEventHandler,
  ReactNode,
} from "react";
import type { LucideIcon } from "lucide-react";

export const INSTITUTIONAL_BLUE = "#1f3a5f";
export const MODULE_HEADER_BACKGROUND = "#eef2f6";

export type CartographicBlockProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "title"
> & {
  /** Título visible del módulo. Se normaliza a mayúsculas en la carta. */
  title?: string;
};

export interface BlockFrameProps extends CartographicBlockProps {
  children: ReactNode;
  bodyClassName?: string;
  bodyStyle?: CSSProperties;
  hideTitle?: boolean;
}

export interface EmptyBlockStateProps {
  icon: LucideIcon;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
  className?: string;
}

export function cx(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}

export function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function formatNumber(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat("es-EC", { maximumFractionDigits }).format(value);
}

export function BlockFrame({
  title = "MÓDULO CARTOGRÁFICO",
  children,
  className,
  bodyClassName,
  bodyStyle,
  hideTitle = false,
  ...rootProps
}: BlockFrameProps) {
  return (
    <section
      {...rootProps}
      title={title}
      aria-label={title}
      className={cx(
        "flex h-full w-full min-h-0 flex-col overflow-hidden border border-[#1f3a5f] bg-white",
        className,
      )}
    >
      {!hideTitle && (
        <h3 className="m-0 shrink-0 border-b border-slate-300 bg-[#eef2f6] px-[0.45em] py-[0.18em] text-center text-[0.72em] font-bold uppercase leading-[1.2] tracking-[0.03em] text-slate-900">
          {title}
        </h3>
      )}
      <div
        className={cx("min-h-0 flex-1 overflow-hidden", bodyClassName)}
        style={bodyStyle}
      >
        {children}
      </div>
    </section>
  );
}

export function EmptyBlockState({
  icon: Icon,
  message,
  actionLabel,
  onAction,
  compact = false,
  className,
}: EmptyBlockStateProps) {
  const stopPointerDown: PointerEventHandler<HTMLButtonElement> = (event) => {
    event.stopPropagation();
  };

  return (
    <div
      className={cx(
        "flex h-full min-h-0 flex-col items-center justify-center border border-dashed border-slate-300 bg-slate-50 text-center",
        compact ? "gap-[0.18em] p-[0.25em]" : "gap-[0.32em] p-[0.45em]",
        className,
      )}
      role="status"
    >
      <Icon
        aria-hidden="true"
        className={cx(
          "shrink-0 text-slate-400",
          compact ? "h-[1.05em] w-[1.05em]" : "h-[1.35em] w-[1.35em]",
        )}
        strokeWidth={1.7}
      />
      <p
        className={cx(
          "m-0 font-semibold leading-[1.25] text-slate-600",
          compact ? "text-[0.58em]" : "text-[0.66em]",
        )}
      >
        {message}
      </p>
      {actionLabel && (
        <button
          type="button"
          title={actionLabel}
          data-editor-chrome
          onPointerDown={stopPointerDown}
          onClick={(event) => {
            event.stopPropagation();
            onAction?.();
          }}
          className="border border-slate-300 bg-white px-[0.5em] py-[0.16em] text-[0.6em] font-medium leading-[1.2] text-slate-700 transition-colors hover:border-teal-500 hover:text-teal-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-600"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
