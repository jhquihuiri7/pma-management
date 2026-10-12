"use client";

import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";

type Location = NonNullable<ClientLocation>;
type ClientLocation = {
  lat: number;
  lng: number;
  snapshot: string;
  layer: "Mapa" | "Satélite";
} | null;

const TOWNS = [
  { name: "San Cristóbal", lat: -0.9025, lng: -89.6106 },
  { name: "Santa Cruz", lat: -0.743, lng: -90.313 },
  { name: "Isabela", lat: -0.956, lng: -90.9675 },
  { name: "Floreana", lat: -1.274, lng: -90.489 },
];

export default function LocationPicker({ value, onChange }: {
  value: ClientLocation;
  onChange: (value: ClientLocation) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const leaflet = useRef<typeof Leaflet | null>(null);
  const marker = useRef<Leaflet.Marker | null>(null);
  const tiles = useRef<Leaflet.TileLayer | null>(null);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  const layerRef = useRef<Location["layer"]>(value?.layer ?? "Mapa");
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [locating, setLocating] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [layer, setLayer] = useState<Location["layer"]>(value?.layer ?? "Mapa");
  const [lat, setLat] = useState(value ? String(value.lat) : "");
  const [lng, setLng] = useState(value ? String(value.lng) : "");

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { valueRef.current = value; }, [value]);
  useEffect(() => { layerRef.current = layer; }, [layer]);

  function choose(latitude: number, longitude: number) {
    onChangeRef.current({
      lat: Number(latitude.toFixed(6)),
      lng: Number(longitude.toFixed(6)),
      snapshot: "",
      layer: layerRef.current,
    });
    setMessage("Punto seleccionado. Confirma que corresponde a la vivienda.");
  }

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((module) => {
      if (cancelled || !container.current) return;
      const L = module.default ?? module;
      leaflet.current = L;
      const initial = valueRef.current;
      const instance = L.map(container.current, { scrollWheelZoom: false }).setView(
        initial ? [initial.lat, initial.lng] : [TOWNS[0].lat, TOWNS[0].lng],
        initial ? 17 : 13,
      );
      instance.on("click", (event: Leaflet.LeafletMouseEvent) => choose(event.latlng.lat, event.latlng.lng));
      map.current = instance;
      setReady(true);
    }).catch(() => setMessage("No se pudo cargar el mapa. Puedes escribir las coordenadas."));
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
      tiles.current = null;
    };
    // The map is created once; value changes are handled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const L = leaflet.current;
    const instance = map.current;
    if (!ready || !L || !instance) return;
    tiles.current?.remove();
    tiles.current = L.tileLayer(
      layer === "Mapa"
        ? "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        : "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 19,
        crossOrigin: true,
        attribution: layer === "Mapa"
          ? "© OpenStreetMap contributors"
          : "© Esri, Maxar, Earthstar Geographics",
      },
    ).addTo(instance);
  }, [ready, layer]);

  useEffect(() => {
    setLat(value ? String(value.lat) : "");
    setLng(value ? String(value.lng) : "");
    const L = leaflet.current;
    const instance = map.current;
    if (!ready || !L || !instance) return;
    if (!value) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current) {
      marker.current = L.marker([value.lat, value.lng], { draggable: true }).addTo(instance);
      marker.current.on("dragend", () => {
        const point = marker.current!.getLatLng();
        choose(point.lat, point.lng);
      });
    } else {
      marker.current.setLatLng([value.lat, value.lng]);
    }
    instance.panTo([value.lat, value.lng]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, value?.lat, value?.lng]);

  function applyCoordinates() {
    const latitude = Number(lat.replace(",", "."));
    const longitude = Number(lng.replace(",", "."));
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      setMessage("Revisa las coordenadas ingresadas.");
      return;
    }
    choose(latitude, longitude);
    map.current?.setView([latitude, longitude], 17);
  }

  function locate() {
    if (!navigator.geolocation) {
      setMessage("El navegador no ofrece ubicación. Marca el punto en el mapa.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition((position) => {
      choose(position.coords.latitude, position.coords.longitude);
      map.current?.setView([position.coords.latitude, position.coords.longitude], 17);
      setMessage(`Ubicación aproximada: ${Math.round(position.coords.accuracy)} m de precisión.`);
      setLocating(false);
    }, () => {
      setMessage("No fue posible obtener tu ubicación. Puedes marcarla manualmente.");
      setLocating(false);
    }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
  }

  function changeLayer(next: Location["layer"]) {
    layerRef.current = next;
    setLayer(next);
    if (value) onChange({ ...value, layer: next, snapshot: "" });
  }

  async function captureMap() {
    const instance = map.current;
    const current = valueRef.current;
    if (!instance || !container.current || !current) {
      setMessage("Selecciona primero la ubicación de la vivienda.");
      return;
    }
    setCapturing(true);
    setMessage("Preparando la vista del mapa…");
    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 350));
      const bounds = container.current.getBoundingClientRect();
      const scale = Math.min(1, 1200 / Math.max(bounds.width, bounds.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bounds.width * scale));
      canvas.height = Math.max(1, Math.round(bounds.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.fillStyle = "#e8efec";
      context.fillRect(0, 0, canvas.width, canvas.height);

      const images = Array.from(container.current.querySelectorAll<HTMLImageElement>(".leaflet-tile"));
      const loaded = images.filter((image) => image.complete && image.naturalWidth > 0);
      if (!loaded.length) throw new Error("Tiles unavailable");
      loaded.forEach((image) => {
        const tileBounds = image.getBoundingClientRect();
        context.drawImage(
          image,
          (tileBounds.left - bounds.left) * scale,
          (tileBounds.top - bounds.top) * scale,
          tileBounds.width * scale,
          tileBounds.height * scale,
        );
      });

      const point = instance.latLngToContainerPoint([current.lat, current.lng]);
      const pinX = point.x * scale;
      const pinY = point.y * scale;
      context.beginPath();
      context.arc(pinX, pinY - 9 * scale, 8 * scale, 0, Math.PI * 2);
      context.fillStyle = "#d74235";
      context.fill();
      context.strokeStyle = "white";
      context.lineWidth = 2 * scale;
      context.stroke();
      context.beginPath();
      context.moveTo(pinX - 5 * scale, pinY - 3 * scale);
      context.lineTo(pinX, pinY + 7 * scale);
      context.lineTo(pinX + 5 * scale, pinY - 3 * scale);
      context.fillStyle = "#d74235";
      context.fill();

      context.fillStyle = "rgba(255, 255, 255, 0.88)";
      context.fillRect(0, canvas.height - 22, canvas.width, 22);
      context.fillStyle = "#27413d";
      context.font = `${Math.max(10, 11 * scale)}px sans-serif`;
      context.fillText(
        `${current.lat.toFixed(6)}, ${current.lng.toFixed(6)} · ${layerRef.current}`,
        7,
        canvas.height - 7,
      );

      const snapshot = canvas.toDataURL("image/jpeg", 0.72);
      if (snapshot.length > 1_500_000) throw new Error("Snapshot too large");
      onChangeRef.current({ ...current, layer: layerRef.current, snapshot });
      setMessage("Vista del mapa incluida en el PDF.");
    } catch {
      setMessage("No se pudo capturar el mapa. Las coordenadas sí quedarán guardadas en el PDF.");
    } finally {
      setCapturing(false);
    }
  }

  return (
    <div className="pf-location">
      <div className="pf-map-toolbar">
        <label>Ir a una isla
          <select onChange={(event) => {
            const town = TOWNS[Number(event.target.value)];
            map.current?.setView([town.lat, town.lng], 13);
          }}>
            {TOWNS.map((town, index) => <option key={town.name} value={index}>{town.name}</option>)}
          </select>
        </label>
        <div className="pf-segmented">
          <button type="button" className={layer === "Mapa" ? "active" : ""} onClick={() => changeLayer("Mapa")}>Mapa</button>
          <button type="button" className={layer === "Satélite" ? "active" : ""} onClick={() => changeLayer("Satélite")}>Satélite</button>
        </div>
        <button type="button" className="pf-button pf-button-secondary" onClick={locate} disabled={locating}>
          {locating ? "Buscando…" : "Usar mi ubicación"}
        </button>
      </div>
      <div ref={container} className="pf-map" aria-label="Mapa para ubicar la vivienda" />
      <div className="pf-grid">
        <label className="pf-field"><span>Latitud</span><input value={lat} onChange={(event) => setLat(event.target.value)} placeholder="-0.902500" inputMode="decimal" /></label>
        <label className="pf-field"><span>Longitud</span><input value={lng} onChange={(event) => setLng(event.target.value)} placeholder="-89.610600" inputMode="decimal" /></label>
      </div>
      <div className="pf-inline-actions">
        <button type="button" className="pf-button pf-button-secondary" onClick={applyCoordinates}>Ubicar coordenadas</button>
        {value && <button type="button" className="pf-button pf-button-secondary" onClick={captureMap} disabled={capturing}>
          {capturing ? "Capturando…" : value.snapshot ? "Actualizar vista para el PDF" : "Incluir vista en el PDF"}
        </button>}
        {value && <button type="button" className="pf-link-button" onClick={() => onChange(null)}>Quitar ubicación</button>}
      </div>
      {value && <p className="pf-map-selection">
        Punto guardado: {value.lat.toFixed(6)}, {value.lng.toFixed(6)}
        {value.snapshot ? " · Vista incluida" : ""}
      </p>}
      {message && <p className="pf-status" role="status">{message}</p>}
    </div>
  );
}
