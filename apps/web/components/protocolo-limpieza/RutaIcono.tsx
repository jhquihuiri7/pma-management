import Image from "next/image";
import { routeIconSrc } from "@/lib/protocolo-limpieza/tablero";

/**
 * Icon of a route: the scene of its point on the map, without background
 * (public/protocolo-limpieza/mapa). A route in execution gets the green dot of
 * the map; `animado` swaps in the animated scene (the caller decides, so it can
 * honour the system's reduced motion).
 */
export function RouteIcon({ route, size = 40, enEjecucion = false, animado = false }: {
  route: string;
  size?: number;
  enEjecucion?: boolean;
  animado?: boolean;
}) {
  return (
    <span className={`route-icon${enEjecucion ? " is-live" : ""}`} style={{ width: size, height: size }}>
      <Image src={routeIconSrc(route, animado)} alt="" width={size} height={size} unoptimized />
      {enEjecucion && <span className="route-live" aria-hidden="true" />}
    </span>
  );
}

export function RouteTag({ route, size = 34 }: { route: string; size?: number }) {
  return (
    <span className="route-tag">
      <RouteIcon route={route} size={size} />
      <span className="tag">{route}</span>
    </span>
  );
}
