'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import {useEffect,useRef} from 'react';
// El lienzo tiene un tamaño fijo y el CSS lo escala: la firma no se borra al girar el celular o cambiar el ancho, y el PNG siempre tiene la proporción del recuadro del PDF.
const W=1000,H=400;
type Point={x:number;y:number};
// Pointer events cubren mouse, dedo y lápiz; touch-action:none (en el CSS) evita que el dedo desplace la página mientras firma.
export default function SignaturePad({value,onChange,attrs}:{value:string;onChange:(v:string)=>void;attrs:any}){
 const canvas=useRef<HTMLCanvasElement>(null),last=useRef<Point|null>(null),mid=useRef<Point|null>(null),exported=useRef('');
 const pen=()=>{const ctx=canvas.current!.getContext('2d')!;ctx.strokeStyle=ctx.fillStyle='#1f2f5a';ctx.lineWidth=6;ctx.lineCap=ctx.lineJoin='round';return ctx;};
 // Solo se redibuja lo que llega de afuera (volver a este paso, empezar otro plan); lo que se acaba de exportar ya está en el lienzo.
 useEffect(()=>{if(value===exported.current)return;exported.current=value;const ctx=pen();ctx.clearRect(0,0,W,H);if(!value)return;const img=new Image();img.onload=()=>ctx.drawImage(img,0,0,W,H);img.src=value;},[value]);
 function at(e:{clientX:number;clientY:number}):Point{const r=canvas.current!.getBoundingClientRect();return {x:(e.clientX-r.left)*W/r.width,y:(e.clientY-r.top)*H/r.height};}
 function down(e:React.PointerEvent<HTMLCanvasElement>){if(e.pointerType==='mouse'&&e.button!==0)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);e.currentTarget.focus();const p=at(e),ctx=pen();last.current=mid.current=p;ctx.beginPath();ctx.arc(p.x,p.y,ctx.lineWidth/2,0,Math.PI*2);ctx.fill();}
 // Cada tramo es una curva entre los puntos medios, así el trazo sale suave aunque el puntero reporte pocos puntos.
 function move(e:React.PointerEvent<HTMLCanvasElement>){if(!last.current)return;const ctx=pen();for(const ev of e.nativeEvent.getCoalescedEvents?.()??[e.nativeEvent]){const p=at(ev),l=last.current!,m={x:(l.x+p.x)/2,y:(l.y+p.y)/2};ctx.beginPath();ctx.moveTo(mid.current!.x,mid.current!.y);ctx.quadraticCurveTo(l.x,l.y,m.x,m.y);ctx.stroke();last.current=p;mid.current=m;}}
 function up(){if(!last.current)return;const ctx=pen();ctx.beginPath();ctx.moveTo(mid.current!.x,mid.current!.y);ctx.lineTo(last.current.x,last.current.y);ctx.stroke();last.current=mid.current=null;exported.current=canvas.current!.toDataURL('image/png');onChange(exported.current);}
 function clear(){pen().clearRect(0,0,W,H);exported.current='';onChange('');}
 return <><div className="signature-pad"><canvas ref={canvas} width={W} height={H} tabIndex={0} aria-label="Recuadro para firmar con el mouse o con el dedo" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} {...attrs}/>{!value&&<span>Firmen aquí con el mouse o con el dedo</span>}<i/></div><button type="button" className="text-btn signature-clear" onClick={clear} disabled={!value}>Borrar firma</button></>;
}
