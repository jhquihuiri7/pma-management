import {PDFDocument,StandardFonts,rgb,PDFName,PDFString,pushGraphicsState,popGraphicsState,rectangle,clip,endPath} from 'pdf-lib';
import {headerJpg,footerJpg,backpackPng} from './branding-assets.js';
import type {FamilyEmergencyPlanInput} from './model.js';

// The seven main pages retain the supplied document's headings, tables and order.
// Long answers and additional household rows continue in a clearly referenced annex.
export async function createFamilyPlanPdf(p:FamilyEmergencyPlanInput,_id:string,_createdAt:Date){
 const doc=await PDFDocument.create();
 doc.setTitle('Plan Familiar de Emergencias - '+p.family);doc.setAuthor('CGREG / DGTAR');
 const regular=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
 const W=595.28,H=841.89,M=36,CW=W-2*M;
 const ink=rgb(.13,.18,.19),teal=rgb(.075,.48,.5),blue=rgb(.075,.36,.52),line=rgb(.64,.71,.71),pale=rgb(.94,.97,.98),white=rgb(1,1,1);
 const bodyScale=.82,bodyOffset=H-82-H*bodyScale;
 // Reserve the original Word letterhead/footer zones while retaining readable fonts.
 function bodyPage(actual:any){return {
  drawText:(value:any,o:any)=>actual.drawText(value,{...o,y:bodyOffset+o.y*bodyScale}),
  drawRectangle:(o:any)=>actual.drawRectangle({...o,y:bodyOffset+o.y*bodyScale,height:o.height*bodyScale}),
  drawLine:(o:any)=>actual.drawLine({...o,start:{x:o.start.x,y:bodyOffset+o.start.y*bodyScale},end:{x:o.end.x,y:bodyOffset+o.end.y*bodyScale}}),
  drawCircle:(o:any)=>actual.drawCircle({...o,y:bodyOffset+o.y*bodyScale,size:o.size*bodyScale}),
  drawImage:(image:any,o:any)=>actual.drawImage(image,{...o,x:o.x+o.width*(1-bodyScale)/2,y:bodyOffset+o.y*bodyScale,width:o.width*bodyScale,height:o.height*bodyScale})
 };}
 const pages=Array.from({length:7},()=>bodyPage(doc.addPage([W,H])));
 type Extra={label:string,text:string};
 const extra:Extra[]=[];
 const clean=(v:unknown)=>String(v??'').replace(/[^\x20-\x7e\xa0-\xff\n]/g,' ').replace(/[ \t]+/g,' ').trim();
 const date=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)?v.split('-').reverse().join('/'):v;
 const wrap=(value:string,width:number,size:number,font=regular)=>{
  const out:string[]=[];
  for(const paragraph of clean(value).split('\n')){
   let acc='';
   for(const word of paragraph.split(/\s+/)){
    if(font.widthOfTextAtSize(word,size)>width){
     if(acc){out.push(acc);acc='';}
     let chunk='';for(const ch of word){if(font.widthOfTextAtSize(chunk+ch,size)>width){out.push(chunk);chunk=ch;}else chunk+=ch;}acc=chunk;
    }else if(font.widthOfTextAtSize((acc?acc+' ':'')+word,size)>width){out.push(acc);acc=word;}else acc+=(acc?' ':'')+word;
   }out.push(acc);
  }return out;
 };
 function text(pg:any,value:string,x:number,top:number,width=CW,size=9,isBold=false,color=ink){
  const font=isBold?bold:regular;const lines=wrap(value,width,size,font);
  lines.forEach((s,i)=>{if(s)pg.drawText(s,{x,y:H-top-size-i*size*1.25,size,font,color});});return lines.length*size*1.25;
 }
 function rect(pg:any,x:number,top:number,w:number,h:number,fill?:any){pg.drawRectangle({x,y:H-top-h,width:w,height:h,borderColor:line,borderWidth:.5,...(fill?{color:fill}:{})});}
 function answer(pg:any,value:unknown,x:number,top:number,w:number,h:number,label:string){
  const full=clean(value);if(!full)return;
  let size=10;let lines=wrap(full,w-10,size);
  while(lines.length*size*1.22>h-8&&size>8){size-=.5;lines=wrap(full,w-10,size);}
  if(lines.length*size*1.22>h-8){extra.push({label,text:full});lines=wrap('Ver anexo ['+extra.length+']',w-10,9);size=9;}
  lines.forEach((s,i)=>pg.drawText(s,{x:x+5,y:H-top-5-size-i*size*1.22,size,font:regular,color:teal}));
 }
 function section(pg:any,n:number,name:string,desc:string,top:number,h=65){
  rect(pg,M,top,CW/2,h,teal);rect(pg,M+CW/2,top,CW/2,h,blue);
  pg.drawText(String(n),{x:M+CW/4-6,y:H-top-h/2-7,size:20,font:bold,color:white});
  let t=top+6;t+=text(pg,name,M+CW/2+8,t,CW/2-16,11,true,white)+4;text(pg,desc,M+CW/2+8,t,CW/2-16,10,true,white);
 }
 function how(pg:any,value:string,top:number){return text(pg,'Cómo llenarlo: '+value,M,top,CW,9);}
 function table(pg:any,headers:string[],widths:number[],top:number,heights:number[],rows:string[][],labels:string[]){
  let x=M;headers.forEach((head,i)=>{rect(pg,x,top,widths[i],36,blue);text(pg,head,x+5,top+5,widths[i]-10,8.3,true,white);x+=widths[i];});
  let t=top+36;heights.forEach((h,r)=>{let x=M;widths.forEach((w,c)=>{rect(pg,x,t,w,h,pale);answer(pg,rows[r]?.[c]||'',x,t,w,h,labels[r]+' · '+headers[c]);x+=w;});t+=h;});return t;
 }
 function field(pg:any,label:string,value:string,x:number,top:number,w=253){
  text(pg,label,x,top,w,9);pg.drawLine({start:{x,y:H-top-39},end:{x:x+w,y:H-top-39},thickness:.5,color:line});answer(pg,value,x,top+12,w,27,label);
 }
 function box(pg:any,title:string,value:string,x:number,top:number,w:number,label=title){
  rect(pg,x,top,w,78);rect(pg,x,top,w,24,blue);text(pg,title,x+8,top+7,w-16,9,true,white);answer(pg,value,x+3,top+27,w-6,48,label);
 }
 function tick(pg:any,x:number,top:number,on:boolean){
  rect(pg,x,top,8,8);if(on){pg.drawLine({start:{x:x+1.5,y:H-top-4},end:{x:x+3.5,y:H-top-6.5},thickness:1,color:teal});pg.drawLine({start:{x:x+3.5,y:H-top-6.5},end:{x:x+7,y:H-top-1.5},thickness:1,color:teal});}
 }
 // Page 1: personal data and family agreements.
 let pg=pages[0];
 text(pg,'Plan Familiar de Emergencias',164,25,400,18,true);
 text(pg,'Formato sencillo para conversar, acordar y practicar en familia',124,52,440,10);
 text(pg,'Este plan ayuda a que todas las personas de la familia sepan qué hacer antes, durante y después de una emergencia. Llénenlo juntos, guárdenlo en un lugar visible y practiquen al menos una vez al año.',M,89,CW,9);
 section(pg,1,'Datos y acuerdos principales','Empiecen por lo más importante: quiénes son, dónde viven y cómo se comunicarán.',149,78);
 const fields=[['Nombre de la familia o persona responsable',p.family,'Fecha de elaboración',date(p.date)],['Dirección completa de la vivienda',p.address,'Barrio, sector, ciudad o comunidad',p.sector],['Teléfono principal',p.phone,'Teléfono alternativo',p.altPhone],['Persona de contacto fuera de la zona',p.contact,'Teléfono de esa persona',p.contactPhone]];
 fields.forEach((f,i)=>{field(pg,f[0],f[1],M,251+i*57);field(pg,f[2],f[3],306,251+i*57);});
 text(pg,'Acuerdo familiar rápido',M,496,CW,11,true);
 const bw=(CW-12)/3;
 box(pg,'Si nos separamos','Nos encontraremos en: '+p.meeting,M,521,bw);
 box(pg,'Si no hay señal','Enviaremos mensaje de texto a: '+p.noSignal,M+bw+6,521,bw);
 box(pg,'Si hay una alerta','Escucharemos fuentes oficiales y seguiremos las indicaciones.',M+(bw+6)*2,521,bw);
 text(pg,'Revisión del plan:',M,625,100,9,true);
 field(pg,'Fecha',date(p.reviewDate),136,615,125);field(pg,'Responsable de actualizarlo',p.updater,275,615,284);
 section(pg,2,'Nuestra familia y sus apoyos','Incluyan a quienes viven, pasan mucho tiempo o dependen del hogar.',684,61);
 how(pg,'Escriban un nombre por fila. Marquen los apoyos que una persona pueda necesitar durante una emergencia.',763);
 // Page 2: household, animals and three risks.
 pg=pages[1];
 const mw=[137,35,66,79,124,CW-441];const visibleMembers=p.members.slice(0,3);
 table(pg,['Nombre y apellido','Edad','Relación','Teléfono','Apoyos requeridos (medicina, movilidad, cuidado, comunicación)','Rol'],mw,30,[30,30,30],visibleMembers.map(m=>[m.name,String(m.age),m.relation,m.phone,m.support||'Ninguno',m.role]),['Integrante 1','Integrante 2','Integrante 3']);
 if(p.members.length>3){extra.push({label:'Nuestra familia y sus apoyos · integrantes adicionales',text:p.members.slice(3).map((m,i)=>'Integrante '+(i+4)+': '+m.name+' | Edad: '+m.age+' | Relación: '+m.relation+' | Teléfono: '+m.phone+' | Apoyos: '+(m.support||'Ninguno')+' | Rol: '+m.role).join('\n')});text(pg,'Más integrantes: ver anexo ['+extra.length+'].',M,160,CW,8);}
 text(pg,'Roles sugeridos: guía a niñas, niños o adultos mayores; lleva mochila; cierra servicios si es seguro; cuida mascotas; verifica que todos estén presentes. Elijan roles posibles y sustitutos.',M,179,CW,8.5);
 text(pg,'Mascotas o animales a considerar',M,219,CW,10,true);
 table(pg,['Nombre o tipo de animal','Quién se encarga','Qué necesita llevar (correa, agua, alimento, transportadora)'],[175,175,CW-350],239,[36],p.pets.slice(0,1).map(m=>[m.name,m.keeper,m.needs]),['Mascota 1']);
 if(p.pets.length>1){extra.push({label:'Mascotas o animales adicionales',text:p.pets.slice(1).map(m=>m.name+' | Quién se encarga: '+m.keeper+' | Qué necesita llevar: '+m.needs).join('\n')});text(pg,'Más animales: ver anexo ['+extra.length+'].',M,314,CW,8);}
 section(pg,3,'Riesgos que debemos preparar','Identifiquen los tres riesgos que más pueden afectar a su familia o vivienda.',337,67);
 how(pg,'No hace falta llenar todo. Escojan los riesgos que realmente aplican: sismo, inundación, incendio, deslizamiento, caída de ceniza, vendaval, accidente u otro.',423);
 table(pg,['Riesgo','¿Qué puede pasar?','Qué haremos para reducirlo','Primer paso si ocurre','Prioridad'],[82,119,137,117,CW-455],467,[61,61,61],p.risks.map(r=>[r.type,r.effect,r.prevention,r.first,r.priority]),['Riesgo 1','Riesgo 2','Riesgo 3']);
 section(pg,4,'Rutas, puntos seguros y comunicación','Dibujen y acuerden una salida clara.',722,68);
 // Page 3: routes, shared rules, sketch instructions.
 pg=pages[2];text(pg,'Siempre tengan una alternativa.',324,27,235,10);
 how(pg,'Para cada emergencia, definan a dónde ir, cómo salir y quién avisa a la persona de contacto.',66);
 table(pg,['Situación','Ruta o salida segura','Punto de encuentro','Quién avisa / cómo'],[110,143,134,CW-387],109,[52,52,52],p.routes.map(r=>[r.situation,r.route,r.point,r.notice]),p.routes.map(r=>r.situation));
 text(pg,'Reglas simples que todos conocen',M,327,CW,11,true);
 box(pg,'Antes de salir','Tomamos la mochila y solo lo imprescindible.',M,356,bw);
 box(pg,'Al evacuar','No usamos ascensores. Ayudamos sin ponernos en riesgo.',M+bw+6,356,bw);
 box(pg,'Al llegar al punto seguro','Pasamos lista. No regresamos hasta que sea seguro.',M+(bw+6)*2,356,bw);
 section(pg,5,'Croquis de nuestra vivienda y alrededores','Un dibujo simple puede orientar mucho más rápido que una explicación.',476,87);
 how(pg,'Dibujen el lugar donde viven. Usen la leyenda y agreguen calles, referencias y el punto de encuentro.',589);
 // Page 4: full drawing area and legend.
 pg=pages[3];const drawingHeight=p.location?.snapshot?416:714;rect(pg,M,32,360,drawingHeight);
 if(p.sketch){
  const bytes=Uint8Array.from(atob(p.sketch.split(',')[1]),c=>c.charCodeAt(0));const img=await doc.embedJpg(bytes);
  const room=drawingHeight-30,size=img.scale(Math.min(340/img.width,room/img.height));pg.drawImage(img,{x:M+10+(340-size.width)/2,y:H-32-15-(room+size.height)/2,width:size.width,height:size.height});
 }else{text(pg,'DIBUJE AQUÍ',M+13,48,330,10,true);}
 if(p.location?.snapshot){
  text(pg,'Ubicación de la vivienda',M,466,360,11,true);
  const img=await doc.embedJpg(Uint8Array.from(atob(p.location.snapshot.split(',')[1]),c=>c.charCodeAt(0)));const size=img.scale(Math.min(360/img.width,250/img.height));
  pg.drawImage(img,{x:M+(360-size.width)/2,y:H-488-size.height,width:size.width,height:size.height});
 }
 text(pg,'LEYENDA',416,61,140,11,true);
 const legend=['Ruta de salida','Punto de encuentro','Zona de peligro','Extintor o botiquín','Llave de gas, agua o energía'];
 legend.forEach((s,i)=>{const t=98+i*60;const x=418,y=H-t-6;
  if(i===0){pg.drawLine({start:{x,y},end:{x:x+13,y},color:teal,thickness:1.5});pg.drawLine({start:{x:x+8,y:y+4},end:{x:x+13,y},color:teal,thickness:1.5});pg.drawLine({start:{x:x+8,y:y-4},end:{x:x+13,y},color:teal,thickness:1.5});}
  if(i===1){const pts=Array.from({length:10},(_,j)=>{const a=Math.PI/2+j*Math.PI/5,r=j%2?3:7;return [425+Math.cos(a)*r,y+Math.sin(a)*r];});pts.forEach((q,j)=>pg.drawLine({start:{x:q[0],y:q[1]},end:{x:pts[(j+1)%10][0],y:pts[(j+1)%10][1]},color:teal,thickness:1}));}
  if(i===2){pg.drawLine({start:{x,y:y-5},end:{x:x+7,y:y+6},color:teal,thickness:1});pg.drawLine({start:{x:x+7,y:y+6},end:{x:x+14,y:y-5},color:teal,thickness:1});pg.drawLine({start:{x:x+14,y:y-5},end:{x,y:y-5},color:teal,thickness:1});}
  if(i===3)pg.drawCircle({x:425,y,size:5,color:teal});
  if(i===4)rect(pg,x,t,13,13);
  text(pg,s,438,t,120,9);
 });
 field(pg,'Referencia cercana',p.reference,414,432,145);
 if(p.location){
  text(pg,'Coordenadas de la vivienda',414,504,145,10,true);
  text(pg,'Latitud: '+p.location.lat.toFixed(6),414,535,145,9);
  text(pg,'Longitud: '+p.location.lng.toFixed(6),414,554,145,9);
  text(pg,'Abrir punto en Google Maps',414,589,145,9,true,blue);
  const uri='https://www.google.com/maps/search/?api=1&query='+p.location.lat+','+p.location.lng;
  const y=bodyOffset+(H-608)*bodyScale;
  const link=doc.context.register(doc.context.obj({Type:'Annot',Subtype:'Link',Rect:[414,y,560,y+19],Border:[0,0,0],A:{Type:'Action',S:'URI',URI:PDFString.of(uri)}}));
  doc.getPages()[3].node.addAnnot(link);
 }
 // Page 5: equipment checklist.
 pg=pages[4];
 section(pg,6,'Mochila y recursos disponibles','Revisen lo que ya tienen y anoten dónde está. No es necesario comprar todo de una vez.',34,78);
 how(pg,'Marquen lo disponible y prioricen lo pendiente. Revisen agua, alimentos y medicamentos cada seis meses.',134);
 const rw=[162,44,97,113,CW-416],rt=184,rh=60;
 table(pg,['Elemento','Tengo','Cantidad o fecha','Dónde está guardado','Pendiente'],rw,rt,Array(9).fill(rh),p.resources.map(r=>[r.item,'',r.amount,r.location,r.pending]),p.resources.map(r=>r.item));
 p.resources.forEach((r,i)=>{const t=rt+36+i*rh;tick(pg,M+rw[0]+6,t+13,r.status==='Sí');text(pg,'Sí',M+rw[0]+19,t+12,20,9);tick(pg,M+rw[0]+6,t+36,r.status==='No');text(pg,'No',M+rw[0]+19,t+35,20,9);});
 // Page 6: useful numbers, six actions and practice.
 pg=pages[5];
 text(pg,'Teléfonos útiles: ECU 911: 9-1-1. Agreguen aquí los números de salud, bomberos, administración del barrio, familiares o vecinos de confianza:',M,28,CW,9);
 answer(pg,p.usefulPhones,M,57,CW,35,'Teléfonos útiles');pg.drawLine({start:{x:M,y:H-95},end:{x:W-M,y:H-95},thickness:.5,color:line});
 section(pg,7,'Acciones familiares antes, durante y después','Conviertan las ideas en tareas pequeñas, con una persona responsable.',112,91);
 how(pg,'Anoten acciones realistas. Empiecen por las de prioridad alta y pónganles una fecha.',227);
 const aw=[72,232,105,69,CW-478],at=263,ah=42;
 table(pg,['Momento','Acción concreta','Responsable','Fecha','Listo'],aw,at,Array(6).fill(ah),p.actions.slice(0,6).map(a=>[a.moment,a.action,a.person,date(a.date),'']),Array.from({length:6},(_,i)=>'Acción '+(i+1)));
 p.actions.slice(0,6).forEach((a,i)=>tick(pg,M+478+17,at+36+i*ah+17,a.done));
 if(p.actions.length>6){extra.push({label:'Acciones familiares adicionales',text:p.actions.slice(6).map(a=>a.moment+': '+a.action+' | Responsable: '+a.person+' | Fecha: '+date(a.date)+' | Listo: '+(a.done?'Sí':'No')).join('\n')});text(pg,'Más acciones: ver anexo ['+extra.length+'].',M,557,CW,8);}
 section(pg,8,'Práctica y actualización','Un plan funciona cuando se conversa y se ensaya.',576,68);
 how(pg,'Después de un simulacro, anoten una mejora sencilla. Actualicen el plan si cambia la vivienda, un teléfono, una persona o una necesidad.',661);
 table(pg,['Fecha de práctica','Qué ensayamos','Qué mejoraremos','Quién lo hará'],[100,158,158,CW-416],705,[58],[[date(p.practice.date),p.practice.exercise,p.practice.improvement,p.practice.person]],['Práctica y actualización']);
 // Page 7: family commitment and participants, exactly as the reference.
 pg=pages[6];
 text(pg,'Compromiso familiar: conversamos este plan, sabemos dónde está guardado y nos comprometemos a practicarlo.',M,33,CW,10);
 text(pg,'Firma o nombres de quienes participaron:',M,83,CW,10);
 answer(pg,p.participants,M,102,CW,90,'Firma o nombres de quienes participaron');
 pg.drawLine({start:{x:M,y:H-199},end:{x:W-M,y:H-199},thickness:.5,color:line});
 // Overflow is never dropped or squeezed into illegible cells.
 let annex:any=null,top=0;
 const newAnnex=()=>{annex=bodyPage(doc.addPage([W,H]));text(annex,'Anexo de respuestas completas',M,30,CW,16,true);text(annex,p.family,M,56,CW,10);top=88;};
 extra.forEach((e,i)=>{if(!annex||top>730)newAnnex();const head=wrap('['+(i+1)+'] '+e.label,CW,10,bold);if(top+head.length*13+30>790)newAnnex();head.forEach(s=>{text(annex,s,M,top,CW,10,true);top+=13;});top+=5;wrap(e.text,CW,10).forEach(s=>{if(top+14>789){newAnnex();text(annex,'['+(i+1)+'] Continuación',M,top,CW,10,true);top+=20;}text(annex,s,M,top,CW,10);top+=13;});top+=18;});
 // The supplied backpack illustration is a fixed annex, not a questionnaire section.
 const backpack=await doc.embedPng(Uint8Array.from(atob(backpackPng),c=>c.charCodeAt(0)));
 const annexPage=doc.addPage([W,H]);
 annexPage.drawText('Anexo: mochila de emergencia',{x:M,y:H-107,size:15,font:bold,color:blue});
 const dim=backpack.scale(Math.min(480/backpack.width,625/backpack.height));
 annexPage.drawImage(backpack,{x:(W-dim.width)/2,y:H-120-dim.height,width:dim.width,height:dim.height});
 // Embed original Word artwork without redrawing its seals, logos or contact details.
 const header=await doc.embedJpg(Uint8Array.from(atob(headerJpg),c=>c.charCodeAt(0)));
 const footer=await doc.embedJpg(Uint8Array.from(atob(footerJpg),c=>c.charCodeAt(0)));
 function cropImage(page:any,image:any,x:number,top:number,w:number,h:number,cutTop:number,cutBottom:number){
  const fullH=h/(1-cutTop-cutBottom);
  page.pushOperators(pushGraphicsState(),rectangle(x,H-top-h,w,h),clip(),endPath());
  page.drawImage(image,{x,y:H-top-fullH+cutTop*fullH,width:w,height:fullH});
  page.pushOperators(popGraphicsState());
 }
 const all=doc.getPages();
 all.forEach((page,i)=>{
  cropImage(page,header,0,0,W,82,0,.27591);
  cropImage(page,footer,0,H-89,W,89,.34906,.05333);
  page.drawText('Página '+(i+1)+' | '+all.length,{x:445,y:65,size:9,font:regular,color:rgb(.329,.553,.831)});
 });
 return await doc.save();
}
