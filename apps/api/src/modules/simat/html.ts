/** Extract the rows of every HTML table as arrays of trimmed cell text. */
export function filasTabla(html: string): string[][] {
  const filas: string[][] = [];
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const celdas = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
      m[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim()
    );
    if (celdas.length) filas.push(celdas);
  }
  return filas;
}
