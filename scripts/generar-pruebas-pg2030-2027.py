#!/usr/bin/env python3
"""Genera un libro FODS/XLSX de carga manual para probar PG2030 2027."""
import html
import os
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / os.environ.get("PG2030_SALIDA", "PG2030_Pruebas_Planificacion_2027.xlsx")
TARGET_SIGLAS = {x.strip() for x in os.environ.get("PG2030_INSTITUCIONES", "").split(",") if x.strip()}
ACTIVITIES_PER_INSTITUTION = int(os.environ.get("PG2030_ACTIVIDADES", "3"))

HEADERS = [
    "PROGRAMA/\nPROYECTO/\nACCIÓN", "INDICADOR", "META", "PRESUPUESTO ANUAL",
    "ALINEACIÓN NRO. META PG2030", "ALINEACIÓN META PG2030", "ALINEACIÓN PROYECTO PG2030",
    "PROYECTO PG2030", "FUENTE_DE_FINANCIAMIENTO", "RESPONSABLES_INTERNOS_DE_LA_ENTIDAD",
    "NÚMERO_BENEFICIARIOS_DIRECTOS", "NÚMERO_DE_PERSONAL_TÉCNICO_INVOLUCRADO",
]
MONTHS = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"]
HEADERS += [f"AVANCE_FISICO_PLANIFICADO_{m}" for m in MONTHS]
HEADERS += ["AVANCE_FISICO_PLANIFICADO_ANUAL", "VALIDACIÓN AVANCE FÍSICO PLANIFICADO"]
HEADERS += [f"PRESUPUESTO_PLANIFICADO_{m}" for m in MONTHS]
HEADERS += ["AVANCE_PRESUPUESTARIO_PLANIFICADO_ANUAL", "VALIDACIÓN AVANCE PRESUPUESTARIO PLANIFICADO", "OBSERVACIONES"]

def query(sql):
    cmd = ["docker", "compose", "exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "pma_db", "-At", "-F", "\t", "-c", sql]
    return subprocess.check_output(cmd, cwd=ROOT, text=True).splitlines()

instituciones = [line.split("\t") for line in query("select sigla,nombre from pg2030_instituciones where activa=true order by sigla;")]
if TARGET_SIGLAS:
    instituciones = [i for i in instituciones if i[0] in TARGET_SIGLAS]
proyectos = [line.split("\t") for line in query("select codigo,nombre from pg2030_proyectos order by codigo;")]
proyectos = proyectos[:9]
DETALLE_PRUEBA = {
    "PG0001": ("Trámites administrativos desconcentrados atendidos", "Implementación de mejoras en la desconcentración administrativa"),
    "PG0002": ("Procesos institucionales revisados y actualizados", "Reingeniería y actualización de procesos institucionales"),
    "PG0003": ("Servicios públicos digitalizados", "Automatización y fortalecimiento de servicios públicos"),
    "PG0004": ("Reuniones de coordinación interinstitucional realizadas", "Coordinación y seguimiento de acciones provinciales"),
    "PG0005": ("Personas capacitadas en gestión de riesgos", "Fortalecimiento de capacidades para respuesta ante emergencias"),
    "PG0006": ("Acciones de coordinación para protección ambiental ejecutadas", "Coordinación para la protección del patrimonio natural"),
    "PG0007": ("Reportes de seguimiento de planificación emitidos", "Seguimiento periódico de la planificación provincial"),
    "PG0008": ("Controles preventivos de contratación realizados", "Prevención y control de buenas prácticas de contratación"),
    "PG0009": ("Espacios de participación ciudadana desarrollados", "Fortalecimiento de la participación ciudadana"),
}

def cell(value):
    value = "" if value is None else str(value)
    return f'<c t="inlineStr"><is><t xml:space="preserve">{html.escape(value)}</t></is></c>'

def number(value):
    return f'<c t="n"><v>{value}</v></c>'

def row(values):
    def col(n):
        out = ""
        while n:
            n, rem = divmod(n - 1, 26)
            out = chr(65 + rem) + out
        return out
    cells = []
    for i, value in enumerate(values):
        if isinstance(value, (int, float)):
            cells.append(f'<c r="{col(i + 1)}"><v>{value}</v></c>')
        else:
            cells.append(f'<c r="{col(i + 1)}" t="inlineStr"><is><t xml:space="preserve">{html.escape(str(value))}</t></is></c>')
    return "<row>" + "".join(cells) + "</row>"

def sheet_name(sigla):
    safe = "".join(ch for ch in sigla if ch not in "[]:*?/\\")
    return safe[:31] or "Institucion"

tables = []
for inst_index, (sigla, nombre) in enumerate(instituciones):
    rows = [row(HEADERS)]
    for activity in range(ACTIVITIES_PER_INSTITUTION):
        codigo, proyecto = proyectos[(inst_index * 3 + activity) % len(proyectos)]
        indicador, actividad = DETALLE_PRUEBA.get(codigo, (f"Productos entregados vinculados a {codigo}", f"Actividad institucional vinculada a {codigo}"))
        meta = 12 + inst_index + activity * 6
        presupuesto = 18000 + inst_index * 750 + activity * 3250
        fisico = [0, 0, 1, 1, 1, 1, 2, 2, 2, 1, 1, 0]
        fisico = [round(x * meta / sum(fisico), 4) for x in fisico]
        fisico[-1] = round(meta - sum(fisico[:-1]), 4)
        pesos = [0, 0, 0.10, 0.10, 0.10, 0.10, 0.15, 0.15, 0.10, 0.05, 0.05, 0.00]
        presupuesto_mes = [round(presupuesto * p, 2) for p in pesos]
        presupuesto_mes[-1] = round(presupuesto - sum(presupuesto_mes[:-1]), 2)
        values = [
            f"{actividad} — {sigla}",
            indicador, meta, presupuesto,
            "", "", codigo, proyecto, ["Corriente", "Inversión", "Cooperación"][activity % 3],
            f"Unidad técnica de planificación de {sigla}", 25 + inst_index * 3 + activity * 5, 2 + activity,
        ]
        values += fisico + ["", ""] + presupuesto_mes + ["", "", "Dato ficticio para pruebas de carga manual 2027"]
        rows.append(row(values))
    tables.append((sheet_name(sigla), "<sheetData>" + "".join(rows) + "</sheetData>"))

def xlsx_xml():
    files = {}
    files["[Content_Types].xml"] = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + "".join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1, len(tables) + 1)) + '</Types>'
    files["_rels/.rels"] = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    sheets = "".join(f'<sheet name="{html.escape(name)}" sheetId="{i}" r:id="rId{i}"/>' for i, (name, _) in enumerate(tables, 1))
    files["xl/workbook.xml"] = '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets + '</sheets></workbook>'
    files["xl/_rels/workbook.xml.rels"] = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + "".join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1, len(tables) + 1)) + '</Relationships>'
    for i, (_, data) in enumerate(tables, 1):
        files[f"xl/worksheets/sheet{i}.xml"] = '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:AO4"/><sheetData>' + data[len("<sheetData>"):-len("</sheetData>")] + '</sheetData></worksheet>'
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items(): z.writestr(name, data)

xlsx_xml()
print(OUT)
