import type {
  GeoAttributeFieldSchema,
  GeoLayerAttributeSchema,
} from "@pma/types/geo";
import type { Feature, FeatureCollection, Geometry, GeoJsonProperties, Position } from "geojson";
import { BadRequest } from "../../lib/errors.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const FIELD_KEY_RE = /^[^\u0000-\u001f\u007f]{1,200}$/;

export function inferAttributeSchema(collection: FeatureCollection): GeoLayerAttributeSchema {
  const keys = Array.from(new Set(collection.features.flatMap((feature) => Object.keys(feature.properties ?? {}))));
  const fields: GeoAttributeFieldSchema[] = keys.map((key) => {
    const values = collection.features.map((feature) => feature.properties?.[key]);
    const present = values.filter((value) => value !== null && value !== undefined && value !== "");
    let type: GeoAttributeFieldSchema["type"] = "string";
    if (present.length > 0 && present.every((value) => typeof value === "boolean")) type = "boolean";
    else if (present.length > 0 && present.every((value) => typeof value === "number" && Number.isInteger(value))) type = "integer";
    else if (present.length > 0 && present.every((value) => typeof value === "number" && Number.isFinite(value))) type = "number";
    else if (present.length > 0 && present.every((value) => typeof value === "string" && DATE_RE.test(value))) type = "date";
    else if (present.length > 0 && present.every((value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value))) type = "datetime";
    return {
      key,
      label: key,
      type,
      required: present.length === values.length,
      unique: false,
      readOnly: false,
      ...(type === "string" ? { maxLength: 5_000 } : {}),
    };
  });
  return { version: 1, fields, geometry: { maxVertices: 10_000, extent: null } };
}

export function assertValidAttributeSchema(value: GeoLayerAttributeSchema): GeoLayerAttributeSchema {
  if (value.version !== 1 || !Array.isArray(value.fields) || !value.geometry) {
    throw BadRequest("El esquema de captura no es válido.");
  }
  if (value.fields.length > 500) throw BadRequest("El esquema supera el máximo de 500 columnas.");
  const keys = new Set<string>();
  for (const field of value.fields) {
    if (!FIELD_KEY_RE.test(field.key) || field.key === "__proto__" || field.key === "constructor" || field.key === "prototype") {
      throw BadRequest(`Nombre de columna no permitido: ${field.key}`);
    }
    if (keys.has(field.key)) throw BadRequest(`La columna ${field.key} está duplicada.`);
    keys.add(field.key);
    if (!field.label.trim() || field.label.length > 200) throw BadRequest(`La etiqueta de ${field.key} no es válida.`);
    if (!["string", "integer", "number", "date", "datetime", "boolean"].includes(field.type)) {
      throw BadRequest(`Tipo no permitido en ${field.key}.`);
    }
    if (field.maxLength !== undefined && (!Number.isInteger(field.maxLength) || field.maxLength < 1 || field.maxLength > 100_000)) {
      throw BadRequest(`Longitud máxima inválida en ${field.key}.`);
    }
    if (field.min !== undefined && !Number.isFinite(field.min)) throw BadRequest(`Mínimo inválido en ${field.key}.`);
    if (field.max !== undefined && !Number.isFinite(field.max)) throw BadRequest(`Máximo inválido en ${field.key}.`);
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) throw BadRequest(`Rango inválido en ${field.key}.`);
    if (field.pattern !== undefined) {
      if (field.pattern.length > 200) throw BadRequest(`La expresión de ${field.key} es demasiado larga.`);
      try { new RegExp(field.pattern, "u"); } catch { throw BadRequest(`La expresión de ${field.key} no es válida.`); }
    }
    if (field.allowedValues && (field.allowedValues.length > 1_000 || field.allowedValues.some((item) => !isPrimitive(item)))) {
      throw BadRequest(`Los valores permitidos de ${field.key} no son válidos.`);
    }
    const derived = field.derived;
    if (derived?.kind === "yearFromDate") {
      const source = value.fields.find((candidate) => candidate.key === derived.sourceField);
      if (!source) throw BadRequest(`El campo fuente de ${field.key} no existe.`);
      if (source.type !== "date" && source.type !== "datetime") throw BadRequest(`El campo fuente de ${field.key} debe ser una fecha.`);
    }
  }
  if (!Number.isInteger(value.geometry.maxVertices) || value.geometry.maxVertices < 1 || value.geometry.maxVertices > 100_000) {
    throw BadRequest("El máximo de vértices debe estar entre 1 y 100000.");
  }
  if (value.geometry.extent) {
    const [minX, minY, maxX, maxY] = value.geometry.extent;
    if (![minX, minY, maxX, maxY].every(Number.isFinite) || minX < -180 || maxX > 180 || minY < -90 || maxY > 90 || minX > maxX || minY > maxY) {
      throw BadRequest("La extensión de captura no es válida.");
    }
  }
  return value;
}

export function validateAndBuildFeature(args: {
  featureId: string;
  properties: Record<string, unknown>;
  geometry: unknown;
  geometryType: "Point" | "LineString" | "Polygon";
  schema: GeoLayerAttributeSchema;
  existingFeatures: Feature[];
}): Feature {
  const geometry = validateGeometry(args.geometry, args.geometryType, args.schema.geometry.maxVertices, args.schema.geometry.extent);
  const properties = validateProperties(args.properties, args.schema, geometry, args.existingFeatures);
  return { type: "Feature", id: args.featureId, properties, geometry };
}

function validateProperties(
  raw: Record<string, unknown>,
  schema: GeoLayerAttributeSchema,
  geometry: Geometry,
  existingFeatures: Feature[],
): GeoJsonProperties {
  if (!isRecord(raw)) throw BadRequest("Los atributos deben ser un objeto.");
  const allowed = new Map(schema.fields.map((field) => [field.key, field]));
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw BadRequest(`La columna ${key} no pertenece a la capa.`);
  }

  const result: Record<string, string | number | boolean | null> = {};
  for (const field of [...schema.fields.filter((field) => !field.derived), ...schema.fields.filter((field) => field.derived)]) {
    let value = raw[field.key];
    if (field.readOnly && value !== undefined && value !== null && value !== "") {
      throw BadRequest(`La columna ${field.label} es calculada o de solo lectura.`);
    }
    if (field.derived) value = derivedValue(field, geometry, result);
    else if ((value === undefined || value === "") && field.defaultValue !== undefined) value = field.defaultValue;
    if (value === undefined || value === null || value === "") {
      if (field.required) throw BadRequest(`La columna ${field.label} es obligatoria.`);
      result[field.key] = null;
      continue;
    }
    const normalized = normalizeFieldValue(field, value);
    if (field.allowedValues && !field.allowedValues.some((candidate) => candidate === normalized)) {
      throw BadRequest(`${field.label} no contiene un valor permitido.`);
    }
    if (field.unique && existingFeatures.some((feature) => sameValue(feature.properties?.[field.key], normalized))) {
      throw BadRequest(`${field.label} debe ser único dentro de la capa.`);
    }
    result[field.key] = normalized;
  }
  return result;
}

function normalizeFieldValue(field: GeoAttributeFieldSchema, value: unknown): string | number | boolean {
  if (field.type === "boolean") {
    if (typeof value !== "boolean") throw BadRequest(`${field.label} debe ser verdadero o falso.`);
    return value;
  }
  if (field.type === "integer" || field.type === "number") {
    const number = typeof value === "number" ? value : (typeof value === "string" && value.trim() !== "" ? Number(value) : NaN);
    if (!Number.isFinite(number) || (field.type === "integer" && !Number.isInteger(number))) {
      throw BadRequest(`${field.label} debe ser ${field.type === "integer" ? "un número entero" : "numérico"}.`);
    }
    if (field.min !== undefined && number < field.min) throw BadRequest(`${field.label} no puede ser menor que ${field.min}.`);
    if (field.max !== undefined && number > field.max) throw BadRequest(`${field.label} no puede ser mayor que ${field.max}.`);
    return number;
  }
  if (typeof value !== "string") throw BadRequest(`${field.label} debe ser texto.`);
  const text = value.trim();
  if (field.type === "date" && (!DATE_RE.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`)))) {
    throw BadRequest(`${field.label} debe ser una fecha válida (AAAA-MM-DD).`);
  }
  if (field.type === "datetime" && (!DATETIME_RE.test(text) || Number.isNaN(Date.parse(text)))) {
    throw BadRequest(`${field.label} debe ser una fecha y hora ISO válida.`);
  }
  if (field.maxLength !== undefined && text.length > field.maxLength) throw BadRequest(`${field.label} supera ${field.maxLength} caracteres.`);
  if (field.pattern && !(new RegExp(field.pattern, "u")).test(text)) throw BadRequest(`${field.label} no cumple el formato requerido.`);
  return text;
}

function derivedValue(field: GeoAttributeFieldSchema, geometry: Geometry, values: Record<string, unknown>): unknown {
  if (!field.derived) return undefined;
  if (field.derived.kind === "latitude" || field.derived.kind === "longitude") {
    if (geometry.type !== "Point") throw BadRequest(`${field.label} solo puede calcularse para una capa de puntos.`);
    return geometry.coordinates[field.derived.kind === "longitude" ? 0 : 1];
  }
  const source = values[field.derived.sourceField];
  if (typeof source !== "string" || !/^\d{4}/.test(source)) throw BadRequest(`No se pudo calcular ${field.label}.`);
  return Number(source.slice(0, 4));
}

function validateGeometry(
  raw: unknown,
  expectedType: "Point" | "LineString" | "Polygon",
  maxVertices: number,
  extent?: [number, number, number, number] | null,
): Geometry {
  if (!isRecord(raw) || raw.type !== expectedType || !("coordinates" in raw)) {
    throw BadRequest(`La geometría debe ser ${expectedType}.`);
  }
  const coordinates = raw.coordinates;
  let positions: Position[] = [];
  if (expectedType === "Point") {
    positions = [assertPosition(coordinates)];
  } else if (expectedType === "LineString") {
    if (!Array.isArray(coordinates) || coordinates.length < 2) throw BadRequest("La línea requiere al menos dos vértices.");
    positions = coordinates.map(assertPosition);
    if (distinctPositions(positions).length < 2) throw BadRequest("La línea requiere dos vértices diferentes.");
  } else {
    if (!Array.isArray(coordinates) || coordinates.length === 0) throw BadRequest("El polígono requiere un anillo exterior.");
    const rings = coordinates.map((ring, index) => validateRing(ring, index));
    positions = rings.flat();
    if (Math.abs(ringArea(rings[0])) < 1e-14) throw BadRequest("El polígono no puede tener área cero.");
    for (let index = 1; index < rings.length; index++) {
      if (!pointInRing(rings[index][0], rings[0])) throw BadRequest("Los huecos deben estar dentro del polígono.");
      if (ringsIntersect(rings[0], rings[index])) throw BadRequest("Un hueco no puede cruzar el borde exterior.");
      for (let other = 1; other < index; other++) {
        if (ringsIntersect(rings[other], rings[index]) || pointInRing(rings[index][0], rings[other]) || pointInRing(rings[other][0], rings[index])) {
          throw BadRequest("Los huecos del polígono no pueden cruzarse ni superponerse.");
        }
      }
    }
  }
  if (positions.length > maxVertices) throw BadRequest(`La geometría supera el máximo de ${maxVertices} vértices.`);
  if (extent && positions.some(([x, y]) => x < extent[0] || x > extent[2] || y < extent[1] || y > extent[3])) {
    throw BadRequest("La geometría está fuera del área de captura permitida.");
  }
  return { type: expectedType, coordinates } as Geometry;
}

function assertPosition(raw: unknown): Position {
  if (!Array.isArray(raw) || raw.length !== 2 || typeof raw[0] !== "number" || typeof raw[1] !== "number" || !Number.isFinite(raw[0]) || !Number.isFinite(raw[1])) {
    throw BadRequest("Cada vértice debe contener longitud y latitud numéricas.");
  }
  if (raw[0] < -180 || raw[0] > 180 || raw[1] < -90 || raw[1] > 90) throw BadRequest("Hay coordenadas fuera de EPSG:4326.");
  return [raw[0], raw[1]];
}

function validateRing(raw: unknown, index: number): Position[] {
  if (!Array.isArray(raw) || raw.length < 4) throw BadRequest(`El anillo ${index + 1} requiere al menos cuatro posiciones.`);
  const ring = raw.map(assertPosition);
  if (!samePosition(ring[0], ring[ring.length - 1])) throw BadRequest(`El anillo ${index + 1} debe estar cerrado.`);
  if (distinctPositions(ring.slice(0, -1)).length < 3) throw BadRequest(`El anillo ${index + 1} requiere tres vértices diferentes.`);
  if (ring.slice(1).some((position, positionIndex) => samePosition(position, ring[positionIndex]))) {
    throw BadRequest(`El anillo ${index + 1} contiene vértices consecutivos duplicados.`);
  }
  if (ringSelfIntersects(ring)) throw BadRequest(`El anillo ${index + 1} se cruza consigo mismo.`);
  return ring;
}

function ringArea(ring: Position[]): number {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index++) area += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
  return area / 2;
}

function ringSelfIntersects(ring: Position[]): boolean {
  const segmentCount = ring.length - 1;
  for (let first = 0; first < segmentCount; first++) {
    for (let second = first + 1; second < segmentCount; second++) {
      if (Math.abs(first - second) <= 1 || (first === 0 && second === segmentCount - 1)) continue;
      if (segmentsIntersect(ring[first], ring[first + 1], ring[second], ring[second + 1])) return true;
    }
  }
  return false;
}

function ringsIntersect(first: Position[], second: Position[]): boolean {
  for (let a = 0; a < first.length - 1; a++) for (let b = 0; b < second.length - 1; b++) {
    if (segmentsIntersect(first[a], first[a + 1], second[b], second[b + 1])) return true;
  }
  return false;
}

function segmentsIntersect(a: Position, b: Position, c: Position, d: Position): boolean {
  const orient = (p: Position, q: Position, r: Position) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  const on = (p: Position, q: Position, r: Position) => q[0] >= Math.min(p[0], r[0]) && q[0] <= Math.max(p[0], r[0]) && q[1] >= Math.min(p[1], r[1]) && q[1] <= Math.max(p[1], r[1]);
  return (o1 === 0 && on(a, c, b)) || (o2 === 0 && on(a, d, b)) || (o3 === 0 && on(c, a, d)) || (o4 === 0 && on(c, b, d));
}

function pointInRing(point: Position, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distinctPositions(positions: Position[]): Position[] {
  return Array.from(new Map(positions.map((position) => [`${position[0]},${position[1]}`, position])).values());
}

function samePosition(a: Position, b: Position): boolean { return a[0] === b[0] && a[1] === b[1]; }
function sameValue(a: unknown, b: unknown): boolean { return typeof a === typeof b && JSON.stringify(a) === JSON.stringify(b); }
function isPrimitive(value: unknown): value is string | number | boolean { return typeof value === "string" || typeof value === "number" || typeof value === "boolean"; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

export function bboxForFeatures(features: Feature[]): [number, number, number, number] {
  const bbox: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      bbox[0] = Math.min(bbox[0], value[0]); bbox[1] = Math.min(bbox[1], value[1]);
      bbox[2] = Math.max(bbox[2], value[0]); bbox[3] = Math.max(bbox[3], value[1]);
    } else value.forEach(visit);
  };
  features.forEach((feature) => feature.geometry && "coordinates" in feature.geometry && visit(feature.geometry.coordinates));
  if (!Number.isFinite(bbox[0])) throw BadRequest("La capa no contiene coordenadas válidas.");
  return bbox;
}
