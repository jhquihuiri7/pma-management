import type { SimatFuenteInventario } from "@pma/types";

/** The source inventory shown on the Estaciones y fuentes page. */
export const FUENTES: SimatFuenteInventario[] = [
  {
    nombre: "IERSE · Universidad del Azuay",
    cobertura: "Santa Cruz",
    descripcion: "Red de sensores WSN con lluvia y clima en vivo cada ~5 min. Fuente principal de lluvia observada.",
    pendiente: "Confirmar con IERSE/UAzuay las condiciones de reuso.",
    licencia: "Datos abiertos del visor · citar IERSE/UAzuay.",
    url: "https://ierse.uazuay.edu.ec/proyectos/ierse-wsn/index.html?red=Gal%C3%A1pagos",
  },
  {
    nombre: "IOC Sea Level Monitoring (INOCAR)",
    cobertura: "Puerto Ayora / Baltra",
    descripcion: "Nivel del mar observado por mareógrafo (radar RAS), preliminar y sin datum publicado.",
    pendiente: "Definir con INOCAR el desfase al MLWS para usarlo en la matriz.",
    licencia: "UNESCO/COI–VLIZ · INOCAR.",
    url: "https://www.ioc-sealevelmonitoring.org/",
  },
  {
    nombre: "INOCAR · Tabla de mareas",
    cobertura: "Puerto Ayora / Baltra",
    descripcion: "Predicciones astronómicas de pleamar y bajamar.",
    pendiente: "Verificar condiciones de redistribución con INOCAR.",
    licencia: "INOCAR · tabla pública.",
    url: "https://www.inocar.mil.ec/web/index.php/productos/tabla-mareas",
  },
  {
    nombre: "INAMHI · Visor hidrometeorológico",
    cobertura: "Región insular",
    descripcion: "Inventario y lluvia horaria observada de las estaciones automáticas.",
    pendiente: "Verificar continuidad y calidad de las mediciones.",
    licencia: "INAMHI · citar la fuente.",
    url: "https://inamhi.gob.ec/info/",
  },
  {
    nombre: "Fundación Charles Darwin",
    cobertura: "Santa Cruz",
    descripcion: "Lluvia diaria histórica de Puerto Ayora y Bellavista (no es tiempo real).",
    pendiente: "Verificar continuidad y metadatos de las series.",
    licencia: "Descarga pública · citar FCD.",
    url: "https://datazone.darwinfoundation.org/es/clima",
  },
  {
    nombre: "METAR · Aeropuerto San Cristóbal (SEST)",
    cobertura: "San Cristóbal",
    descripcion: "Observación horaria de temperatura, viento y presión (sin cantidad de lluvia).",
    pendiente: "Complemento; sin precipitación cuantificada.",
    licencia: "NOAA · dato público.",
    url: "https://tgftp.nws.noaa.gov/data/observations/metar/stations/SEST.TXT",
  },
];
