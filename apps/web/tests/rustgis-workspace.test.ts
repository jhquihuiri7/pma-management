import assert from "node:assert/strict";
import test from "node:test";
import { BridgeError, parseBridgeMessage, RustgisBridge } from "../components/geo/rustgis/bridge";
import { absoluteUrl, catalogKeyOfUrl, inspectProject, withTileLayer } from "../components/geo/rustgis/projectRefs";

const ORIGIN = "https://sigtar.gobiernogalapagos.gob.ec";
const V1 = "11111111-1111-4111-8111-111111111111";
const R1 = "33333333-3333-4333-8333-333333333333";

class FakeWindow {
  listeners = new Set<(event: MessageEvent) => void>();
  addEventListener(_type: "message", listener: (event: MessageEvent) => void) { this.listeners.add(listener); }
  removeEventListener(_type: "message", listener: (event: MessageEvent) => void) { this.listeners.delete(listener); }
  dispatch(data: unknown, source: unknown, origin = ORIGIN) {
    this.listeners.forEach((l) => l({ data, source, origin } as MessageEvent));
  }
}

class FakeFrame {
  sent: Array<{ message: Record<string, unknown>; origin: string }> = [];
  postMessage(message: unknown, origin: string) { this.sent.push({ message: message as Record<string, unknown>, origin }); }
}

test("the bridge takes messages only from its frame and its origin", async () => {
  const host = new FakeWindow();
  const frame = new FakeFrame();
  const bridge = new RustgisBridge({ target: () => frame, origin: ORIGIN, host });
  const ready = bridge.whenReady(1000);
  host.dispatch({ rustgis: "ready" }, {}, ORIGIN); // another window
  host.dispatch({ rustgis: "ready" }, frame, "https://evil.example"); // another origin
  assert.equal(bridge.isReady, false);
  host.dispatch({ rustgis: "ready" }, frame, ORIGIN);
  await ready;
  assert.equal(bridge.isReady, true);

  const projects: string[] = [];
  bridge.onProject((t) => projects.push(t));
  host.dispatch({ rustgis: "project", text: "{}" }, frame);
  host.dispatch({ rustgis: "project", text: 5 }, frame);
  assert.deepEqual(projects, ["{}"]);
  bridge.close();
});

test("run and openProject are answered by id; errors and timeouts reject", async () => {
  const host = new FakeWindow();
  const frame = new FakeFrame();
  const bridge = new RustgisBridge({ target: () => frame, origin: ORIGIN, host });
  const added = bridge.run("ui.addUrl", { url: "https://x/data.fgb" });
  const sent = frame.sent[0]!;
  assert.equal(sent.origin, ORIGIN);
  assert.equal(sent.message.rustgis, "run");
  assert.equal(sent.message.command, "ui.addUrl");
  host.dispatch({ rustgis: "result", id: sent.message.id, ok: true, value: null }, frame);
  assert.equal(await added, null);

  const opened = bridge.openProject("{\"maps\":[]}");
  const projectMessage = frame.sent[1]!.message;
  assert.equal(projectMessage.rustgis, "project");
  host.dispatch({ rustgis: "result", id: projectMessage.id, ok: false, error: "invalid project" }, frame);
  await assert.rejects(opened, (e: unknown) => e instanceof BridgeError && e.kind === "app" && /invalid project/.test(e.message));

  const slow = bridge.run("ui.theme", {}, 5);
  await assert.rejects(slow, (e: unknown) => e instanceof BridgeError && e.kind === "timeout");
  bridge.close();
  await assert.rejects(bridge.run("ui.theme"), (e: unknown) => e instanceof BridgeError && e.kind === "closed");
});

test("timers are called as plain functions, as a browser's setTimeout requires", async () => {
  // A browser's setTimeout called as a method of another object throws
  // "Illegal invocation"; Node's doesn't, so the browser's is imitated here.
  function strictSetTimeout(this: unknown, fn: () => void, ms?: number) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    return setTimeout(fn, ms);
  }
  function strictClearTimeout(this: unknown, timer: ReturnType<typeof setTimeout>) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    clearTimeout(timer);
  }
  const host = new FakeWindow();
  const frame = new FakeFrame();
  const bridge = new RustgisBridge({
    target: () => frame,
    origin: ORIGIN,
    host,
    setTimeout: strictSetTimeout as unknown as typeof setTimeout,
    clearTimeout: strictClearTimeout as unknown as typeof clearTimeout,
  });
  const ready = bridge.whenReady(1000);
  host.dispatch({ rustgis: "ready" }, frame);
  await ready;
  const ran = bridge.run("ui.language", { code: "es" }, 1000);
  host.dispatch({ rustgis: "result", id: frame.sent[0]!.message.id, ok: true, value: null }, frame);
  assert.equal(await ran, null);
  bridge.close();
});

test("messages that aren't the bridge's are ignored", () => {
  assert.equal(parseBridgeMessage("hello"), null);
  assert.equal(parseBridgeMessage({ rustgis: "result", id: 1 }), null);
  assert.deepEqual(parseBridgeMessage({ rustgis: "result", id: 1, ok: true, value: 3 }), { rustgis: "result", id: 1, ok: true, value: 3, error: undefined });
});

test("catalog layers present in a project, including copies and tiles", () => {
  const project = {
    format: 1,
    active_map: 0,
    maps: [{
      layers: [
        { id: 1, source: { path: `${ORIGIN}/api-proxy/geo/workspace/v1/vectors/${V1}/r/2/data.fgb` } },
        { id: 2, dataset: { source: "mis-puntos.geojson" } },
      ],
      tiles: [
        { url: `${ORIGIN}/api-proxy/geo/workspace/v1/rasters/${R1}/v/99/tiles/{z}/{x}/{y}.png` },
        { url: "https://server.arcgisonline.com/x/{z}/{y}/{x}" },
      ],
      sigtar_active: { layer: 1 },
    }],
  };
  const info = inspectProject(JSON.stringify(project))!;
  assert.deepEqual(Array.from(info.keys).sort(), [`raster:${R1}`, `vector:${V1}`]);
  assert.equal(info.layerCount, 4);
  assert.deepEqual(info.active, { layer: 1 });
  assert.equal(inspectProject("nope"), null);
  assert.equal(catalogKeyOfUrl(`${ORIGIN}/api-proxy/geo/workspace/v1/vectors/${V1}/r/2/../../x.fgb`), null);
});

test("a tile layer goes on top of the active map's tiles", () => {
  const text = JSON.stringify({ active_map: 0, maps: [{ name: "a", tiles: [{ name: "base", kind: "style", url: "s" }] }] });
  const next = JSON.parse(withTileLayer(text, { name: "Mosaico", url: `${ORIGIN}/t/{z}/{x}/{y}.png` }));
  assert.deepEqual(next.maps[0].tiles.map((t: { name: string }) => t.name), ["Mosaico", "base"]);
  assert.equal(next.maps[0].tiles[0].kind, "raster");
  assert.throws(() => withTileLayer("{\"maps\":[]}", { name: "x", url: "u" }), /mapas/);
  assert.equal(absoluteUrl("http://localhost:3000/", "/api-proxy/x"), "http://localhost:3000/api-proxy/x");
});
