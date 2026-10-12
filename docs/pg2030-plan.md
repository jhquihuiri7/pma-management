# PG2030 — plan funcional

**Diseño funcional cerrado el 12 de octubre de 2026.** Ese mismo día se revisó
con una auditoría de tres lentes (fidelidad a las fuentes, coherencia y
viabilidad técnica) con verificación adversarial: de 45 hallazgos se
confirmaron 40 y ya están incorporados. Las cuatro decisiones que abrió la
auditoría también están tomadas (§13). Una segunda verificación de la
reescritura confirmó otras 14 correcciones, también incorporadas.

**Estado del código:** la fase 1 (§12) está implementada, probada y
**desplegada en producción** desde el 12 de octubre de 2026 (migraciones 0031 y
0032 aplicadas a `pma-postgres`; respaldo previo en
`~/Documentos/pma_db-backup-20261012-140115-pre-pg2030-fase1.sql`).
Las fases 2 y 3 están implementadas y probadas (migración 0033), **sin desplegar**.

Fuentes usadas para este plan:

- `resultado_final.xlsx` (raíz del repo): catálogo del Plan y matriz 2026 de
  las instituciones. Hoja `Sheet1`, 190 filas × 144 columnas.
- `6.1 Informe PG2030 2026 1T vf 10abr26.docx` (raíz del repo): informe técnico
  CGREG-DGTAR-2026-033 del primer trimestre. Es el modelo del dashboard y del
  informe que genera el sistema.

---

## 1. Objetivo

1. Cargar el Plan Galápagos 2030 hasta el nivel de proyecto.
2. Que cada institución planifique física y presupuestariamente, mes a mes, los
   proyectos donde tiene competencia.
3. Que la institución reporte cada mes lo ejecutado.
4. Que el sistema verifique planificado vs ejecutado y si la institución está
   reportando.
5. Que genere el informe trimestral completo en Word, como el de la DGTAR.

**Todo gira en torno a los 139 proyectos/acciones.** Nadie puede agregar ni
borrar proyectos.

## 2. Vocabulario

| Término | Qué es | Cantidad |
|---|---|---|
| **Meta del Plan** | Meta del catálogo (`COD_UNI_METAS`, p. ej. `G11 (M1)`) | 50 |
| **Proyecto** | Proyecto o acción del catálogo (`COD_UNI_P`, p. ej. `PG0001`) | 139 |
| **Meta institucional** | Lo que una institución se propone en un proyecto, para un año. En el informe de la DGTAR se llama simplemente "meta" | 57 en 2026 |
| **Año (ejercicio)** | Año fiscal que el administrador abre para planificar y reportar | — |
| **Corte** | Trimestre de un año (T1…T4) | 4 por año |

Una institución puede tener varias metas institucionales en un mismo proyecto
(en el Excel, SNGR tiene 5 en PG0005).

---

## 3. Catálogo del Plan

Jerarquía: Eje (5) → Objetivo (5) → Política (17) → Estrategia (43) →
Meta del Plan (50) → **Proyecto (139)**. Los niveles superiores solo sirven
para agrupar y filtrar.

| Nivel | Datos |
|---|---|
| Meta del Plan | código, texto, ¿cuantificable? (12 de 50 lo son) |
| Proyecto | código, nombre, tipo (Acción/Proyecto), plazo (Anexo 7), presupuesto referencial, tipo de entidad responsable, responsables según el plan (texto histórico), **entidades ejecutoras (actualización)**, hito 2023, hito 2030 |

- Las **entidades ejecutoras (actualización)** salen de
  `ACTUALIZACIÓN_ENTIDAD_EJECUTORA`. Es la entidad ejecutora vigente del
  proyecto, distinta de `RESPONSABLE`, que es histórico.
- Los **hitos van en el proyecto**, no en la meta: en 4 metas cambian de un
  proyecto a otro (G33, G41, H12 y H21, todas M1). Con la importación descrita
  abajo quedan **51 hitos al 2030 distintos**: el número 52 del informe ("Repotenciación
  del lado aire finalizada y operativa") solo existe en la fila 189, que se
  descarta. Tres proyectos no tienen hito 2030: PG0132, PG0136 y PG0138.
  El cuadro 1 y los Antecedentes muestran **la cifra calculada del catálogo**
  (decisión D4). La cifra cuenta los textos distintos del hito 2030, y 29 de los
  51 se repiten en varios proyectos. Si se corrige el texto de un hito
  compartido, hay que corregirlo en todos sus proyectos, o la cifra sube. El
  hito 52 del T1 no se puede recuperar: su proyecto (fila 189) no está entre los
  139 y no se pueden agregar proyectos.
- El **presupuesto referencial** tiene 5 estados:

  | Estado | Proyectos |
  |---|---|
  | Monto | 74, que suman **$101.377.000** (fuente válida) |
  | SPI | 60 |
  | No disponible | 3 |
  | Presupuesto a definirse en la LISS | 1 |
  | Sin dato | 1 (PG0049) |

  El informe del T1 decía 76 proyectos y $103.247.000; desde ahora vale el Excel.
- El **administrador puede corregir** textos y datos del catálogo, pero no
  agregar ni borrar proyectos.

### Importación inicial

Se arranca en limpio: **solo se importa el catálogo**, sin planificación ni
ejecución.

- **Cómo:** una sola vez, mediante una **migración de datos escrita a mano**
  (p. ej. `0031_pg2030_catalogo.sql`). La genera fuera de línea, desde
  `resultado_final.xlsx`, un script en `scripts/`, con las correcciones de abajo
  ya aplicadas para que se revisen en el diff.
  - Es idempotente (`INSERT … ON CONFLICT (código) DO NOTHING`).
  - Incluye CGREG como institución inicial y tiene su rollback.
  - Su `when` en `_journal.json` debe ser mayor que `1787600000000` (la 0029).
  - No hay importación desde la interfaz.
- **Correcciones:**
  - Se **descarta la fila 189**: el aeropuerto del MIT con el código PG0048,
    que también trae el objetivo erróneo `O.E.1`, otro texto para la política
    E1 y la estrategia escrita como "E12 (M1)".
  - Se recortan espacios en los códigos (`E14 (M1) `).
  - PG0123: el tipo queda "Acción", sin la fórmula pegada `PG0131+N132+O59`.
  - **Regla general:** si un campo del proyecto difiere entre filas, se toma la
    primera fila en el orden original y el conflicto queda registrado para que
    lo revise el administrador. Hoy son el nombre de PG0056, `RESPONSABLE` de
    PG0049 y PG0056 y la entidad ejecutora de unos pocos proyectos.

---

## 4. Instituciones y usuarios

- Catálogo **plano**, sin subniveles de dirección. Cada institución tiene
  nombre oficial, **sigla obligatoria y única**, tipo (Ejecutivo, GAD, otro) y
  marca de activa.
- **Catálogo inicial: una sola institución**, CGREG (Consejo de Gobierno del
  Régimen Especial de Galápagos). El administrador agrega las demás.
- **Entran los GAD.** Las direcciones distritales se tratan como CGREG: cada
  una es una institución del catálogo (p. ej. Dirección Distrital 20D01
  San Cristóbal–Santa Cruz).
- **Convocatoria anual:** al abrir un año (§7), todas las instituciones activas
  quedan marcadas como convocadas, y el administrador puede marcar o desmarcar
  instituciones. Las que se agreguen después quedan convocadas solo en el año
  abierto más reciente; en los años anteriores, el administrador puede
  marcarlas a mano. "Sin respuesta" (cuadro 2) se calcula sobre las
  convocadas.

### Vínculo usuario ↔ institución

- Al dar acceso a PG2030 a un `REPORTER`, el administrador elige su institución
  (una sola). Un `REPORTER` sin institución no puede escribir y ve un aviso.
- Al revocar PG2030 o cambiar el rol, el vínculo se elimina: hay que agregar
  `pg2030` a `revokeSubsystemState` y `revokeRoleBoundAssignments`
  (`apps/api/src/modules/shared/usersModule.ts`).
- La autoría de planificación, reportes y reaperturas se guarda con referencia
  `ON DELETE SET NULL` y una copia del nombre, como
  `pmaEvidences.uploadedBy`/`uploaderName`. Así el historial sobrevive al
  borrado de la cuenta.
- La API expone la institución del usuario (p. ej. `GET /pg2030/me`). Toda
  escritura verifica, dentro de la transacción, que la meta pertenece a esa
  institución.

### Roles

PG2030 usa los **roles globales** del sistema; no hay roles propios del módulo.

| Rol | Quién | Qué hace |
|---|---|---|
| Administrador (`ADMIN` global) | DGTAR / CGREG | Abre años, corrige el catálogo, gestiona instituciones y usuarios, puede planificar por una institución (y reportar por ella solo durante la carga inicial, §7), reabre cortes, llena la ficha del corte y regenera informes |
| Reportero (`REPORTER`) | Usuario de una institución | Elige sus proyectos, planifica y reporta. Ve el dashboard **solo de su institución** y no descarga el informe consolidado |
| Visualizador (`VIEWER`) | Autoridades, consulta | Ve el dashboard de **todas** las instituciones y descarga informes |

Todo `ADMIN` del sistema es administrador de PG2030, porque `requireApp` deja
pasar al administrador a todos los módulos. Así se decidió.

---

## 5. Planificación

Primer momento del año: la institución **elige sus proyectos** entre los 139 y
crea sus metas institucionales. El administrador también puede hacerlo por ella.

Cada meta institucional tiene:

- proyecto, año e institución;
- nombre o indicador, descripción de la meta y unidad de medida;
- fuente de financiamiento: **Corriente, Inversión o Cooperación**;
- beneficiarios directos, personal técnico involucrado, responsables internos y
  entidades en coordinación (la entidad ejecutora es un dato del proyecto, §3);
- **avance físico planificado** de enero a diciembre;
- **presupuesto planificado** de enero a diciembre;
- dos campos de solo lectura que calcula la IA (§8): categoría de contribución
  y tipo de inversión.

La **meta anual no se escribe**: es la suma de los 12 meses. Eso elimina el
error "Sumatoria no es igual a meta" del Excel. "Meta con presupuesto"
significa Σ presupuesto planificado anual > 0; los meses vacíos valen 0.

Una institución puede declarar para el año que **no tiene acciones vinculadas**
al Plan, como hicieron SRI y MINTEL. Esa declaración y tener metas se excluyen:
no se puede declarar si la institución ya tiene metas.

### Qué se puede editar

- La planificación se puede editar siempre, **salvo los valores de meses
  bloqueados** (§7).
- Una meta con valores en meses bloqueados **no se puede borrar ni cambiar de
  proyecto**. Para hacerlo, el administrador tiene que reabrir, para esa
  institución, todos los cortes en los que la meta tiene meses bloqueados.
- Los demás campos (fuente, unidad, textos) siguen editables. Si la meta tiene
  meses en cortes cerrados, cada cambio queda en la bitácora (§7) y marca como
  "modificado después del cierre" el informe de esos cortes.

## 6. Reporte mensual

Por cada meta institucional y mes:

- avance físico ejecutado;
- hitos alcanzados (texto);
- presupuesto devengado;
- observaciones (texto).

**Sin verificables:** no se sube ningún archivo.

- Los valores son **del mes, no acumulados**. Al final se suman.
- No hay plazo por mes: la institución llena cuando quiere, antes de que
  venza el plazo del corte.
- Un mes cuenta como **reportado** solo cuando el usuario lo guarda, aunque sea
  con 0. Así se distingue "reportó 0" de "no reportó". En los acumulados, un mes
  no guardado vale 0.
- **Aviso de acumulado** (no bloquea): aparece si en un mes (a) hay ejecutado
  mayor que 0 con planificado 0, o (b) el ejecutado es al menos el doble de lo
  planificado. Dice "¿Estás reportando acumulado? Reporta solo lo del mes". Es
  el error de MINEDEC en el Excel. No existe una opción para excluir datos del
  análisis, así que hay que atajarlo al guardar.

## 7. Años, cortes, bloqueo y reapertura

### Años y cortes

- **El administrador abre cada año.** Solo los años abiertos tienen metas,
  cortes y cierres automáticos. Los años no se cierran.
- **Primer año de operación: 2026, desde el T2** (decisión D1). El
  administrador va a cargar los datos a mano para contrastarlos con los
  resultados que ya tiene.
- **Al abrir un año, el administrador elige el primer corte habilitado.** Los
  cortes anteriores quedan **"no habilitados"**: no se evalúan, no generan
  informe y el dashboard muestra "Sin datos".
- **Los meses de un corte no habilitado van con el primer corte habilitado**
  para el bloqueo, la reapertura y la marca "modificado después del cierre": se
  bloquean con él y se reabren al reabrirlo. En 2026, enero a marzo van con el
  T2.
- La planificación del año N está disponible desde que se abre. En enero
  conviven el T4 del año N−1 (abierto hasta el 31 de enero) y la planificación
  del año N.
- Un corte habilitado **sin ninguna meta a reportar** se cierra igual, pero no
  genera informe automático. El administrador puede generarlo a mano.

| Corte | Meses | Plazo para completar |
|---|---|---|
| T1 | ene–mar | 30 de abril |
| T2 | abr–jun | 31 de julio |
| T3 | jul–sep | 31 de octubre |
| T4 | oct–dic | 31 de enero del año siguiente |

### Carga inicial

Hay carga inicial cuando, al abrir el año, el plazo de algún corte habilitado ya
venció. En 2026 es el T2 y, según cuándo arranque el sistema, también el T3 o el
T4.

- **Fecha límite de carga:** el administrador la fija al abrir el año y es
  común a todas las instituciones.
  - Entran en la carga todos los cortes habilitados cuyo plazo base cae antes de
    esa fecha, también los que vencen durante la carga. Ninguno se bloquea ni
    genera informe antes de que llegue.
  - Solo se puede ampliar mientras no haya vencido. Después, toda corrección se
    hace con una reapertura.
- **Qué se puede editar:** hasta esa fecha, **todos los meses desde enero hasta
  el fin del último corte de la carga**, incluidos los de cortes no habilitados.
  En 2026 eso abarca enero a marzo, que el acumulado del T2 necesita.
- **Quién reporta:** dentro de la carga inicial, el **administrador también
  puede reportar por una institución**. Fuera de ella, reporta solo la
  institución.
- **Al vencer la fecha:** esos cortes se bloquean y se generan sus informes,
  igual que en un cierre normal.
- **Antes de cargar 2026,** el administrador tiene que agregar todas las
  instituciones convocadas ese año, incluidas las que declararon no tener
  acciones (SRI, MINTEL) y las que no respondieron. Cuando corresponda, registra
  por ellas la declaración "sin acciones". El catálogo arranca solo con CGREG.

**Diferencias esperadas al contrastar con los resultados de la DGTAR.** No son
errores del sistema:

1. La categoría de contribución la asigna la IA (Tabla 2).
2. Una meta sin nada planificado hasta el corte no es "a reportar", y una sin
   programación física no entra en el promedio físico (§9.2, §9.7). En el T1,
   MDN figura con 3 metas y 98,33 %. Con estas reglas serían 2 metas y 97,50 %,
   porque PG0019 no tiene nada planificado de enero a marzo, y el total pasaría
   de 80,22 % a 80,10 %.
3. El tope de 100 % se aplica en todas las tablas. MAGP figura con 107,9 % en la
   Tabla 5 del T1 y aquí da 85,68 %, como en su Tabla 3.
4. No hay exclusión manual: una institución que la DGTAR excluyó (SNGR en el T1)
   entra en los cálculos.
5. La columna de coherencia dice "Sin financiamiento" donde el T1 decía "Sin
   presupuesto definido" (ANT y MPCEI).
6. Los cuadros 2 y 3 incluyen GAD, CGREG y direcciones distritales. Para
   comparar con el informe hay que filtrar por tipo Ejecutivo.
7. Los hitos y el presupuesto referencial salen del catálogo (§3).

### Bloqueo

- **No depende de ningún proceso:** la API lo evalúa en cada escritura, dentro de
  la transacción. Un mes del corte C queda bloqueado para la institución I (si C
  no está habilitado, se usa el primer corte habilitado) si
  "ahora" es igual o posterior al plazo efectivo de (C, I). El plazo efectivo es
  el mayor entre el plazo base, la fecha límite de carga inicial (si el corte
  está en ella) y la fecha límite de una reapertura vigente.
- **"Fin del día"** quiere decir que el mes queda bloqueado desde las 00:00 del
  día siguiente en `Pacific/Galapagos`. Por ejemplo, el plazo del 30 de abril
  vence el 2026-05-01T06:00Z.
- **El worker solo detecta los cortes recién vencidos** para disparar la
  generación del informe, de forma idempotente. Si el worker está caído, el
  bloqueo sigue funcionando.
- **Bloquea a todos, también al administrador.** El administrador solo edita
  meses bloqueados mediante una reapertura, para que todo cambio quede con
  motivo.

### Reapertura

- El **administrador reabre** un corte para una institución, a pedido suyo, con
  un motivo y una nueva fecha límite. Al vencer esa fecha se vuelve a bloquear.
- **Bitácora:** se registra quién reabrió, cuándo, por qué y qué cambió.
- **Efecto en los informes:** un cambio en un mes de un corte cerrado marca como
  "modificado después del cierre" el informe de ese corte **y el de todos los
  cortes cerrados posteriores del mismo año**, porque comparten el acumulado.

---

## 8. IA de clasificación

Proveedor: endpoint compatible con OpenAI de NVIDIA,
`https://integrate.api.nvidia.com/v1`, modelo `deepseek-ai/deepseek-v4.1-flash`,
con un tiempo máximo por llamada. La clave `NVIDIA_API_KEY` vive **solo en el
servidor**. Se llama desde Node; no hace falta Python.

Cada meta institucional tiene **una** categoría de cada tipo. Ambas son de
**solo lectura**: nadie las edita, ni el administrador, y nadie puede pedir
otro análisis. Los prompts ya están probados y se copian **literalmente**
(anexo A).

| Campo | Valores |
|---|---|
| Contribución | Contribución directa, Contribución complementaria, Alineación relativa, Sin alineación |
| Tipo de inversión | Adquisición de bienes, Bienes-servicios, Estudios, Obras, Servicios, Contratación de personal, Sin datos |

### Entradas

Se arman igual que en las pruebas del usuario:

- `meta` ← texto de la **Meta del Plan** del proyecto.
- `contexto` ← lo que llena la institución, unido con " - ": meta institucional
  (nombre y descripción), beneficiarios directos y, de cada mes reportado, hitos
  alcanzados y observaciones.

### Cola y reintentos

- **La solicitud se guarda en la base,** en la misma transacción en que se
  guarda la planificación o el reporte, con estado pendiente y la huella de la
  entrada. Solo se crea si la huella cambió.
- **El worker procesa la cola periódicamente,** con el patrón de
  `mail_outbox_jobs`: `lockedAt`, `attempts` y espera creciente entre intentos.
  Mientras tanto la meta muestra "Analizando…".
- **Los errores del proveedor** (red, 429, 5xx, tiempo agotado o falta de
  clave) **se reintentan siempre** con espera creciente. Nunca son un fallo
  final.
- **Las respuestas fuera de la lista cerrada** se reintentan hasta N veces.
  Después la meta queda "Pendiente de clasificación" hasta que cambie su huella.
- Si el administrador corrige el texto de una Meta del Plan, se vuelven a
  encolar las metas institucionales de sus proyectos.

### Interpretación de la respuesta

- Antes de interpretar se quitan los cercos de código y los bloques de
  razonamiento que el modelo pueda devolver.
- Se compara contra la lista cerrada. Se toleran comillas, punto final,
  mayúsculas y el paréntesis "(Alineación parcial)".
- En contribución, **"Sin datos" equivale a "Sin alineación"**.

### Qué clasificación usa cada informe

- El informe del corte usa, por cada meta, la clasificación de **la última
  solicitud creada antes del plazo efectivo** de su institución (§7), aunque se
  haya calculado después.
- No hace falta ningún proceso al vencer el plazo. Cada solicitud guarda su
  huella y su hora de creación y, a diferencia de `mail_outbox_jobs`, no se
  borra al procesarse. El worker no descarta una solicitud porque la meta tenga
  otra más nueva.
- Si el corte se reabre, vale la última solicitud anterior al nuevo plazo
  efectivo.

---

## 9. Reglas de cálculo

Todas estas reglas se calculan **solo en la API**, con las mismas funciones
para el dashboard y para el informe. El web solo muestra los valores
calculados.

### 9.1 Acumulado

Todo se acumula **desde enero hasta el fin del trimestre** del corte. Un mes no
guardado vale 0.

### 9.2 Por meta institucional, al corte

- **Avance físico** = Σ ejecutado ÷ Σ planificado, con **tope de 100 %**.
- **Avance presupuestario** = Σ devengado computable ÷ Σ planificado, con
  **tope de 100 %**.
- **Devengado computable** = min(Σ devengado, Σ planificado) de cada meta, como
  hizo el T1 (decisión D3). El devengado real, sin tope, se muestra aparte como
  dato informativo en el detalle de la institución y en el anexo Excel.

**Denominador 0:**

| Caso | Resultado |
|---|---|
| Σ físico planificado = 0 y Σ ejecutado = 0 | "Sin programación física al corte": no entra en los promedios físicos ni lleva semáforo |
| Σ físico planificado = 0 y Σ ejecutado > 0 | "Ejecutado sin programación": no entra en los promedios y aparece como alerta en el detalle de la institución |
| Σ presupuesto planificado = 0 | "No aplica": no entra en el promedio presupuestario. Con devengado > 0, alerta "Devengado sin programación" |

Cualquier total o promedio cuyo denominador sea 0 se muestra "No aplica", como
la Cooperación en la Tabla 4 del T1.

### 9.3 Qué metas entran en cada cuadro

Igual que el T1 (decisión D2). Es una regla automática, no una opción de
excluir:

| Cuadro | Metas que entran |
|---|---|
| 2 (planificación del año) | Todas las metas del año |
| 3 (cumplimiento del reporte) | Las metas a reportar en el corte |
| 4 a 8, semáforo y coherencia | Solo las metas **reportadas** en el corte |

- Las metas a reportar que no se reportaron no entran en promedios ni en sumas
  (no cuentan como 0). Aparecen aparte, con su número y su presupuesto
  planificado, como "% del presupuesto previsto sin reporte" (el 9 % del T1).
- Una institución sin metas reportadas no aparece en los cuadros 5 y 7.

### 9.4 Agregación

| Nivel | Cálculo |
|---|---|
| Institución, físico | Promedio simple de sus metas con avance físico calculable |
| Institución, presupuesto | Promedio simple de sus metas con Σ planificado > 0. Si no tiene ninguna: "Sin presupuesto definido". Así se reproduce el 87,56 % de MDN en el T1 |
| Total físico | Promedio simple de los promedios institucionales. Aplicado a los promedios de la Tabla 3 del T1, da su 80,22 % |
| Con filtro de eje o de tipo de institución | Cada cuadro se recalcula con las mismas reglas, solo con las metas que pasan el filtro. El promedio de cada institución usa solo esas metas, y el total físico (la línea del cuadro 5) es el promedio simple de esos promedios |
| Totales en dólares (general, por fuente, por tipo de inversión) | Σ devengado computable ÷ Σ planificado de las metas que entran |

El avance físico **no se suma** entre metas: las unidades son distintas.

**Caso de prueba (Tabla 4 del T1):** $252.771,42 ÷ $423.485,42 = 59,69 %. Esas
son las cifras de la tabla; el párrafo del informe redondea distinto. Con el
devengado real, sin tope, daría 60,07 %, y ARCOTEL pasaría de "Coherente" a
"Incoherencia: brecha".

El informe del T1 mezcla cifras con y sin tope (MAGP: 85,68 % en la Tabla 3 y
107,9 % en la Tabla 5). El sistema aplica el tope siempre.

### 9.5 Semáforo

Se aplica al avance físico y al presupuestario, en los niveles de meta,
institución, fuente, tipo de inversión y total. Se clasifica sobre el valor con
tope y sin redondear, en intervalos sin huecos:

| Color | Clasificación | Rango |
|---|---|---|
| Verde | Avance esperado | ≥ 85 % |
| Amarillo | Avance cercano al esperado | ≥ 70 % y < 85 % |
| Rojo | Avance menor al esperado | > 0 % y < 70 % |
| — | Sin avance | 0 % |

"No reportó" se muestra aparte de "0 %".

### 9.6 Coherencia físico vs presupuesto, por institución

Se evalúa en este orden y gana la primera condición que se cumpla:

1. Sin avance físico calculable → **No aplica**.
2. Avance físico = 0 y sin presupuesto definido → **No aplica**.
3. Avance físico > 0 y (sin presupuesto definido o devengado computable = 0) →
   **Sin financiamiento**.
4. |físico − presupuestario| ≤ 5 puntos → **Coherente**.
5. En otro caso → **Incoherencia: brecha**.

El dashboard y el Word usan un solo rótulo, "Sin financiamiento", en la
columna de coherencia.

### 9.7 Cumplimiento del reporte

- **A reportar en Tn:** Σ físico planificado + Σ presupuesto planificado, de
  enero al fin de Tn, mayor que 0.
- **Reportada en Tn:** los 3 meses del trimestre n están guardados. No se exigen
  los meses de cortes anteriores ya cerrados.
- **Por institución y corte:**

  | Estado | Regla |
  |---|---|
  | Obligada | Tiene al menos una meta a reportar |
  | Cumplió | Reportó todas sus metas a reportar |
  | Parcial | Reportó algunas |
  | No cumplió | No reportó ninguna |

  % de cumplimiento = reportadas ÷ a reportar.
- **Un corte todavía abierto** aparece como "En curso" y se calcula solo con
  los meses ya terminados.

### 9.8 Formato

Hay un solo formateador para el dashboard, el Word y los datos que recibe la IA:
`es-EC`, 2 decimales, redondeo hacia arriba en el medio. Ejemplos: "59,69 %",
"$252.771,42". Los conteos van con numerador y denominador.

---

## 10. Dashboard

**Filtros:** año, corte, eje, institución y tipo de institución. El filtro de
eje se aplica a los cuadros 3 a 8 y a las metas del cuadro 2. No cambia el
cuadro 1 ni los conteos de instituciones "sin acciones" y "sin respuesta".

**Detalle de institución:** al hacer clic en una institución se ve cada meta con
su semáforo, lo planificado, lo ejecutado y sus alertas.

El reportero solo ve su institución.

| # | Cuadro | Origen en el informe | Presentación |
|---|---|---|---|
| 1 | Resumen del Plan: ejes, objetivos, políticas, metas, hitos, proyectos y presupuesto referencial | Antecedentes | Tarjetas |
| 2 | Planificación del año: instituciones convocadas con metas, que declararon sin acciones y sin respuesta; metas institucionales; % con presupuesto | 6a | Tarjetas y lista |
| 3 | Cumplimiento del reporte: obligadas, cumplió, parcial y no cumplió; detalle por institución | 2b, Tabla 5 | Tarjetas y tabla |
| 4 | Alineación por eje, por categoría de contribución (más la columna "Pendiente de clasificación" si la hay) | Tabla 2 | Barras apiladas y tabla |
| 5 | Avance físico por institución | Tabla 3 | Barras horizontales con semáforo y línea del promedio |
| 6 | Presupuesto por fuente de financiamiento | Tabla 4 | Barras de planificado vs devengado y tabla |
| 7 | Coherencia físico vs presupuesto por institución | Tabla 5, pág. 13 | Dispersión con franja de ±5 puntos y tabla |
| 8 | Presupuesto por tipo de inversión, filtrable por fuente | Nuevo | Barras de planificado vs devengado y tabla |

Además, el cuadro 6 muestra:
- las metas a reportar con presupuesto planificado al corte;
- las metas con presupuesto que reportaron;
- el % del presupuesto previsto sin reporte;
- la cantidad de instituciones por color del semáforo presupuestario, incluida
  "Sin presupuesto definido".

**Opcionales, no confirmados:** cobertura de los 139 proyectos por eje y
evolución de T1 a T4.

---

## 11. Informe trimestral en Word

### Plantilla

El Word del T1 no es una plantilla: es un informe ya lleno y sin marcadores.

- Se **deriva de él una plantilla versionada** en el repo
  (`apps/api/assets/pg2030/`), sin cifras ni tablas y con un marcador por bloque
  generado: portada, párrafos de resultados, tablas, gráficos, conclusiones y
  firmas.
- Conserva logos, encabezados y estilos de título.
- Se activa `w:updateFields` en `settings.xml` para que Word actualice el índice
  al abrir el informe.
- **Los textos fijos se adaptan al alcance del sistema,** porque entran GAD y
  otras instituciones:
  - En toda la plantilla (título de 2a, títulos y textos de las secciones 3, 5 y
    6 y párrafos generados de Resultados), "función ejecutiva" e "instituciones
    del Ejecutivo" pasan a "instituciones públicas" o "gestión pública".
  - La Metodología se reescribe a partir del T1 para que coincida con §9: la
    Tabla 1 con los intervalos de §9.5 y "No reportó" aparte; las cuatro
    categorías de contribución, incluida "Sin alineación"; los estados de
    coherencia de §9.6, incluido "No aplica"; y el tope de 100 % en el avance
    físico y en el devengado.
  - Se quita el párrafo de reportes "excluidos del análisis cuantitativo",
    porque el sistema no excluye datos.

| Sección | Cómo se llena |
|---|---|
| Portada | Ficha del corte: número y fecha del informe. Asunto y período salen del corte |
| 1. Marco legal | Texto global y versionado, editable por el administrador |
| 2. Antecedentes | Plantilla con cifras automáticas; los oficios salen de la ficha del corte |
| 3. Metodología, 4. Limitaciones, 5. Objetivo | Texto fijo, reescrito para coincidir con §9 (ver arriba) |
| 6. Resultados | Automático: párrafos con cifras y Tablas 2 a 6, **cada una seguida de su gráfico**. La Tabla 6 es el cuadro 8 (tipo de inversión) y va después de la Tabla 4 |
| 7. Conclusiones, 8. Recomendaciones | **Las genera la IA** (anexo B) |
| 9. Anexos | La matriz consolidada en Excel. El Word la cita por nombre de archivo y se descargan juntos |
| 10. Firmas | Firmantes globales y versionados (nombre, cargo, rol: elaboró o revisó y aprobó) |

### Ficha del corte

- Por cada corte, el administrador puede editar **en cualquier momento** el
  número del informe, la fecha y la lista de oficios (número y fecha).
- Si al generar falta un dato, el informe sale igual con un marcador visible
  ("[completar]") y queda marcado "Datos de portada incompletos". Se completa la
  ficha y se regenera.

### Generación y versiones

- **Generación automática:** al vencer el plazo del corte, en el worker.
  - Espera, hasta un máximo (p. ej. 24 h), a que no quede ninguna meta del corte
    en "Analizando…".
  - Si pasa ese máximo, genera igual. La Tabla 2 y los cuadros 4 y 8 llevan la
    columna "Pendiente de clasificación", y el informe queda marcado
    "Clasificaciones pendientes".
- **Regeneración:** el administrador puede regenerar el informe del corte que
  elija, y se recalcula con los datos actuales.
  - Si la huella del informe no cambió desde la última versión, sale igual.
  - La huella cubre los valores del corte, las clasificaciones usadas, la
    ficha, el marco legal y los firmantes vigentes, las cifras del catálogo, la
    convocatoria y las declaraciones "sin acciones" del año. Completar la ficha,
    terminar clasificaciones pendientes o corregir el catálogo cambian el
    informe aunque la bitácora no registre nada.
  - Solo los cambios registrados en la bitácora marcan el informe como
    "modificado después del cierre".
- **Dónde corre:** toda generación corre en el worker: la automática, la manual
  de un corte sin metas a reportar (§7) y la regeneración. La API solo guarda la
  solicitud en la base y muestra su estado ("En cola", "Generando", "Lista",
  "Error"). La versión nueva aparece cuando el worker termina.
- **Versiones:** cada generación o regeneración crea una **versión nueva y
  numerada** (Word y Excel), con fecha, quién la generó y la huella de los
  datos. Las anteriores siguen descargables y el dashboard ofrece la última.
- **Almacenamiento:** los archivos van al storage del NAS en
  `PG2030/informes/{año}/T{n}/v{k}/`, con rutas armadas solo con ids.
- **Descarga:** por un endpoint propio de PG2030 (`requireApp` más rol `ADMIN` o
  `VIEWER`), no por `/storage`, cuyo proxy solo sirve GEO, PMA y RGDP
  (`apps/api/src/routes/storage.ts`).

### Gráficos

Los dibuja el servidor con los colores del dashboard, sin que nadie tenga que
abrirlo. La técnica se elige en la fase 6 (§12).

### Conclusiones y recomendaciones

- **Qué recibe la IA:** las cifras ya calculadas del corte y del anterior, nunca
  datos crudos. Van formateadas como se imprimen (§9.8) e incluyen los conteos
  derivados con su total: metas por categoría de contribución, instituciones
  por estado de coherencia, por color de semáforo y por cumplimiento. También el
  año y el corte.
- **Antes de interpretar la respuesta:** se quitan los cercos de código y los
  bloques de razonamiento, y se valida la forma: de 3 a 5 elementos por lista.
- **Verificación de cifras:** cada número del texto tiene que estar en los datos
  o ser una constante permitida: el año del corte, el año anterior, 2030, el
  número del trimestre y los umbrales de la metodología (5, 70, 84,9, 85, 100).
  Se normalizan el separador decimal y el símbolo % antes de comparar.
  - Si algo no calza, se reintenta.
  - Si vuelve a fallar, el informe queda marcado "Revisar conclusiones".
- **Reutilización:** el texto se guarda con la huella de los datos; si al
  regenerar no cambió nada, se reutiliza.
- **No se edita en el sistema.** Si hace falta un ajuste, se hace en el Word
  descargado antes de firmar.
- El texto del prompt aprobado no cambia.

---

## 12. Fases de implementación (propuesta)

1. **Catálogo e instituciones** ✅ (desplegada el 12 de octubre de 2026):
   - tablas (`0031_pg2030_catalog_schema`) y migración de datos del catálogo,
     con CGREG (`0032_pg2030_catalog_data`, generada por
     `scripts/pg2030/generate-catalog-migration.mjs`);
   - pantallas de catálogo e instituciones;
   - vínculo usuario ↔ institución.
2. **Planificación** ✅ (implementada, sin desplegar):
   - apertura de años, convocatoria anual, primer corte habilitado y carga
     inicial;
   - metas institucionales, con sus reglas de edición;
   - elección de proyectos;
   - declaración "sin acciones vinculadas".
3. **Reporte mensual y cortes** ✅ (implementada, sin desplegar):
   - grilla mensual y aviso de acumulado;
   - bloqueo en la API;
   - reapertura y bitácora;
   - prueba unitaria del límite de plazo, incluido el T4 (31 de enero del año
     siguiente).
4. **IA de clasificación:** cola en base de datos, worker, reintentos e
   interpretación de respuestas.
5. **Dashboard:** los 8 cuadros y el detalle por institución.
6. **Informe Word:**
   - plantilla derivada del T1, ficha del corte y textos globales;
   - gráficos;
   - conclusiones con IA;
   - anexo Excel, versiones y endpoint de descarga.

### Notas técnicas

- **Migraciones:** se escriben a mano desde la `0030`, con su entrada en
  `_journal.json` y su reversa en `rollback/`.
- **Dev y prod comparten Postgres:**
  - Antes de aplicar una migración, `pg_dump`.
  - Los trabajos de PG2030 en el worker (clasificación IA, detección de cortes
    vencidos y generación de informes) se activan con una variable
    (p. ej. `PG2030_JOBS_ENABLED`). Está apagada por defecto y solo se enciende
    en `docker-compose.yml`. Si no, levantar el stack de dev ejecutaría código en
    desarrollo sobre la base y el NAS de producción. Las solicitudes pendientes
    quedan en la cola y se procesan en prod.
  - Las pruebas de clasificación, plazos e informe se corren contra una base
    desechable y una carpeta de storage aparte, nunca contra `pma-postgres`.
- **`NVIDIA_API_KEY`:** se declara en `apps/api/src/lib/env.ts` con valor vacío
  por defecto y un aviso, igual que `PREVIENE_API_KEY`. Se pasa al entorno del
  worker, que es quien llama a la IA.
- **Dependencias del informe:** hoy la API y el worker no tienen librerías para
  llenar un Word, escribir un Excel ni dibujar gráficos. `docx`, `xlsx` y
  `recharts` son del web y no entran en esas imágenes.
  - Agregar `docx` (para `patchDocument` sobre la plantilla) y `exceljs` (para
    el anexo) a `apps/api/package.json`.
  - Reconstruir las imágenes dev y prod de api y worker, porque las
    `node_modules` están horneadas en la imagen.
  - La imagen del api no lleva la plantilla ni `NVIDIA_API_KEY`, así que no
    genera informes.
  - Copiar la plantilla con un `COPY` en `apps/api/Dockerfile.worker`: `tsc` no
    la emite.
- **Gráficos del Word:** elegir en la fase 6 entre gráficos nativos de Word
  incluidos en la plantilla (con sus series reescritas al generar) o una
  rasterización de SVG a PNG.
  - Si se usa un rasterizador con binarios nativos (`@resvg/resvg-js`, `sharp`),
    hay que quitar `--omit=optional` de `apps/api/Dockerfile.worker` o instalar
    explícitamente el paquete `linux-x64-gnu`.
  - Hay que empaquetar una fuente (p. ej. Carlito), porque `bookworm-slim` no
    trae fuentes.
  - Probar la generación con la imagen de producción del worker antes de cerrar
    la fase.
- **Zona horaria:** `Pacific/Galapagos` (UTC−6, sin horario de verano), la misma
  constante `BUSINESS_TIME_ZONE` que usan PMA y RGDP
  (`apps/api/src/modules/pma/planSchedule.ts:11`).
- **Constantes compartidas:** los colores y etiquetas del semáforo y de las
  categorías se definen en la API y viajan al web junto con los datos. `@pma/types`
  solo sirve para tipos, no para constantes en tiempo de ejecución.

## 13. Decisiones

### Cerradas el 12 de octubre de 2026

- **Instituciones:** el catálogo arranca solo con CGREG; el administrador
  agrega el resto.
- **Prompt de conclusiones** (anexo B): aprobado.
- **Roles:** los globales. Todo `ADMIN` administra PG2030 y el visualizador ve
  todas las instituciones.
- **Reporte mensual:** no lleva "Situación actual del proyecto".
- **"Sin acciones vinculadas":** la institución puede declararlo para el año.

### Después de la auditoría

- **D1 — Primer año:** 2026 desde el T2. El administrador carga los datos a mano
  para contrastarlos con los resultados que ya tiene (§7, carga inicial).
- **D2 — Metas no reportadas:** quedan fuera de promedios y sumas, como en el T1
  (§9.3).
- **D3 — Tope del presupuesto:** el devengado de cada meta se limita a lo
  planificado, como en el T1 (§9.2).
- **D4 — Hitos al 2030:** se muestra la cifra calculada del catálogo (51 hoy)
  (§3).

Solo siguen sin decidir los cuadros opcionales del §10 (cobertura y evolución).

---

## Anexo A — prompts de clasificación (probados, copiar literal)

Los placeholders son `{meta}` y `{contexto}`.

### Contribución

```
Actúa como analista de planificación estratégica del Régimen Especial de Galápagos.

Vas a recibir:

1. Una meta institucional (formulada por una entidad pública).
2. Un texto de referencia (relacionado con el Plan Galápagos 2030, sus ejes, objetivos, indicadores o hitos).

Tu tarea es analizar la relación entre la meta institucional y el texto proporcionado y determinar el nivel de alineación, utilizando exclusivamente los siguientes criterios:

Contribución directa (Alineación total):
La meta institucional coincide plenamente con los indicadores, hitos u objetivos estratégicos del Plan 2030. Existe una relación causal clara y verificable. Si se cumple la meta institucional, se impacta directamente en los indicadores del Plan.

Contribución complementaria (Alineación parcial):
La meta apoya el cumplimiento del objetivo estratégico, pero no lo cubre en su totalidad o se enfoca en un componente específico (administrativo, operativo, logístico, técnico, etc.). Contribuye al resultado final de forma indirecta o secundaria.

Alineación relativa (Alineación programática):
La meta está dentro de las competencias de los ejes del Plan Galápagos 2030, pero su indicador no suma directamente a los hitos o metas estratégicas de largo plazo. Es gestión pública válida, pero su impacto en el Plan es difícil de cuantificar.

Sin alineación: (Sin datos)
El contexto no tiene información suficiente para determinar una relación directa, complementaria o relativa con la meta institucional. No se puede asumir impacto alguno en el Plan Galápagos 2030 basado en la información proporcionada.

Datos de referencia:
META INSTITUCIONAL: {meta}
TEXTO DE REFERENCIA: {contexto}

Reglas importantes:

* No reformules las categorías.
* No combines categorías.
* Selecciona únicamente una.
* Basa tu análisis únicamente en la información proporcionada.
* Si la información es insuficiente para determinar alineación directa, no asumas impacto; evalúa según evidencia explícita.


Debes responder unicamente con la categoría que corresponda a la relación entre la meta institucional y el texto de referencia, siguiendo estrictamente los criterios definidos.: Contribución directa, Contribución complementaria o Alineación relativa
```

### Tipo de inversión

```
Actúa como analista de planificación estratégica del Régimen Especial de Galápagos.

Vas a recibir:

1. Una meta institucional (formulada por una entidad pública).
2. Un texto de referencia (relacionado con el Plan Galápagos 2030, sus ejes, objetivos, indicadores o hitos).

Tu tarea es analizar la relación entre la meta institucional y el texto proporcionado y determinar el tipo de inversión, utilizando exclusivamente los siguientes criterios:

-Adquisición de bienes
-Bienes-servicios
-Estudios 
-Obras
-Servicios
-Contratación de personal


Datos de referencia:
META INSTITUCIONAL: {meta}
TEXTO DE REFERENCIA: {contexto}

Reglas importantes:

* No reformules las categorías.
* No combines categorías.
* Selecciona únicamente una, si no hay información suficiente para determinarla entonces responde con "Sin datos".
* Basa tu análisis únicamente en la información proporcionada.
* Si la información es insuficiente para determinar alineación directa, no asumas impacto; evalúa según evidencia explícita.


Debes responder unicamente con la categoría que corresponda a la relación entre la meta institucional y el texto de referencia, siguiendo estrictamente los criterios definidos.: Adquisición de bienes, Bienes-servicios, Estudios, Obras, Servicios o Contratación de personal
```

## Anexo B — prompt de conclusiones (aprobado)

- `{ejemplos}`: las secciones 7 y 8 del informe del T1, copiadas literalmente.
- `{datos}` y `{datos_anteriores}`: las cifras calculadas de los cuadros 2 a 8 en
  JSON, ya formateadas (§9.8) y con los conteos derivados (§11).
  `{datos_anteriores}` vale "No existe" cuando no hay corte anterior.

```
Actúa como analista de planificación estratégica de la Dirección de Gestión de Territorio, Ambiente y Riesgos (DGTAR) del Consejo de Gobierno del Régimen Especial de Galápagos.

Vas a recibir los resultados ya calculados del seguimiento al Plan Galápagos 2030 para el corte {corte}, y los del corte anterior si existe.

Tu tarea es redactar las secciones "Conclusiones" y "Recomendaciones" del informe técnico de ese corte.

Reglas importantes:

* Usa únicamente las cifras de los DATOS. No calcules cifras nuevas, no redondees de otra forma y no inventes datos.
* Escribe cada porcentaje y cada monto exactamente como aparece en los DATOS.
* Nombra a las instituciones por su sigla.
* Las conclusiones describen lo que muestran los datos: cumplimiento del reporte, alineación con el Plan, avance físico, ejecución presupuestaria (por fuente y por tipo de inversión) y coherencia entre avance físico y presupuestario.
* Si hay datos del corte anterior, compara solo cuando el cambio sea relevante.
* Las recomendaciones proponen acciones concretas para la DGTAR y las instituciones, y se derivan de las conclusiones.
* Escribe entre 3 y 5 conclusiones y entre 3 y 5 recomendaciones, una por viñeta, en español formal.
* Sigue el estilo de los EJEMPLOS, pero no copies sus cifras.

EJEMPLOS:
{ejemplos}

DATOS DEL CORTE {corte}:
{datos}

DATOS DEL CORTE ANTERIOR:
{datos_anteriores}

Responde únicamente con un JSON con esta forma:
{"conclusiones": ["...", "..."], "recomendaciones": ["...", "..."]}
```
