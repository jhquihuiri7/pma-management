import type { CartographicBlockProps } from "./shared";
import { BlockFrame } from "./shared";

export interface RefSysBlockProps extends CartographicBlockProps {
  coordinateSystem?: string;
  crs?: string;
  datum?: string;
  units?: string;
  epsg?: string | number | null;
}

export function RefSysBlock({
  coordinateSystem,
  crs,
  datum = "WGS 84",
  units = "Metros",
  epsg,
  title = "Sistema de referencia",
  ...rootProps
}: RefSysBlockProps) {
  const system = coordinateSystem ?? crs ?? "WGS 84 / UTM Zona 15S";
  const rows = [
    { label: "Sistema de coordenadas", value: system },
    { label: "Datum", value: datum },
    { label: "Unidades", value: units },
    ...(epsg != null && String(epsg).trim()
      ? [{ label: "Código", value: `EPSG:${String(epsg).replace(/^EPSG:/i, "")}` }]
      : []),
  ];

  return (
    <BlockFrame
      {...rootProps}
      title={title}
      bodyClassName="flex min-h-0 items-center px-[0.7em] py-[0.25em]"
    >
      <dl className="m-0 grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-[0.45em] gap-y-[0.12em] overflow-hidden">
        {rows.map((row) => (
          <div key={row.label} className="contents" title={`${row.label}: ${row.value}`}>
            <dt className="m-0 whitespace-nowrap text-[0.66em] leading-[1.25] text-slate-600">
              {row.label}:
            </dt>
            <dd className="m-0 min-w-0 truncate text-[0.68em] font-medium leading-[1.25] text-slate-900">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </BlockFrame>
  );
}

export default RefSysBlock;
