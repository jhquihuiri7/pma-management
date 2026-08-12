import type { CartographicBlockProps } from "./shared";
import { BlockFrame } from "./shared";

export interface TechInfoField {
  id: string;
  label: string;
  value: string | number;
  visible?: boolean;
}

export interface TechInfoBlockProps extends CartographicBlockProps {
  scale?: string;
  area?: string;
  sheet?: string;
  code?: string;
  fields?: readonly TechInfoField[];
}

export function TechInfoBlock({
  scale = "1:5.000",
  area = "—",
  sheet = "1 de 1",
  code = "—",
  fields,
  title = "Información técnica",
  ...rootProps
}: TechInfoBlockProps) {
  const rows = (
    fields ?? [
      { id: "scale", label: "Escala", value: scale },
      { id: "area", label: "Área", value: area },
      { id: "sheet", label: "Hoja", value: sheet },
      { id: "code", label: "Código", value: code },
    ]
  ).filter((field) => field.visible !== false);

  return (
    <BlockFrame
      {...rootProps}
      title={title}
      bodyClassName="flex min-h-0 items-center px-[0.7em] py-[0.25em]"
    >
      <dl className="m-0 flex w-full min-w-0 flex-col justify-center gap-[0.14em] overflow-hidden">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex min-w-0 gap-[0.5em]"
            title={`${row.label}: ${row.value}`}
          >
            <dt className="m-0 w-[4.2em] shrink-0 text-[0.66em] leading-[1.25] text-slate-600">
              {row.label}:
            </dt>
            <dd className="m-0 min-w-0 flex-1 truncate text-[0.66em] font-medium leading-[1.25] text-slate-900">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </BlockFrame>
  );
}

export default TechInfoBlock;
