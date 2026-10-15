import fontkit from '@pdf-lib/fontkit';
import {LineCapStyle,PDFDocument,PDFString,clip,endPath,popGraphicsState,pushGraphicsState,rectangle,rgb,type PDFFont,type PDFImage,type PDFPage,type RGB} from 'pdf-lib';
import {backpackPng,hazardPng,kitJpg,phonePng} from './pdf-art.js';
import {cgregLogoPdf} from './pdf-logo.js';
import {montserrat} from './pdf-fonts.js';
import type {FamilyEmergencyPlanInput} from './model.js';

// Two-sheet poster after the SGR "Plan Familiar de Emergencias" afiche: sheet one and the top half of
// sheet two hold the family's answers, the bottom half shows the emergency backpack. An answer that does
// not fit even at the minimum type size continues in an annex after the backpack instead of being cut.
const W=595.28,H=841.89,M=20,CW=W-2*M,LH=1.18;
const hex=(h:string)=>rgb(parseInt(h.slice(1,3),16)/255,parseInt(h.slice(3,5),16)/255,parseInt(h.slice(5,7),16)/255);
const C={navy:hex('#1f2f5a'),navySoft:hex('#2f416c'),orange:hex('#e27c32'),sky:hex('#4a9bd1'),pale:hex('#a9cee8'),zebra:hex('#f1f6fb'),paper:hex('#f6f9fc'),rule:hex('#c3cddb'),dot:hex('#d3dbe6'),muted:hex('#5d6b86'),red:hex('#d7302a'),grey:hex('#7d7a7a'),purple:hex('#382d81'),footer:hex('#8fa3c7'),white:rgb(1,1,1)};
type Hazard=keyof typeof hazardPng;
const HAZARDS:[RegExp,Hazard][]=[[/tsunami|maremoto/,'tsunami'],[/sism|terremot|temblor/,'sismo'],[/inund|lluvia|crecida/,'inundacion'],[/ceniza|erup|volc/,'erupcion'],[/incend|fuego/,'incendio'],[/desliz|derrumb|desprend/,'deslizamiento'],[/aguaje|olea|marejad/,'aguaje'],[/sequ/,'sequia']];
const hazardOf=(v:string)=>{const s=v.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();return HAZARDS.find(([re])=>re.test(s))?.[1];};
const KIT:[keyof typeof kitJpg,string,string][]=[
 ['alimentos','ALIMENTOS Y BEBIDAS','Alimentos enlatados, agua potable embotellada, alimentos para bebés y para personas con alimentación especial.'],
 ['botiquin','BOTIQUÍN DE EMERGENCIA','Botiquín de emergencia con medicamentos de auxilio y de uso regular.'],
 ['vestimenta','KIT DE VESTIMENTA','Una muda de ropa personal, manta, cobijas, impermeables, etc.'],
 ['aseo','KIT DE ASEO PERSONAL','Implementos de aseo como jabón, pasta dental, etc.'],
 ['radio','RADIO PORTÁTIL','Radio con pilas extras. Ten presente la frecuencia de la emisora para las noticias.'],
 ['agenda','AGENDA DE EMERGENCIA','Libreta con los números de teléfono de tu familia y el número único de emergencias 911.'],
 ['apoyo','IMPLEMENTOS DE APOYO','Silbato o pito, linterna, velas y fosforeras.'],
 ['documentos','DOCUMENTACIÓN PERSONAL','Documentos personales como cédula, pasaporte, recetas médicas o documentos de propiedad de bienes.'],
 ['mascotas','KIT DE MASCOTAS','Si tienes mascotas, coloca su alimento, agua embotellada y fundas plásticas para recoger sus desperdicios.'],
];
type Align='left'|'center'|'right';
type TextOpts={size?:number,min?:number,font?:PDFFont,color?:RGB,align?:Align,valign?:'top'|'middle'};
type Cell=string|((x:number,top:number,w:number,h:number)=>void);
type Row=Cell[]|{note:string};
type Col={head:string,w:number,align?:Align};

export async function createFamilyPlanPdf(p:FamilyEmergencyPlanInput,_id:string,_createdAt:Date){
 const doc=await PDFDocument.create();
 doc.setTitle('Plan Familiar de Emergencias - '+p.family);doc.setAuthor('CGREG / DGTAR');
 doc.registerFontkit(fontkit);
 const [med,bold,xb,black]=await Promise.all([montserrat.medium,montserrat.bold,montserrat.extraBold,montserrat.black].map(f=>doc.embedFont(f)));
 const hazards=new Map<Hazard,PDFImage>();
 for(const k of new Set([...p.risks.map(r=>hazardOf(r.type)),...p.routes.map(r=>hazardOf(r.situation))]))if(k)hazards.set(k,await doc.embedPng(hazardPng[k]));
 const phone=await doc.embedPng(phonePng);
 const annex:{label:string,text:string}[]=[];
 const chars=new Set(med.getCharacterSet());
 // Montserrat is subset to Latin-1, so anything outside it (emoji, other scripts) is dropped rather than drawn as boxes.
 const clean=(v:unknown)=>String(v??'').normalize('NFC').replace(/\r\n?/g,'\n').replace(/[^\n]/gu,ch=>chars.has(ch.codePointAt(0)!)?ch:/\s/u.test(ch)?' ':'').replace(/[ \t]+/g,' ').replace(/ ?\n ?/g,'\n').trim();
 const date=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)?v.split('-').reverse().join('/'):v;
 const wrap=(value:string,width:number,size:number,font:PDFFont)=>{
  const out:string[]=[];
  for(const paragraph of value.split('\n')){
   let acc='';
   for(const word of paragraph.split(/\s+/)){
    if(font.widthOfTextAtSize(word,size)>width){
     if(acc){out.push(acc);acc='';}
     let chunk='';for(const ch of word){if(font.widthOfTextAtSize(chunk+ch,size)>width){out.push(chunk);chunk=ch;}else chunk+=ch;}acc=chunk;
    }else if(font.widthOfTextAtSize((acc?acc+' ':'')+word,size)>width){out.push(acc);acc=word;}else acc+=(acc?' ':'')+word;
   }out.push(acc);
  }return out;
 };
 // Text boxes are measured from the cap line, so `top` is where capitals start.
 const blockH=(n:number,size:number)=>(n-1)*size*LH+size*.74;
 function lines(pg:PDFPage,ls:string[],x:number,top:number,w:number,size:number,font:PDFFont,color:RGB,align:Align='left'){
  ls.forEach((s,i)=>{if(!s)return;const dx=align==='left'?0:(w-font.widthOfTextAtSize(s,size))/(align==='center'?2:1);pg.drawText(s,{x:x+dx,y:H-top-size*.74-i*size*LH,size,font,color});});
 }
 // Shrinks before it splits a word: only the minimum size may break one across lines.
 function fit(s:string,w:number,h:number,max:number,min:number,font:PDFFont){
  const words=s.split(/\s+/);
  for(let size=max;size>=min-1e-6;size-=.25){
   if(size>min+1e-6&&words.some(word=>font.widthOfTextAtSize(word,size)>w))continue;
   const ls=wrap(s,w,size,font);if(blockH(ls.length,size)+size*.22<=h)return {ls,size};
  }
  return null;
 }
 function place(pg:PDFPage,ls:string[],size:number,x:number,top:number,w:number,h:number,font:PDFFont,color:RGB,o:TextOpts){
  const t=o.valign==='top'?top:top+(h-blockH(ls.length,size))/2;lines(pg,ls,x,t,w,size,font,color,o.align);
 }
 // Fixed copy always fits: it only shrinks.
 function say(pg:PDFPage,value:string,x:number,top:number,w:number,h:number,o:TextOpts={}){
  const s=clean(value),font=o.font??med,min=o.min??Math.min(4.6,o.size??7);if(!s)return;
  const r=fit(s,w,h,o.size??7,min,font)??{ls:wrap(s,w,min,font),size:min};
  place(pg,r.ls,r.size,x,top,w,h,font,o.color??C.navy,o);
 }
 // A family answer shrinks down to `min`; past that the whole answer moves to the annex.
 function answer(pg:PDFPage,value:unknown,x:number,top:number,w:number,h:number,label:string,o:TextOpts={}){
  const s=clean(value);if(!s)return;
  const font=o.font??med,r=fit(s,w,h,o.size??7,o.min??5.4,font);
  if(r)return place(pg,r.ls,r.size,x,top,w,h,font,o.color??C.navy,o);
  annex.push({label,text:s});
  say(pg,'Ver anexo '+annex.length,x,top,w,h,{...o,size:5.8,font:bold,color:C.sky});
 }
 const rr=(x:number,y:number,w:number,h:number,r=0)=>{r=Math.min(r,w/2,h/2);return r?`M${x+r} ${y}H${x+w-r}A${r} ${r} 0 0 1 ${x+w} ${y+r}V${y+h-r}A${r} ${r} 0 0 1 ${x+w-r} ${y+h}H${x+r}A${r} ${r} 0 0 1 ${x} ${y+h-r}V${y+r}A${r} ${r} 0 0 1 ${x+r} ${y}Z`:`M${x} ${y}H${x+w}V${y+h}H${x}Z`;};
 // SVG paths are drawn from the page's top-left corner, so every coordinate below is measured from the top.
 function shape(pg:PDFPage,path:string,o:{fill?:RGB,stroke?:RGB,width?:number,dash?:number[]}){
  pg.drawSvgPath(path,{x:0,y:H,...(o.fill?{color:o.fill}:{}),...(o.stroke?{borderColor:o.stroke,borderWidth:o.width??.6,borderLineCap:LineCapStyle.Round}:{}),...(o.dash?{borderDashArray:o.dash}:{})});
 }
 const hline=(pg:PDFPage,x:number,top:number,w:number,color=C.rule)=>pg.drawLine({start:{x,y:H-top},end:{x:x+w,y:H-top},thickness:.4,color});
 const vline=(pg:PDFPage,x:number,top:number,h:number)=>pg.drawLine({start:{x,y:H-top},end:{x,y:H-top-h},thickness:.4,color:C.rule});
 const circle=(pg:PDFPage,cx:number,cy:number,r:number,color:RGB)=>pg.drawCircle({x:cx,y:H-cy,size:r,color});
 const card=(pg:PDFPage,x:number,top:number,w:number,h:number)=>shape(pg,rr(x,top,w,h,5),{fill:C.white});
 function contain(pg:PDFPage,img:PDFImage,x:number,top:number,w:number,h:number){
  const s=img.scale(Math.min(w/img.width,h/img.height));pg.drawImage(img,{x:x+(w-s.width)/2,y:H-top-(h+s.height)/2,width:s.width,height:s.height});
 }
 // Fills the whole box, trimming whatever overflows it.
 function cover(pg:PDFPage,img:PDFImage,x:number,top:number,w:number,h:number){
  const s=img.scale(Math.max(w/img.width,h/img.height));
  pg.pushOperators(pushGraphicsState(),rectangle(x,H-top-h,w,h),clip(),endPath());
  pg.drawImage(img,{x:x+(w-s.width)/2,y:H-top-(h+s.height)/2,width:s.width,height:s.height});
  pg.pushOperators(popGraphicsState());
 }
 function sheet(){
  const pg=doc.addPage([W,H]);
  pg.drawRectangle({x:0,y:0,width:W,height:H,color:C.navy});
  shape(pg,'M222 0H446L366 842H142Z',{fill:C.navySoft});shape(pg,'M488 0H510L430 842H408Z',{fill:C.navySoft});
  return pg;
 }
 function sparks(pg:PDFPage,cx:number,cy:number,r1:number,r2:number,angles:number[]){
  angles.forEach(a=>{const t=a*Math.PI/180;pg.drawLine({start:{x:cx+Math.cos(t)*r1,y:H-cy-Math.sin(t)*r1},end:{x:cx+Math.cos(t)*r2,y:H-cy-Math.sin(t)*r2},thickness:1.7,color:C.white,lineCap:LineCapStyle.Round});});
 }
 function banner(pg:PDFPage,title:string,top:number,h:number,max:number,w=CW-24){
  shape(pg,rr(M,top,w,h,2),{fill:C.orange});
  let size=max;while(black.widthOfTextAtSize(title,size)>w-24)size-=.5;
  lines(pg,[title],M,top+(h-size*.74)/2,w,size,black,C.white,'center');
  if(w===CW-24)sparks(pg,M+w+3,top+3,6,13,[-105,-70,-35,0,35]);
 }
 function heading(pg:PDFPage,text:string,x:number,top:number,w:number){say(pg,text,x,top,w,10,{size:9.5,min:7,font:xb,color:C.orange});}
 function tab(pg:PDFPage,text:string,x:number,top:number,fill=C.sky,color=C.navy){
  const w=xb.widthOfTextAtSize(text,6)+10;shape(pg,rr(x,top,w,12,0),{fill});lines(pg,[text],x+5,top+(12-6*.74)/2,w,6,xb,color);
 }
 // Afiche-style field: a coloured label tab sitting on a white box; returns where the box content starts.
 function field(pg:PDFPage,name:string,x:number,top:number,w:number,h:number,fill=C.sky,color=C.navy){
  shape(pg,rr(x,top+11,w,h-11,3),{fill:C.white});shape(pg,rr(x,top+11,4,4),{fill:C.white});tab(pg,name,x,top,fill,color);return top+11;
 }
 const tiny=(pg:PDFPage,text:string,x:number,top:number,w:number,color=C.grey)=>say(pg,text,x,top,w,6,{size:4.9,min:4,font:xb,color});
 // Small caps label followed by its answer on the same line.
 function inline(pg:PDFPage,name:string,value:unknown,x:number,top:number,w:number,h:number,label:string,o:TextOpts={}){
  const lw=xb.widthOfTextAtSize(name,4.9)+4;say(pg,name,x,top,lw,h,{size:4.9,font:xb,color:C.grey});
  answer(pg,value,x+lw,top,w-lw,h,label,{size:7,min:5,font:bold,...o});
 }
 function check(pg:PDFPage,x:number,top:number,s:number,on:boolean){
  shape(pg,rr(x,top,s,s,1),{fill:C.white,stroke:C.navy,width:.6});
  if(on)shape(pg,`M${x+s*.18} ${top+s*.5}L${x+s*.42} ${top+s*.78}L${x+s*.86} ${top+s*.2}`,{stroke:C.orange,width:1.2});
 }
 function pill(pg:PDFPage,text:string,x:number,top:number,w:number,h:number,fill:RGB){
  const pw=Math.min(w-4,bold.widthOfTextAtSize(text,5.6)+9),px=x+(w-pw)/2,py=top+(h-9)/2;
  shape(pg,rr(px,py,pw,9,4.5),{fill});say(pg,text,px,py,pw,9,{size:5.6,min:4.4,font:bold,color:C.white,align:'center'});
 }
 function badge(pg:PDFPage,type:string,x:number,top:number,d:number){
  circle(pg,x+d/2,top+d/2,d/2,C.sky);const icon=hazards.get(hazardOf(type)!);
  if(icon)pg.drawImage(icon,{x:x+d*.18,y:H-top-d*.82,width:d*.64,height:d*.64});else say(pg,'!',x,top,d,d,{size:d*.62,font:black,color:C.white,align:'center'});
 }
 function phoneBadge(pg:PDFPage,x:number,top:number,d:number){circle(pg,x+d/2,top+d/2,d/2,C.sky);pg.drawImage(phone,{x:x+d*.2,y:H-top-d*.8,width:d*.6,height:d*.6});}
 function table(pg:PDFPage,x:number,top:number,cols:Col[],rows:Row[],rowH:number,label:(r:number,c:number)=>string,headH=15){
  const w=cols.reduce((a,c)=>a+c.w,0);
  shape(pg,rr(x,top,w,headH,2),{fill:C.pale});
  let cx=x;for(const c of cols){say(pg,c.head.toUpperCase(),cx+3,top+1.5,c.w-6,headH-3,{size:5.6,min:4.4,font:xb,align:c.align});cx+=c.w;}
  rows.forEach((row,r)=>{
   const t=top+headH+r*rowH;
   if(r%2)shape(pg,rr(x,t,w,rowH),{fill:C.zebra});
   if(Array.isArray(row)){let cx=x;cols.forEach((c,i)=>{const v=row[i];if(typeof v==='function')v(cx,t,c.w,rowH);else answer(pg,v,cx+3,t+1.5,c.w-6,rowH-3,label(r,i),{size:6.8,align:c.align});cx+=c.w;});}
   else say(pg,row.note,x+5,t,w-10,rowH,{size:6.2,font:bold,color:C.sky});
   hline(pg,x,t+rowH,w);
  });
  cx=x;cols.slice(0,-1).forEach(c=>{cx+=c.w;vline(pg,cx,top+headH,rows.length*rowH);});
 }
 // Shows up to `cap` rows (blank ones stay free for handwriting); longer lists keep `cap - 1` and move the rest to the annex.
 function listRows<T>(items:T[],cap:number,what:string,describe:(t:T,i:number)=>string,row:(t:T|undefined,i:number)=>Cell[]):Row[]{
  if(items.length<=cap)return Array.from({length:cap},(_,i)=>row(items[i],i));
  annex.push({label:what,text:items.slice(cap-1).map((t,i)=>describe(t,cap-1+i)).join('\n')});
  return [...items.slice(0,cap-1).map(row),{note:'+'+(items.length-cap+1)+' más: ver anexo '+annex.length}];
 }

 // Sheet 1: identification, agreements, household, risks, routes and sketch.
 let pg=sheet();
 // The institutional logo takes the top-right corner on a white card of its own: its purple marks vanish on navy.
 const [logo]=await doc.embedPdf(cgregLogoPdf),logoH=52,logoW=logoH*logo.width/logo.height;
 card(pg,W-M-logoW-12,10,logoW+12,62);pg.drawPage(logo,{x:W-M-logoW-6,y:H-15-logoH,width:logoW,height:logoH});
 banner(pg,'PLAN FAMILIAR DE EMERGENCIAS',19,44,27,CW-logoW-20);
 const a=[140,225,112,CW-140-225-112-18];let x=M;
 let t=field(pg,'FAMILIA',x,80,a[0],45);answer(pg,p.family,x+6,t+2,a[0]-12,30,'Familia',{size:10,min:6,font:xb});x+=a[0]+6;
 t=field(pg,'DIRECCIÓN',x,80,a[1],45);answer(pg,p.address,x+6,t+3,a[1]-12,15,'Dirección completa de la vivienda',{size:7.5,min:5.4,font:bold});
 hline(pg,x+6,t+19.5,a[1]-12);inline(pg,'BARRIO / SECTOR',p.sector,x+6,t+21,a[1]*.64-10,12,'Barrio, sector, ciudad o comunidad',{size:6.4});inline(pg,'ISLA',p.island,x+a[1]*.64,t+21,a[1]*.36-6,12,'Isla',{size:6.4});x+=a[1]+6;
 t=field(pg,'TELÉFONOS',x,80,a[2],45);inline(pg,'PRINCIPAL',p.phone,x+6,t+2,a[2]-12,15,'Teléfono principal');hline(pg,x+6,t+17,a[2]-12);inline(pg,'ALTERNO',p.altPhone,x+6,t+18,a[2]-12,15,'Teléfono alternativo');x+=a[2]+6;
 t=field(pg,'FECHA',x,80,a[3],45);tiny(pg,'ELABORADO',x+6,t+5,a[3]-12);answer(pg,date(p.date),x+5,t+13,a[3]-10,14,'Fecha de elaboración',{size:7.6,min:5.4,font:xb});
 const b=(CW-12)/3;x=M;
 t=field(pg,'SI NOS SEPARAMOS',x,131,b,47,C.orange,C.white);say(pg,'Nos encontraremos en:',x+6,t+3,b-12,7,{size:5.6,color:C.muted});answer(pg,p.meeting,x+6,t+11,b-12,23,'Si nos separamos',{size:7.4,font:bold});x+=b+6;
 // A text message usually gets through a saturated network that drops calls.
 t=field(pg,'SI NO ENTRAN LAS LLAMADAS',x,131,b,47,C.orange,C.white);say(pg,'Enviaremos un mensaje de texto (SMS) a:',x+6,t+3,b-12,7,{size:5.6,color:C.muted});answer(pg,p.noSignal,x+6,t+11,b-12,23,'Si las llamadas no entran',{size:7.4,font:bold});x+=b+6;
 t=field(pg,'SI HAY UNA ALERTA',x,131,b,47,C.orange,C.white);say(pg,'Escucharemos fuentes oficiales y seguiremos las indicaciones.',x+6,t+3,b-12,31,{size:7.4,font:bold});

 heading(pg,'NUESTRA FAMILIA Y SUS APOYOS',M,186,CW);card(pg,M,200,CW,115);
 const num=(i:number):Cell=>(cx,top,w,h)=>{shape(pg,rr(cx,top,w,h),{fill:C.navy});say(pg,String(i+1),cx,top,w,h,{size:6.5,font:xb,color:C.white,align:'center'});};
 table(pg,M+5,205,[{head:'#',w:14,align:'center'},{head:'Nombre y apellido',w:128},{head:'Edad',w:26,align:'center'},{head:'Relación',w:68},{head:'Teléfono',w:66},{head:'Apoyos requeridos (medicina, movilidad, cuidado, comunicación)',w:150},{head:'Rol',w:93}],
  listRows(p.members,6,'Nuestra familia y sus apoyos · integrantes adicionales',(m,i)=>'Integrante '+(i+1)+': '+m.name+' | Edad: '+m.age+' | Relación: '+m.relation+' | Teléfono: '+(m.phone||'-')+' | Apoyos: '+(m.support||'Ninguno')+' | Rol: '+m.role,
   (m,i)=>[num(i),m?.name??'',m?String(m.age):'',m?.relation??'',m?.phone??'',m?(m.support||'Ninguno'):'',m?.role??'']),15,(r,c)=>'Integrante '+(r+1)+' · '+['','Nombre y apellido','Edad','Relación','Teléfono','Apoyos requeridos','Rol'][c]);

 heading(pg,'RIESGOS QUE DEBEMOS PREPARAR',M,323,CW);card(pg,M,337,CW,115);
 const priority={Alta:C.red,Media:C.orange,Baja:C.sky};
 const hazardCell=(type:string,label:string):Cell=>(cx,top,w,h)=>{badge(pg,type,cx+4,top+(h-18)/2,18);answer(pg,type,cx+27,top+1.5,w-30,h-3,label,{size:7,font:bold});};
 table(pg,M+5,342,[{head:'Riesgo',w:112},{head:'¿Qué puede pasar?',w:118},{head:'Qué haremos para reducirlo',w:128},{head:'Primer paso si ocurre',w:127},{head:'Prioridad',w:60,align:'center'}],
  Array.from({length:3},(_,i)=>{const r=p.risks[i];return r?[hazardCell(r.type,'Riesgo '+(i+1)),r.effect,r.prevention,r.first,(cx,top,w,h)=>pill(pg,r.priority.toUpperCase(),cx,top,w,h,priority[r.priority])]:['','','','',''];}),30,
  (r,c)=>'Riesgo '+(r+1)+' · '+['Riesgo','¿Qué puede pasar?','Qué haremos para reducirlo','Primer paso si ocurre','Prioridad'][c]);

 heading(pg,'RUTAS, PUNTOS SEGUROS Y COMUNICACIÓN',M,460,CW);card(pg,M,474,CW,113);
 table(pg,M+5,479,[{head:'Situación',w:120},{head:'Ruta o salida segura',w:150},{head:'Punto de encuentro',w:135},{head:'Quién avisa a todos y cómo',w:140}],
  p.routes.map((r,i)=>[hazardCell(r.situation,'Ruta '+(i+1)+' · Situación'),r.route,r.point,r.notice]),22,
  (r,c)=>(p.routes[r]?.situation??'Ruta')+' · '+['Situación','Ruta o salida segura','Punto de encuentro','Quién avisa a todos y cómo'][c]);

 heading(pg,'CROQUIS DE NUESTRA VIVIENDA Y ALREDEDORES',M,595,CW);card(pg,M,609,CW,209);
 const sx=M+6,sw=318,st=615,sh=197;
 shape(pg,rr(sx,st,sw,sh,3),{fill:C.paper,stroke:C.rule,width:.6,dash:[2,2]});
 // The legend is a strip at the foot of the sketch, which is where its symbols get drawn.
 const lt=st+sh-30;
 if(p.sketch)contain(pg,await doc.embedJpg(p.sketch),sx+4,st+4,sw-8,lt-st-8);
 else{for(let gy=st+12;gy<lt-4;gy+=12)for(let gx=sx+12;gx<sx+sw-4;gx+=12)circle(pg,gx,gy,.55,C.dot);tiny(pg,'DIBUJE AQUÍ',sx+8,st+8,120,C.muted);}
 const rx=sx+sw+10,rw=M+CW-6-rx;let ry=st;
 if(p.location){
  tab(pg,'UBICACIÓN DE LA VIVIENDA',rx,ry);ry+=12;
  // Same proportions as the form's 900 x 585 capture, trimmed at top and bottom when the column is shorter
  // than that: cover keeps the centre, where the capture always has the pin. 53 is what follows the map.
  if(p.location.snapshot){const mh=Math.min(rw*585/900,st+sh-ry-53);cover(pg,await doc.embedJpg(p.location.snapshot),rx,ry,rw,mh);shape(pg,rr(rx,ry,rw,mh),{stroke:C.rule});ry+=mh+5;}else ry+=4;
  say(pg,'Latitud '+p.location.lat.toFixed(6)+'  ·  Longitud '+p.location.lng.toFixed(6),rx,ry,rw,8,{size:6,color:C.muted});ry+=10;
  say(pg,'Abrir punto en Google Maps',rx,ry,rw,8,{size:6.6,font:bold,color:C.sky});
  const uri='https://www.google.com/maps/search/?api=1&query='+p.location.lat+','+p.location.lng;
  pg.node.addAnnot(doc.context.register(doc.context.obj({Type:'Annot',Subtype:'Link',Rect:[rx,H-ry-9,rx+bold.widthOfTextAtSize('Abrir punto en Google Maps',6.6),H-ry+1],Border:[0,0,0],A:{Type:'Action',S:'URI',URI:PDFString.of(uri)}})));
  ry+=14;
 }
 tiny(pg,'REFERENCIA CERCANA',rx,ry,rw);answer(pg,p.reference,rx,ry+7,rw,16,'Referencia cercana',{size:7,font:bold});hline(pg,rx,ry+24,rw);ry+=31;
 hline(pg,sx+6,lt,sw-12);tiny(pg,'LEYENDA',sx+8,lt+10,36);
 const legend:[string,(lx:number,ly:number)=>void][]=[
  ['Ruta de salida',(lx,ly)=>shape(pg,`M${lx} ${ly+4}H${lx+11}M${lx+7} ${ly+1}L${lx+11} ${ly+4}L${lx+7} ${ly+7}`,{stroke:C.sky,width:1.3})],
  ['Punto de encuentro',(lx,ly)=>shape(pg,Array.from({length:10},(_,j)=>{const g=-Math.PI/2+j*Math.PI/5,r=j%2?2.2:5;return (j?'L':'M')+(lx+5.5+Math.cos(g)*r)+' '+(ly+4.5+Math.sin(g)*r);}).join('')+'Z',{fill:C.orange})],
  ['Zona de peligro',(lx,ly)=>shape(pg,`M${lx+5.5} ${ly}L${lx+11} ${ly+9}H${lx}Z`,{fill:C.red})],
  ['Extintor o botiquín',(lx,ly)=>circle(pg,lx+5.5,ly+4.5,4,C.navy)],
  ['Llave de gas, agua o energía',(lx,ly)=>shape(pg,rr(lx+1,ly,9,9,1),{stroke:C.navy,width:.9})],
 ];
 const lw=(sw-56)/3;
 legend.forEach(([name,icon],i)=>{const lx=sx+48+(i%3)*lw,ly=lt+5+Math.floor(i/3)*12;icon(lx,ly);say(pg,name,lx+15,ly,(i===4?2*lw:lw)-17,9,{size:6.2,min:4.6});});

 // Sheet 2, top half: contacts, pets, resources, actions, rules, practice and commitment.
 pg=sheet();
 const nw=290,pw=CW-nw-8;
 heading(pg,'NÚMEROS DE EMERGENCIA',M,16,nw);heading(pg,'MASCOTAS O ANIMALES A CONSIDERAR',M+nw+8,16,pw);
 card(pg,M,30,nw,116);card(pg,M+nw+8,30,pw,116);
 x=M+5;
 shape(pg,rr(x,35,nw-10,13,2),{fill:C.pale});say(pg,'CONTACTO',x+4,36,160,11,{size:5.6,font:xb});say(pg,'NÚMERO TELEFÓNICO',x+174,36,100,11,{size:5.6,font:xb});
 phoneBadge(pg,x+3,52,14);tiny(pg,'CONTACTO FUERA DE LA ZONA',x+22,51.5,145);answer(pg,p.contact,x+22,58,146,10,'Persona de contacto fuera de la zona',{size:7,min:5,font:bold});
 vline(pg,x+170,48,22);answer(pg,p.contactPhone,x+174,50,nw-10-178,18,'Teléfono de esa persona',{size:7.6,min:5.4,font:bold});hline(pg,x,70,nw-10);
 phoneBadge(pg,x+3,74,14);tiny(pg,'OTROS TELÉFONOS ÚTILES',x+22,73,250);answer(pg,p.usefulPhones,x+22,80,nw-10-26,22,'Teléfonos útiles',{size:6.8,min:5,valign:'top'});hline(pg,x,104,nw-10);
 circle(pg,x+19,125,16,C.sky);pg.drawImage(phone,{x:x+8,y:H-136,width:22,height:22});
 const nine='9-1-1';pg.drawText(nine,{x:x+42,y:H-136,size:29,font:black,color:C.red});
 const nx=x+42+black.widthOfTextAtSize(nine,29)+7;
 say(pg,'LÍNEA ÚNICA PARA',nx,113,nw-10-(nx-x),9,{size:8.2,font:xb,color:C.grey});say(pg,'EMERGENCIAS',nx,123,nw-10-(nx-x),12,{size:11.6,font:black,color:C.grey});
 table(pg,M+nw+13,35,[{head:'Nombre o tipo de animal',w:72},{head:'Quién se encarga',w:65},{head:'Qué necesita llevar (correa, agua, alimento, transportadora)',w:pw-10-137}],
  listRows(p.pets,4,'Mascotas o animales adicionales',m=>m.name+' | Quién se encarga: '+m.keeper+' | Qué necesita llevar: '+m.needs,m=>[m?.name??'',m?.keeper??'',m?.needs??'']),23,
  (r,c)=>'Mascota '+(r+1)+' · '+['Nombre o tipo de animal','Quién se encarga','Qué necesita llevar'][c]);

 const rw2=300,aw=CW-rw2-8;
 heading(pg,'MOCHILA Y RECURSOS DISPONIBLES',M,154,rw2);heading(pg,'ACCIONES ANTES, DURANTE Y DESPUÉS',M+rw2+8,154,aw);
 card(pg,M,168,rw2,169);card(pg,M+rw2+8,168,aw,169);
 const have=(on:boolean):Cell=>(cx,top,w,h)=>{const y=top+(h-5.5)/2;check(pg,cx+4,y,5.5,on);say(pg,'Sí',cx+11,y,10,5.5,{size:5.4,font:bold});check(pg,cx+21,y,5.5,!on);say(pg,'No',cx+28,y,12,5.5,{size:5.4,font:bold});};
 table(pg,M+5,173,[{head:'Elemento',w:104},{head:'Tenemos',w:40,align:'center'},{head:'Cantidad',w:64},{head:'Dónde está guardado',w:82}],
  p.resources.map(r=>[(cx,top,w,h)=>answer(pg,r.item,cx+3,top+1,w-6,h-2,r.item,{size:6,min:4.8,font:bold}),have(r.status==='Sí'),r.amount,r.location]),16,
  (r,c)=>(p.resources[r]?.item??'Recurso')+' · '+['Elemento','Tenemos','Cantidad','Dónde está guardado'][c]);
 const moment={Antes:C.sky,Durante:C.orange,Después:C.purple};
 const planned=p.actions.filter(item=>item.action);
 table(pg,M+rw2+13,173,[{head:'Momento',w:38,align:'center'},{head:'Acción concreta',w:aw-10-104},{head:'Responsable',w:66}],
  listRows(planned,6,'Acciones familiares adicionales',item=>item.moment+': '+item.action+' | Responsable: '+item.person,
   item=>[item?(cx,top,w,h)=>pill(pg,item.moment.toUpperCase(),cx,top,w,h,moment[item.moment]):'',item?.action??'',item?.person??'']),24,
  (r,c)=>'Acción '+(r+1)+' · '+['Momento','Acción concreta','Responsable'][c]);

 const cw3=196,kw=CW-2*cw3-16;
 heading(pg,'REGLAS SIMPLES QUE TODOS CONOCEN',M,345,cw3);heading(pg,'PRÓXIMO SIMULACRO',M+cw3+8,345,cw3);heading(pg,'COMPROMISO FAMILIAR',M+2*cw3+16,345,kw);
 card(pg,M,359,cw3,93);card(pg,M+cw3+8,359,cw3,93);card(pg,M+2*cw3+16,359,kw,93);
 [['ANTES DE SALIR','Tomamos la mochila y solo lo imprescindible.'],['AL EVACUAR','No usamos ascensores. Ayudamos sin ponernos en riesgo.'],['AL LLEGAR AL PUNTO SEGURO','Pasamos lista. No regresamos hasta que sea seguro.']].forEach(([name,rule],i)=>{
  const top=364+i*29;circle(pg,M+13,top+9,7,C.orange);say(pg,String(i+1),M+6,top+2,14,14,{size:7.5,font:black,color:C.white,align:'center'});
  say(pg,name,M+26,top+1,cw3-32,7,{size:5.8,font:xb,color:C.sky});say(pg,rule,M+26,top+9,cw3-32,17,{size:6.4,valign:'top'});
  if(i<2)hline(pg,M+26,top+27.5,cw3-32);
 });
 x=M+cw3+8;
 // What to improve is only known after the drill, so that cell stays blank to be written by hand.
 const practice:[string,string,string][]=[['FECHA',date(p.practice.date),'Fecha'],['QUIÉN LO ORGANIZA',p.practice.person,'Quién lo organiza'],['QUÉ VAMOS A ENSAYAR',p.practice.exercise,'Qué vamos a ensayar'],['QUÉ MEJORAREMOS','','']];
 practice.forEach(([name,value,label],i)=>{const fx=x+6+(i%2)*(cw3-12)/2,fy=364+Math.floor(i/2)*42,fw=(cw3-12)/2-5;tiny(pg,name,fx,fy,fw);if(label)answer(pg,value,fx,fy+8,fw,26,'Próximo simulacro · '+label,{size:6.8,min:5,font:bold});else say(pg,'Anótenlo después del simulacro.',fx,fy+8,fw,8,{size:5.4,color:C.muted});hline(pg,fx,fy+36,fw);});
 x=M+2*cw3+16;
 say(pg,'Conversamos este plan en familia, lo tendremos a la vista y lo practicaremos al menos una vez al año.',x+6,364,kw-12,25,{size:6.4,valign:'top'});
 tiny(pg,'FIRMA DE QUIENES PARTICIPARON',x+6,392,kw-12);
 // The line sits where the form's pad draws it, so the signature lands on it as it did on screen; without one it is left to sign on paper.
 hline(pg,x+6,400+46*.72,kw-12);if(p.signature)contain(pg,await doc.embedPng(p.signature),x+6,400,kw-12,46);

 // Sheet 2, bottom half: the emergency backpack.
 shape(pg,rr(M,476,CW,84,6),{fill:C.purple});
 const bag=await doc.embedPng(backpackPng);pg.drawImage(bag,{x:M+16,y:H-460-118,width:118*bag.width/bag.height,height:118});
 say(pg,'CONTENIDO DE LA',M+140,489,240,9,{size:8.4,font:xb,color:C.orange});
 say(pg,'Mochila de emergencia',M+140,501,CW-170,24,{size:27,font:black,color:C.white});
 say(pg,'Revisen agua, alimentos y medicamentos cada seis meses.',M+140,535,CW-170,10,{size:7.6,color:C.pale});
 sparks(pg,M+CW-24,500,6,12,[-110,-75,-40,-5,30]);
 const kw2=(CW-12)/3;
 for(const [i,[key,title,text]] of KIT.entries()){
  const kx=M+(i%3)*(kw2+6),ky=584+Math.floor(i/3)*78;card(pg,kx,ky,kw2,72);
  pg.drawImage(await doc.embedJpg(kitJpg[key]),{x:kx+6,y:H-ky-63,width:54,height:54});
  const tw=kw2-74,tl=fit(title,tw,20,7,5.6,xb)!,dl=fit(text,tw,40,6.1,4.8,med)!;
  const top=ky+(72-(blockH(tl.ls.length,tl.size)+4+blockH(dl.ls.length,dl.size)+dl.size*.22))/2;
  lines(pg,tl.ls,kx+66,top,tw,tl.size,xb,C.navy);lines(pg,dl.ls,kx+66,top+blockH(tl.ls.length,tl.size)+4+dl.size*.26,tw,dl.size,med,C.muted);
 }

 // Annex: answers that did not fit, in full.
 let top=0;
 const annexSheet=()=>{pg=sheet();banner(pg,'ANEXO · RESPUESTAS COMPLETAS',16,34,20);card(pg,M,62,CW,756);top=76;};
 if(annex.length)annexSheet();
 annex.forEach((e,i)=>{
  const head=wrap(clean('['+(i+1)+'] '+e.label),CW-28,8,xb),body=wrap(e.text,CW-28,7.6,med);
  if(top+blockH(head.length,8)+16>806)annexSheet();
  lines(pg,head,M+14,top,CW-28,8,xb,C.orange);top+=head.length*8*LH+3;
  for(const s of body){if(top+7.6>806){annexSheet();lines(pg,['['+(i+1)+'] continuación'],M+14,top,CW-28,8,xb,C.orange);top+=8*LH+3;}lines(pg,[s],M+14,top,CW-28,7.6,med,C.navy);top+=7.6*LH;}
  top+=10;
 });
 const all=doc.getPages();
 let family=clean('Plan Familiar de Emergencias · '+p.family).replace(/\n/g,' ');
 if(med.widthOfTextAtSize(family,6)>CW-60){while(med.widthOfTextAtSize(family+'…',6)>CW-60)family=family.slice(0,-1);family=family.trimEnd()+'…';}
 all.forEach((page,i)=>{
  const n=(i+1)+' / '+all.length;
  lines(page,[family],M,826,CW-60,6,med,C.footer);
  page.drawText(n,{x:W-M-bold.widthOfTextAtSize(n,6.5),y:H-826-6.5*.74,size:6.5,font:bold,color:C.footer});
 });
 return await doc.save();
}
