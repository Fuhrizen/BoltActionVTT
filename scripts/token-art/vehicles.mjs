/** Deterministic, layered tabletop vehicle symbols. Silhouettes are stylised, not scale drawings. */
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hash=value=>[...String(value)].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0);
export function vehicleShape(row={}){
 const name=String(row.name||row.slug||'vehicle').toLowerCase(),slug=String(row.slug||name),h=hash(slug),armour=Number(row.system?.damageValue||row.profile?.damageValue||8);
 const jeep=/jeep|kubelwagen|kurogane/.test(name),truck=/truck|gaz-aaa|katyusha/.test(name),half=/half.track|hanomag|m16|panzerwerfer|sdkfz 7/.test(name),carrier=/carrier|lvt/.test(name),car=/armoured car|greyhound|ba-64|234/.test(name),assault=/stug|marder|sturmhaubitze|su-|priest|m7/.test(name),aa=/aa|flak|tokarev/.test(name),rocket=/katyusha|panzerwerfer/.test(name);
 const heavy=/tiger|churchill|is-2/.test(name),light=/stuart|ha-go|tankette|bt-/.test(name),panther=/panther/.test(name),sherman=/sherman/.test(name),t34=/t-34/.test(name);
 const width=jeep?39:truck?46:car?43:heavy?62:light?45:panther?60:sherman?54:t34?55:52;
 const length=jeep?63:truck?91:carrier?77:heavy?91:light?73:panther?91:85;
 const open=Boolean(row.system?.openTopped)||truck||jeep||half||carrier||/m10|marder|priest|su-76/.test(name);
 const gun=String(row.weaponSlug||row.weaponLoadout?.[0]?.weaponSlug||''),barrel=rocket?0:/super-heavy|heavy-at/.test(gun)?36:/medium-at/.test(gun)?30:/light-at|howitzer/.test(gun)?24:/mmg|hmg/.test(gun)?15:22;
 return {slug,width,length,jeep,truck,half,carrier,car,assault,aa,rocket,heavy,light,open,barrel,armour,detail:h%4,turret:!jeep&&!truck&&!half&&!carrier&&!assault||aa};
}
export function renderVehicle({row={},palette={},options=[]}={}){
 const s=vehicleShape(row),optionText=options.map(o=>typeof o==='string'?o:JSON.stringify(o)).join(' ').toLowerCase();
 const p={uniform:'#64734d',helmet:'#435537',highlight:'#91a176',color:'#758353',...palette},dark='#202825',metal='#42494a',wood='#7d6849';
 const x=64-s.width/2,y=64-s.length/2,w=s.width,l=s.length,parts=[];
 const rect=(x,y,w,h,fill,rx=2,extra='')=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" ${extra}/>`;
 const line=(x1,y1,x2,y2,stroke,width=2)=>`<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${stroke}" stroke-width="${width}"/>`;
 // Running gear is always the bottom layer; all parts share the same centre and heading.
 parts.push('<g stroke="#151b18" stroke-width="1.4" stroke-linejoin="round">');
 if(s.jeep||s.truck||s.car){
  const axles=s.truck?[y+15,y+l-28,y+l-12]:[y+14,y+l-15];
  for(const axle of axles)for(const side of [x-5,x+w-3])parts.push(rect(side,axle-8,8,17,dark,2));
 }else{
  for(const side of [x-7,x+w-4]){
   const trackY=s.half?y+32:y+2,trackLength=s.half?l-34:l-4;
   parts.push(rect(side,trackY,11,trackLength,dark,4));
   for(let n=trackY+5;n<trackY+trackLength-3;n+=6)parts.push(line(side+1,n,side+10,n,'#646963',1));
  }
 }
 const chamfer=s.jeep?3:s.heavy?8:6;
 parts.push(`<path d="M${x+chamfer} ${y}H${x+w-chamfer}L${x+w} ${y+chamfer}V${y+l-6}L${x+w-6} ${y+l}H${x+6}L${x} ${y+l-6}V${y+chamfer}Z" fill="${p.uniform}"/>`);
 parts.push(rect(x+3,y+4,w-6,5,p.highlight,1));
 if(s.truck||s.jeep||s.half||s.carrier){
  const cab=s.jeep?22:26;
  parts.push(rect(x+4,y+5,w-8,cab,p.helmet,3),rect(x+7,y+cab-5,w-14,5,'#91aaa8',1));
  parts.push(rect(x+5,y+cab+3,w-10,l-cab-9,dark,2));
  if(s.truck){
   parts.push(rect(x+7,y+cab+5,w-14,l-cab-13,optionText.includes('enclosed')?p.uniform:wood,1));
   for(let n=y+cab+12;n<y+l-7;n+=9)parts.push(line(x+8,n,x+w-8,n,p.helmet,1));
  }else{for(const side of [x+8,x+w-16])parts.push(rect(side,y+cab+7,8,l-cab-20,p.helmet,2));}
  if(s.half){for(const side of [x-4,x+w-3])parts.push(rect(side,y+8,7,16,dark,2));}
 }else{
  // Rear engine deck, hatch, exhaust and track guards distinguish each named hull.
  parts.push(rect(x+7,y+l-28,w-14,22,p.helmet,2));
  for(let n=0;n<5;n++)parts.push(line(x+10,y+l-24+n*4,x+w-10,y+l-24+n*4,p.highlight,1));
  parts.push(rect(x+w-12,y+l-9,6,7,metal,1),rect(x+4,y+15,9,12,p.helmet,2));
  if(s.assault)parts.push(`<path d="M${x+6} ${y+13}H${x+w-6}L${x+w-3} ${y+47}H${x+3}Z" fill="${p.helmet}"/>`);
 }
 const tx=64,ty=s.truck?67:s.carrier?48:s.assault?y+24:54;
 if(s.turret){
  if(s.aa||optionText.includes('anti-aircraft')){
   parts.push(`<circle cx="${tx}" cy="${ty}" r="14" fill="${p.helmet}"/>`);
   for(const dx of [-7,-2,3,8])parts.push(rect(tx+dx-1,ty-27,2,29,metal,1));
  }else{
   const tw=s.heavy?35:s.light?24:30;
   parts.push(`<path d="M${tx-tw/2} ${ty-10}L${tx-tw/2+5} ${ty-19}H${tx+tw/2-5}L${tx+tw/2} ${ty-10}V${ty+14}L${tx+tw/2-6} ${ty+21}H${tx-tw/2+6}L${tx-tw/2} ${ty+14}Z" fill="${p.helmet}"/>`);
   parts.push(rect(tx-3,ty-17-s.barrel,6,s.barrel+17,metal,2),rect(tx-5,ty-8,10,12,p.uniform,2));
   parts.push(`<circle cx="${tx+6}" cy="${ty+9}" r="6" fill="${s.open?dark:p.uniform}"/>`);
  }
 }else if(s.assault)parts.push(rect(61,ty-s.barrel,6,s.barrel+9,metal,2));
 if(s.rocket){for(let n=0;n<5;n++)parts.push(rect(49+n*6,43,4,47,metal,1));parts.push(line(47,52,80,52,p.highlight,3),line(47,80,80,80,p.highlight,3));}
 // Add-on layers are intentionally small: silhouettes remain readable at tabletop scale.
 if(optionText.includes('hmg')||optionText.includes('pintle')||optionText.includes('additional-mmg'))parts.push(rect(75,38,3,22,metal,1),rect(71,53,11,6,metal,1));
 if(optionText.includes('flame'))parts.push(rect(x+5,y+l-25,9,18,'#875545',3),rect(x+4,y+11,4,20,metal,1));
 if(optionText.includes('howitzer')||optionText.includes('105'))parts.push(rect(59,ty-28,10,15,metal,2));
 if(optionText.includes('dozer'))parts.push(`<path d="M${x-7} ${y+4}Q64 ${y-7} ${x+w+7} ${y+4}V${y+12}Q64 ${y+3} ${x-7} ${y+12}Z" fill="${metal}"/>`);
 if(optionText.includes('capacity')||optionText.includes('transport'))parts.push(rect(x+w-11,y+l-22,7,15,wood,1));
 if(optionText.includes('skirts')||optionText.includes('armour'))for(const side of [x-5,x+w-1])parts.push(rect(side,y+18,6,l-33,p.uniform,1));
 if(optionText.includes('upgrade'))parts.push(rect(x+w-13,y+l-16,7,7,p.color,1));
 // Stable profile-specific fittings avoid a single generic tank icon for every entry.
 for(let n=0;n<=s.detail;n++)parts.push(rect(x+6+n*6,y+l-5,4,2,p.highlight,0));
 parts.push(line(x+7,y+7,x+14,y+7,p.color,3));
 parts.push('</g>');
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128" data-profile="${escape(s.slug)}"><title>${escape(row.name||'Vehicle')}</title><desc>Programmatic top-down tabletop silhouette; front points up. ${escape(optionText)}</desc>${parts.join('')}</svg>\n`;
}
