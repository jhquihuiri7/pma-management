// Genera las escenas de los puntos del mapa (maquinaria y trabajadores).
// Cada punto tiene una versión fija y otra animada (SVG con animación CSS, equivalente a un GIF).
// Solo las figuras, sobre fondo transparente: sin el cuadrado redondeado ni el paisaje de fondo
// (suelo, edificios, sol, olas), para que el mapa se vea alrededor de ellas. Cada escena recorta
// su viewBox a sus figuras, con el recorrido de sus animaciones, y así ocupan todo el ícono.
// Uso: node scripts/protocolo-limpieza/generar-escenas-mapa.mjs  → escribe en apps/web/public/protocolo-limpieza/mapa/
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'apps', 'web', 'public', 'protocolo-limpieza', 'mapa');
mkdirSync(out, {recursive: true});

const f = n => +n.toFixed(2);
const rad = d => d * Math.PI / 180;
const NAVY = '#0a2c40', SKIN = '#e9b48a', HAT = '#facc15', HAT_RIM = '#ca8a04', VEST = '#f97316', STRIPE = '#fef08a', PANTS = '#1e293b';
// Contorno de las piezas claras: sin fondo, el blanco se perdería sobre el mapa.
const EDGE = `stroke="${NAVY}" stroke-opacity=".45" stroke-width="1.3" stroke-linejoin="round"`;

const vgrad = (id, a, b) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;

function recycle(cx, cy, s, color, w = 3) {
  let o = '';
  const r = 9 * s;
  for (let k = 0; k < 3; k++) {
    const a1 = rad(-140 + k * 120), a2 = rad(-72 + k * 120);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1), x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
    const tx = -Math.sin(a2), ty = Math.cos(a2), nx = Math.cos(a2), ny = Math.sin(a2);
    const tip = [x2 + s * 4.4 * tx, y2 + s * 4.4 * ty];
    const b1 = [x2 + s * 3.5 * nx - s * .6 * tx, y2 + s * 3.5 * ny - s * .6 * ty];
    const b2 = [x2 - s * 3.5 * nx - s * .6 * tx, y2 - s * 3.5 * ny - s * .6 * ty];
    o += `<path d="M${f(x1)} ${f(y1)}A${f(r)} ${f(r)} 0 0 1 ${f(x2)} ${f(y2)}" fill="none" stroke="${color}" stroke-width="${f(w * s)}" stroke-linecap="round"/>`;
    o += `<path d="M${f(tip[0])} ${f(tip[1])}L${f(b1[0])} ${f(b1[1])}L${f(b2[0])} ${f(b2[1])}Z" fill="${color}" stroke="${color}" stroke-width="${f(.9 * s)}" stroke-linejoin="round"/>`;
  }
  return o;
}

// Trabajador con casco y chaleco. (x, y) = pies; dir 1 mira a la derecha, -1 a la izquierda.
// Devuelve el SVG y el punto del hombro, que es el origen de giro del brazo animado.
function worker(id, x, y, {dir = 1, tool = 'none'} = {}) {
  const sx = x + dir * 4.5, sy = y - 24, hx = x + dir * 12, hy = y - 18.5;
  const tools = {
    shovel: `<path d="M${hx} ${hy}L${hx + dir * 9} ${hy + 16}" stroke="#92400e" stroke-width="2.3" stroke-linecap="round"/><path d="M${hx + dir * 6} ${hy + 15.5}l${dir * 7} -3.6 3.4 6 -7 3.6z" fill="#cbd5e1" stroke="#64748b" stroke-width=".9" stroke-linejoin="round"/>`,
    broom: `<path d="M${hx} ${hy}L${hx + dir * 8} ${hy + 17}" stroke="#92400e" stroke-width="2.2" stroke-linecap="round"/><path d="M${hx + dir * 4} ${hy + 17}l${dir * 9} -3 2 5 -9 2z" fill="#facc15" stroke="#ca8a04" stroke-width=".8"/>`,
    flag: `<path d="M${hx} ${hy + 1}L${hx + dir * 2} ${hy - 13}" stroke="#334155" stroke-width="2" stroke-linecap="round"/><path d="M${hx + dir * 2} ${hy - 13}l${dir * 9} 2 -${dir * 1} 6 -${dir * 8} -1z" fill="#ef4444"/>`,
    bag: `<path d="M${hx} ${hy}v2.6" stroke="#0f172a" stroke-width="1.6" stroke-linecap="round"/><path d="M${hx - 4.6} ${hy + 4}q4.6 -3.2 9.2 0l1.4 9.5q-6 4.2 -12 0z" fill="#1f2937"/><path d="M${hx - 2.4} ${hy + 6}l-.6 5" stroke="#475569" stroke-width="1" stroke-linecap="round"/>`,
    clipboard: `<rect x="${hx + (dir > 0 ? -1 : -9)}" y="${hy - 8}" width="10" height="13" rx="1.6" fill="#92400e"/><rect x="${hx + (dir > 0 ? .5 : -7.5)}" y="${hy - 6}" width="7" height="9" rx=".8" fill="#fff"/><path d="M${hx + (dir > 0 ? 2 : -6)} ${hy - 3.5}h4M${hx + (dir > 0 ? 2 : -6)} ${hy - 1}h4" stroke="#94a3b8" stroke-width="1"/>`,
    none: '',
  };
  const svg = `<g class="${id}-body">
<ellipse cx="${x}" cy="${y + .8}" rx="9.5" ry="2.2" fill="#0f172a" opacity=".22"/>
<path d="M${x - 3.2} ${y - 13}V${y - 1.2}M${x + 3.2} ${y - 13}V${y - 1.2}" stroke="${PANTS}" stroke-width="3.8" stroke-linecap="round"/>
<path d="M${x - 5.8} ${y - .7}h4.4M${x + 1.4} ${y - .7}h4.4" stroke="#78350f" stroke-width="2.6" stroke-linecap="round"/>
<path d="M${x - dir * 4.6} ${y - 24}l${-dir * 2} 8.5" stroke="${VEST}" stroke-width="3.4" stroke-linecap="round"/>
<rect x="${x - 6.6}" y="${y - 28}" width="13.2" height="16" rx="4.6" fill="${VEST}"/>
<path d="M${x - 6.6} ${y - 21.6}h13.2M${x - 6.6} ${y - 17}h13.2" stroke="${STRIPE}" stroke-width="1.7"/>
<circle cx="${x}" cy="${y - 32.6}" r="4.6" fill="${SKIN}"/>
<path d="M${x - 5.5} ${y - 33.6}a5.5 5.5 0 0 1 11 0z" fill="${HAT}"/>
<rect x="${x - 6.8}" y="${y - 34.5}" width="13.6" height="2.1" rx="1" fill="${HAT_RIM}"/>
<g class="${id}-arm"><path d="M${sx} ${sy}L${hx} ${hy}" stroke="${VEST}" stroke-width="3.4" stroke-linecap="round"/><circle cx="${hx}" cy="${hy}" r="2" fill="${SKIN}"/>${tools[tool]}</g>
</g>`;
  return {svg, shoulder: `${f(sx)}px ${f(sy)}px`};
}

// Animación CSS de un elemento: origen fijo (unidades del viewBox) y fotogramas.
const anim = (sel, origin, frames, dur, extra = '') => {
  const name = sel.replace(/[^a-z0-9]/gi, '');
  return `.${sel}{transform-origin:${origin};animation:${name} ${dur} ${extra || 'ease-in-out infinite'}}@keyframes ${name}{${frames}}`;
};

// Escena sin fondo: solo las figuras, en el recorte (viewBox) que las encuadra.
function scene({p, title, viewBox, defs = '', css = '', body}, animated) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="${viewBox}" role="img" aria-labelledby="${p}-t">
<title id="${p}-t">${title}</title>
${defs ? `<defs>${defs}</defs>\n` : ''}${animated && css ? `<style>${css}@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>\n` : ''}${body}
</svg>
`;
}

const scenes = [];

// Zona urbana (R1): trabajador echa una funda al contenedor; la tapa se abre.
{
  const p = 'pu', w = worker(`${p}-w`, 40, 106, {dir: 1, tool: 'bag'});
  scenes.push(['zona-urbana', {
    p, title: 'Zona urbana · recolección', viewBox: '22 24 88 88',
    defs: vgrad(`${p}-obj`, '#ffffff', '#d3f1e1') + vgrad(`${p}-lid`, '#12a06c', '#075e43'),
    css: anim(`${p}-w-arm`, w.shoulder, '0%,100%{transform:rotate(12deg)}40%,58%{transform:rotate(-104deg)}', '2.4s')
      + anim(`${p}-lid`, '102px 57px', '0%,28%,72%,100%{transform:rotate(0)}40%,60%{transform:rotate(30deg)}', '2.4s')
      + anim(`${p}-w-body`, '40px 106px', '0%,100%{transform:translateY(0)}45%{transform:translateY(-1.5px)}', '2.4s'),
    body: `<path d="M62 62H98L94.6 102Q94.2 106 90.6 106H69.4Q65.8 106 65.4 102Z" fill="url(#${p}-obj)" ${EDGE}/>
<path d="M88 62H98L94.6 102Q94.2 106 90.6 106H86Z" fill="#0b4f37" fill-opacity=".08"/>
${recycle(80, 84, .9, '#059669', 3.2)}
<circle cx="70" cy="106" r="5.6" fill="${NAVY}"/><circle cx="70" cy="106" r="2.2" fill="#a3bccb"/><circle cx="90" cy="106" r="5.6" fill="${NAVY}"/><circle cx="90" cy="106" r="2.2" fill="#a3bccb"/>
<g class="${p}-lid"><rect x="58" y="52" width="44" height="10.5" rx="4.4" fill="url(#${p}-lid)"/><rect x="73" y="46.5" width="14" height="7" rx="3.4" fill="#064e3b"/></g>
${w.svg}`,
  }]);
}

// Acopio temporal (R2): grúa iza un contenedor; un trabajador palea en la pila de residuos.
{
  const p = 'pa', w = worker(`${p}-w`, 54, 106, {dir: -1, tool: 'shovel'});
  scenes.push(['acopio-temporal', {
    p, title: 'Acopio temporal · carga de contenedores', viewBox: '5 16 112 112',
    defs: vgrad(`${p}-front`, '#ffffff', '#d9efe8') + vgrad(`${p}-pile`, '#a16207', '#713f12'),
    css: anim(`${p}-hoist`, '87px 34px', '0%,100%{transform:translateY(0) rotate(0)}30%{transform:translateY(-11px) rotate(2.5deg)}60%{transform:translateY(-11px) rotate(-2deg)}', '3.2s')
      + anim(`${p}-w-arm`, w.shoulder, '0%,100%{transform:rotate(-12deg)}50%{transform:rotate(26deg)}', '1.5s')
      + anim(`${p}-w-body`, '54px 106px', '0%,100%{transform:translateY(0)}50%{transform:translateY(1.4px)}', '1.5s'),
    body: `<path d="M6 108C10 90 22 80 33 82C41 83 46 94 48 108Z" fill="url(#${p}-pile)"/>
<g><circle cx="18" cy="96" r="5.4" fill="#166534"/><circle cx="29" cy="89" r="5.8" fill="#334155"/><circle cx="38" cy="97" r="5" fill="#1f2937"/><circle cx="25" cy="100" r="4.4" fill="#4d7c0f"/><path d="M12 104l5-4 6 2-2 5z" fill="#e7e5e4"/></g>
<g class="${p}-hoist">
<path d="M87 -10V30" stroke="${NAVY}" stroke-width="3" stroke-linecap="round"/>
<circle cx="87" cy="33.6" r="3.6" fill="none" stroke="${NAVY}" stroke-width="2.6"/>
<path d="M85 36.4L68 50M89 36.4L108 48" stroke="${NAVY}" stroke-width="2" stroke-linecap="round"/>
<path d="M66 54L76 48H116L106 54Z" fill="#f2fbf8" ${EDGE}/>
<path d="M106 54L116 48V78L106 84Z" fill="#a6d8c7" ${EDGE}/>
<rect x="66" y="54" width="40" height="30" fill="url(#${p}-front)" ${EDGE}/>
<g stroke="#bddfd3" stroke-width="2" stroke-linecap="round"><path d="M71 59V79M76 59V79M96 59V79M101 59V79"/></g>
<rect x="66" y="81" width="40" height="3" fill="${NAVY}"/>
<circle cx="86" cy="69" r="8.6" fill="#0f766e"/>${recycle(86, 69, .55, '#fff', 3.4)}
</g>
${w.svg}`,
  }]);
}

// Relleno sanitario (R2.1): la topadora empuja material y un trabajador palea junto a ella.
{
  const p = 'pr', w = worker(`${p}-w`, 104, 78, {dir: -1, tool: 'shovel'});
  scenes.push(['relleno-sanitario', {
    p, title: 'Relleno sanitario · disposición', viewBox: '21 8 93 93',
    defs: vgrad(`${p}-body`, '#ffffff', '#fdf0c4'),
    css: anim(`${p}-dozer`, '70px 70px', '0%,100%{transform:translateX(3px)}50%{transform:translateX(-6px)}', '2.6s')
      + ['s1', 's2', 's3'].map((s, i) => anim(`${p}-${s}`, '60px 34px', '0%{transform:translate(0,6px) scale(.5);opacity:0}25%{opacity:.8}100%{transform:translate(-8px,-14px) scale(1.25);opacity:0}', '2.4s', `ease-out ${i * .8}s infinite`)).join('')
      + anim(`${p}-w-arm`, w.shoulder, '0%,100%{transform:rotate(-14deg)}50%{transform:rotate(24deg)}', '1.4s')
      + anim(`${p}-rock`, '34px 80px', '0%,100%{transform:translate(0,0)}50%{transform:translate(-5px,3px)}', '2.6s'),
    body: `<g transform="translate(-1 -8)"><g class="${p}-rock"><path d="M28 85l5-5.5 6.5 2 1 5.5-6.5 3z" fill="#a8a29e" ${EDGE}/><path d="M33 79l3.5-3.5 4.4 1 .3 3.6-4.2 2z" fill="#d6d3d1" ${EDGE}/></g></g>
<g fill="#94a3b8"><circle class="${p}-s1" cx="63" cy="34" r="3.4" fill-opacity=".8"/><circle class="${p}-s2" cx="63" cy="34" r="3.4" fill-opacity=".8"/><circle class="${p}-s3" cx="63" cy="34" r="3.4" fill-opacity=".8"/></g>
<g class="${p}-dozer">
<rect x="61.4" y="38" width="3.4" height="16" rx="1.2" fill="${NAVY}"/>
<rect x="70" y="31" width="18" height="24" fill="url(#${p}-body)" ${EDGE}/>
<rect x="72.5" y="34" width="13" height="11" rx="1.6" fill="#bae6fd"/>
<rect x="68" y="28.5" width="22" height="4.6" rx="2" fill="${NAVY}"/>
<path d="M49 57.5Q49 53 53.5 53H88V66H49Z" fill="url(#${p}-body)" ${EDGE}/>
<rect x="49" y="62.5" width="39" height="2.4" fill="${NAVY}" fill-opacity=".85"/>
<path d="M39 71.5H53" stroke="${NAVY}" stroke-width="4.6" stroke-linecap="round"/>
<path d="M41 59.5L51 57.5" stroke="#557083" stroke-width="2.8" stroke-linecap="round"/>
<path d="M32.5 51Q28 65 33.5 79H42.5Q39 65 42.5 52.5Z" fill="${NAVY}"/>
<rect x="50" y="65.5" width="40" height="12" rx="6" fill="#0f2a3a"/>
${[56.5, 64.5, 72.5, 80.5].map(x => `<circle cx="${x}" cy="71.6" r="3.3" fill="#5b7688"/>`).join('')}
</g>
${w.svg}`,
  }]);
}

// Patio de contenedores (R3): montacargas eleva un contenedor; trabajador guía con bandera.
{
  const p = 'pp', w = worker(`${p}-w`, 28, 112, {dir: 1, tool: 'flag'});
  const box = (x, y, w2, h, c) => `<rect x="${x}" y="${y}" width="${w2}" height="${h}" rx="1.4" fill="${c}" ${EDGE}/><path d="M${x + 5} ${y + 3}V${y + h - 3}M${x + 10} ${y + 3}V${y + h - 3}M${x + w2 - 10} ${y + 3}V${y + h - 3}M${x + w2 - 5} ${y + 3}V${y + h - 3}" stroke="#000" stroke-opacity=".16" stroke-width="1.6" stroke-linecap="round"/><rect x="${x}" y="${y}" width="${w2}" height="2.2" rx="1" fill="#fff" fill-opacity=".35"/>`;
  scenes.push(['patio-contenedores', {
    p, title: 'Patio de contenedores · maniobra', viewBox: '7 20 112 112',
    defs: vgrad(`${p}-fork`, '#fde047', '#eab308'),
    css: anim(`${p}-lift`, '64px 80px', '0%,12%,100%{transform:translateY(0)}45%,68%{transform:translateY(-20px)}', '3.4s')
      + anim(`${p}-w-arm`, w.shoulder, '0%,100%{transform:rotate(-20deg)}50%{transform:rotate(22deg)}', '1s')
      + anim(`${p}-truck`, '96px 100px', '0%,100%{transform:translateY(0)}50%{transform:translateY(-.8px)}', '.6s', 'linear infinite'),
    body: `${box(9, 84, 38, 20, '#fb923c')}${box(9, 64, 38, 20, '#e2e8f0')}${box(9, 44, 38, 20, '#34d399')}
<g class="${p}-truck">
<rect x="84" y="80" width="30" height="19" rx="3" fill="url(#${p}-fork)"/>
<path d="M108 80h7a3 3 0 0 1 3 3v16h-10z" fill="#ca8a04"/>
<path d="M88 80V58H108V80" fill="none" stroke="${NAVY}" stroke-width="2.6" stroke-linejoin="round"/>
<rect x="86" y="55.5" width="25" height="4" rx="2" fill="${NAVY}"/>
<rect x="90" y="61" width="16" height="17" rx="1.4" fill="#bae6fd" fill-opacity=".55"/>
<circle cx="90" cy="101" r="6" fill="${NAVY}"/><circle cx="90" cy="101" r="2.4" fill="#cbd5e1"/><circle cx="109" cy="101" r="6" fill="${NAVY}"/><circle cx="109" cy="101" r="2.4" fill="#cbd5e1"/>
<rect x="77" y="40" width="5" height="60" rx="1.4" fill="${NAVY}"/>
</g>
<g class="${p}-lift">
<rect x="74" y="66" width="7" height="26" rx="1.2" fill="#334155"/>
<rect x="50" y="89" width="30" height="3.2" rx="1" fill="#334155"/>
${box(50, 70, 26, 19, '#ef4444')}
</g>
${w.svg}`,
  }]);
}

// Puerto de Baltra (R4): grúa pórtico carga el buque; trabajador en el muelle.
{
  const p = 'pb', w = worker(`${p}-w`, 47, 88, {dir: 1, tool: 'flag'});
  scenes.push(['puerto-baltra', {
    p, title: 'Puerto de Baltra · embarque', viewBox: '7 6 116 116',
    defs: vgrad(`${p}-hull`, '#16405e', NAVY),
    css: anim(`${p}-trolley`, '30px 40px', '0%,10%,100%{transform:translateX(0)}45%,60%{transform:translateX(54px)}', '4.2s')
      + anim(`${p}-ship`, '92px 92px', '0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(1.8px) rotate(.8deg)}', '2.2s')
      + anim(`${p}-w-arm`, w.shoulder, '0%,100%{transform:rotate(-18deg)}50%{transform:rotate(24deg)}', '1.1s'),
    body: `<g class="${p}-ship">
<g ${EDGE}><rect x="66" y="66" width="11" height="10" rx="1" fill="#fbbf24"/><rect x="78" y="66" width="11" height="10" rx="1" fill="#34d399"/><rect x="90" y="66" width="11" height="10" rx="1" fill="#f87171"/><rect x="72" y="56" width="11" height="10" rx="1" fill="#fb923c"/><rect x="84" y="56" width="11" height="10" rx="1" fill="#e2e8f0"/></g>
<rect x="104" y="54" width="14" height="22" rx="1.6" fill="#fff" ${EDGE}/><rect x="106" y="58" width="10" height="3.4" rx="1" fill="#1e3a8a"/>
<path d="M60 76H122L119 98H66Q62 98 61 95Z" fill="url(#${p}-hull)"/>
<path d="M61.6 92H119.8L119 98H66Q62 98 61 95Z" fill="#ef4444"/>
<path d="M62 79H121.6" stroke="#fff" stroke-opacity=".85" stroke-width="1.8"/>
</g>
<path d="M16 88V36M36 88V36" stroke="#facc15" stroke-width="4"/>
<path d="M16 50L36 64M36 50L16 64" stroke="#ca8a04" stroke-width="1.6"/>
<rect x="9" y="29" width="103" height="7" rx="1.6" fill="#facc15" stroke="#ca8a04" stroke-width="1"/>
<path d="M12 35l6-5 6 5 6-5 6 5 6-5 6 5 6-5 6 5 6-5 6 5 6-5 6 5 6-5 6 5 6-5 4 3.4" fill="none" stroke="#ca8a04" stroke-width="1.2"/>
<g class="${p}-trolley">
<rect x="22" y="36" width="16" height="6" rx="1.4" fill="${NAVY}"/>
<path d="M30 42V50" stroke="${NAVY}" stroke-width="1.8"/>
<rect x="21" y="50" width="18" height="11" rx="1.2" fill="#38bdf8"/><path d="M26 53v5M30 53v5M34 53v5" stroke="#0369a1" stroke-width="1.2" stroke-linecap="round"/>
</g>
${w.svg}`,
  }]);
}

// Puerto de Guayaquil (R5): montacargas saca carga de la bodega; trabajador registra.
{
  const p = 'pg', w = worker(`${p}-w`, 109, 106, {dir: -1, tool: 'clipboard'});
  const crate = (x, y, w2, h, c) => `<rect x="${x}" y="${y}" width="${w2}" height="${h}" rx="1.4" fill="${c}" ${EDGE}/><rect x="${x + w2 / 2 - 2}" y="${y}" width="4" height="${h}" fill="#fff" fill-opacity=".38"/>`;
  scenes.push(['puerto-guayaquil', {
    p, title: 'Puerto de Guayaquil · recepción', viewBox: '25 42 92 92',
    defs: vgrad(`${p}-fork`, '#fde047', '#eab308'),
    css: anim(`${p}-fork`, '80px 100px', '0%,15%,100%{transform:translateX(0)}50%,65%{transform:translateX(15px)}', '3.6s')
      + anim(`${p}-w-arm`, w.shoulder, '0%,100%{transform:rotate(-6deg)}50%{transform:rotate(8deg)}', '1.8s'),
    body: `${crate(26, 88, 20, 16, '#fbbf24')}${crate(28, 76, 16, 12, '#34d399')}
<g class="${p}-fork">
${crate(48, 82, 18, 14, '#fb923c')}
<rect x="47" y="96" width="22" height="2.6" rx="1" fill="#334155"/>
<rect x="67" y="70" width="4" height="30" rx="1" fill="${NAVY}"/>
<rect x="71" y="84" width="22" height="15" rx="2.6" fill="url(#${p}-fork)"/>
<path d="M76 84V71H90V84" fill="none" stroke="${NAVY}" stroke-width="2.2"/>
<rect x="74" y="69" width="18" height="3" rx="1.4" fill="${NAVY}"/>
<circle cx="76" cy="101" r="4.6" fill="${NAVY}"/><circle cx="89" cy="101" r="4.6" fill="${NAVY}"/>
</g>
${w.svg}`,
  }]);
}

for (const [name, s] of scenes) {
  writeFileSync(join(out, `${name}.svg`), scene(s, false));
  writeFileSync(join(out, `${name}-animado.svg`), scene(s, true));
}
console.log('Escenas generadas en apps/web/public/protocolo-limpieza/mapa:', scenes.map(([n]) => n).join(', '));
