/** Portable source selections only. No Foundry document payloads or world identifiers. */
export const ROSTER_FORMAT='boltaction-army';
export const ROSTER_VERSION=1;
const qualities=['inexperienced','regular','veteran'];
const factions=['germany','great-britain','united-states','soviet-union','imperial-japan'];
const object=(value,label,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${label} must be an object.`);for(const key of Object.keys(value))if(!keys.includes(key))throw new Error(`${label}: unsupported field ${key}.`);return value;};
const string=(value,label,max=150)=>{if(typeof value!=='string'||value.length>max)throw new Error(`${label} must be text of at most ${max} characters.`);return value;};
const id=(value,label)=>{string(value,label,100);if(!/^[a-zA-Z0-9_-]+$/.test(value))throw new Error(`${label} must be a local identifier.`);return value;};
const list=(value,label,max)=>{if(!Array.isArray(value)||value.length>max)throw new Error(`${label} must be an array with at most ${max} entries.`);return value;};
const unique=(rows,label)=>{if(new Set(rows.map(r=>r.id)).size!==rows.length)throw new Error(`${label} identifiers must be unique.`);};
const boolean=(value,label)=>{if(value!==undefined&&typeof value!=='boolean')throw new Error(`${label} must be true or false.`);return Boolean(value);};
export function validateRoster(input,{units}={}){
 if(typeof input==='string'){if(input.length>2000000)throw new Error('Army file exceeds 2 MB.');try{input=JSON.parse(input);}catch{throw new Error('Army file must contain valid JSON.');}}
 object(input,'Army',['format','version','name','faction','pointsLimit','platoons','squads']);
 if(input.format!==ROSTER_FORMAT||input.version!==ROSTER_VERSION)throw new Error('Unsupported army file format or version.');
 const name=string(input.name,'Army name'),faction=string(input.faction,'Faction');if(!factions.includes(faction))throw new Error('Choose a supported faction.');
 if(!Number.isInteger(input.pointsLimit)||input.pointsLimit<1||input.pointsLimit>1000000)throw new Error('Points limit must be a whole number from 1 to 1000000.');
 const platoons=list(input.platoons,'Platoons',20).map(p=>{object(p,'Platoon',['id','name']);return {id:id(p.id,'Platoon id'),name:string(p.name,'Platoon name')};});if(!platoons.length)throw new Error('Add at least one platoon.');unique(platoons,'Platoon');
 const squads=list(input.squads,'Squads',200).map(s=>{
  object(s,'Squad',['id','profileSlug','platoonId','identity','quality','nationalAllowance','models']);
  const out={id:id(s.id,'Squad id'),profileSlug:id(s.profileSlug,'Source profile'),platoonId:id(s.platoonId,'Platoon assignment'),identity:string(s.identity??'Unnamed Squad','Squad identity'),quality:s.quality,nationalAllowance:boolean(s.nationalAllowance,'National allowance')};
  if(!qualities.includes(out.quality))throw new Error('Choose a valid squad experience.');if(!platoons.some(p=>p.id===out.platoonId))throw new Error('A squad references an unavailable platoon.');
  if(units&&!units.some(row=>row.slug===out.profileSlug&&row.factionSlug===faction&&row.profile?.sourcePage))throw new Error(`Source profile unavailable for this faction: ${out.profileSlug}.`);
  if(s.models!==undefined){out.models=list(s.models,'Models',100).map(m=>{object(m,'Model',['id','customName','isNco','isLoader','isMedic','isObserver','loaderForId','choices']);const result={id:id(m.id,'Model id'),customName:string(m.customName??'','Model identity'),isNco:boolean(m.isNco,'NCO'),isLoader:boolean(m.isLoader,'Loader'),isMedic:boolean(m.isMedic,'Medic'),isObserver:boolean(m.isObserver,'Observer'),loaderForId:m.loaderForId?id(m.loaderForId,'Paired gunner'):'',choices:list(m.choices??[],'Equipment choices',50).map(c=>string(c,'Equipment choice',200))};if(new Set(result.choices).size!==result.choices.length)throw new Error('Equipment choices must be unique.');return result;});if(!out.models.length)throw new Error('A source squad must contain at least one model.');unique(out.models,'Model');for(const m of out.models)if(m.loaderForId&&(!out.models.some(peer=>peer.id===m.loaderForId)||m.loaderForId===m.id))throw new Error('A loader must reference another model in its squad.');}
  return out;
 });unique(squads,'Squad');if(squads.reduce((n,s)=>n+(s.models?.length??1),0)>1000)throw new Error('An army may contain at most 1000 models.');return {format:ROSTER_FORMAT,version:ROSTER_VERSION,name,faction,pointsLimit:input.pointsLimit,platoons,squads};
}
