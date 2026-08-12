import type { CartographicBlockProps } from "./shared";
import { cx } from "./shared";

export type DocumentationFieldId =
  | "elaborated"
  | "reviewed"
  | "date"
  | "source"
  | "precision"
  | "notes";

export interface DocumentationField {
  id: DocumentationFieldId | (string & {});
  label: string;
  value: string;
  visible?: boolean;
}

export interface DocsBlockProps extends CartographicBlockProps {
  elaboratedBy?: string;
  reviewedBy?: string;
  date?: string;
  source?: string;
  precision?: string;
  notes?: string;
  visibility?: Partial<Record<DocumentationFieldId, boolean>>;
  fields?: readonly DocumentationField[];
  emptyValue?: string;
}

export function DocsBlock({
  elaboratedBy = "Dirección Técnica de Planificación",
  reviewedBy = "Dirección Distrital",
  date = "—",
  source = "Información geográfica institucional",
  precision = "—",
  notes = "",
  visibility = {},
  fields,
  emptyValue = "—",
  title = "Bloque documental",
  className,
  ...rootProps
}: DocsBlockProps) {
  const documentationFields = (
    fields ?? [
      { id: "elaborated", label: "Elaborado por", value: elaboratedBy },
      { id: "reviewed", label: "Revisado por", value: reviewedBy },
      { id: "date", label: "Fecha", value: date },
      { id: "source", label: "Fuente", value: source },
      { id: "precision", label: "Precisión", value: precision },
      { id: "notes", label: "Notas", value: notes },
    ]
  ).filter((field) => {
    if (field.visible === false) return false;
    const fieldVisibility = visibility[field.id as DocumentationFieldId];
    return fieldVisibility !== false;
  });

  return (
    <section
      {...rootProps}
      title={title}
      aria-label={title}
      className={cx(
        "flex h-full w-full min-h-0 overflow-hidden border border-[#1f3a5f] bg-white",
        className,
      )}
    >
      <dl
        className="m-0 grid min-h-0 flex-1 items-start overflow-hidden p-[0.35em_0.2em]"
        style={{
          gridTemplateColumns: `repeat(${Math.max(1, documentationFields.length)}, minmax(0, 1fr))`,
        }}
      >
        {documentationFields.length > 0 ? (
          documentationFields.map((field, index) => (
            <div
              key={field.id}
              className={cx(
                "min-w-0 overflow-hidden px-[0.5em]",
                index > 0 && "border-l border-slate-200",
              )}
              title={`${field.label}: ${field.value || emptyValue}`}
            >
              <dt className="m-0 truncate text-[0.6em] font-bold uppercase leading-[1.2] tracking-[0.04em] text-teal-700">
                {field.label}
              </dt>
              <dd className="mb-0 mt-[0.15em] max-h-[3.9em] overflow-hidden text-[0.62em] leading-[1.3] text-slate-800">
                {field.value || emptyValue}
              </dd>
            </div>
          ))
        ) : (
          <div className="col-span-full flex h-full items-center justify-center text-[0.66em] font-medium text-slate-500">
            Sin campos documentales visibles
          </div>
        )}
      </dl>
    </section>
  );
}

export default DocsBlock;
