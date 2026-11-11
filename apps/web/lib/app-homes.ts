import type { AppKey } from "@pma/types";

/**
 * Where each subsystem starts. The select-app cards link here and the login
 * sends a user with a single app straight here, so both always agree.
 *
 * Not every app lives at `/<key>/dashboard`: the login used to assume so and
 * sent single-app users of Previene, Plan Familiar and Gestión de Riesgos to a
 * page that does not exist. tests/app-homes.test.ts checks that every entry
 * is an existing page.
 */
export const APP_HOME: Readonly<Record<AppKey, string>> = {
  pma: "/pma/dashboard",
  rgdp: "/rgdp/dashboard",
  geo: "/geo/dashboard",
  previene: "/previene",
  pg2030: "/pg2030/dashboard",
  plan_familiar: "/plan-familiar/resultados",
  riesgos: "/riesgos/admin",
  protocolo_limpieza: "/protocolo-limpieza",
};
