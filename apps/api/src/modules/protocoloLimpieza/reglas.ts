// The module's rules, shared with the web (routes, forms, fields and the
// validation of every report). Imported by relative path on purpose: the API
// runs compiled on Node 20, which cannot load the "@pma/types" package's .ts
// sources at runtime, while tsc emits this file into dist/ with the API.
export * from "../../../../../packages/types/src/protocoloLimpieza.js";
