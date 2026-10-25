/** Standalone rendering of production templates against mock Foundry contexts.
 * Tooling only: npm install --prefix /tmp/ba-ui handlebars
 * HANDLEBARS_MODULE=/tmp/ba-ui/node_modules/handlebars node tools/render-ui.mjs [output.html]
 */
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
let Handlebars;
try {Handlebars=require(process.env.HANDLEBARS_MODULE||'handlebars');}catch {throw new Error('Install the tooling dependency handlebars and set HANDLEBARS_MODULE to its absolute module path. No runtime dependency is needed.');}
Handlebars.registerHelper('checked',value=>value?'checked':'');
class App {async _prepareContext(){return {};}}
globalThis.foundry={applications:{api:{HandlebarsApplicationMixin:B=>B,ApplicationV2:App},sheets:{ActorSheetV2:App,ItemSheetV2:App}}};
const {BoltActorSheet}=await import('../scripts/applications/actor-sheet.mjs');
const {BoltItemSheet}=await import('../scripts/applications/item-sheet.mjs');
const root=fileURLToPath(new URL('../',import.meta.url));
const svg=await readFile(path.join(root,'assets/soldier.svg'),'utf8');
const img=`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const rifle={id:'rifle',uuid:'Actor.soldier.Item.rifle',name:'Rifle',type:'weapon',img,isOwner:true,system:{slug:'rifle',range:24,shots:1,penetration:0,quantity:1,cost:0,traits:[],notes:'Standard infantry armament.'}};
const soldiers=Array.from({length:5},(_,i)=>({uuid:`Actor.soldier${i}`,name:i===0?'Sergeant Harris':`Rifleman ${i}`,img,type:'model',system:{dead:i===4,role:'rifleman',quality:'regular',basePoints:10,pointsAdjustment:0,notes:''},items:[rifle],members:[],livingMembers:[],isOwner:true,points:10}));
const army={uuid:'Actor.army',name:'Allied Expeditionary Force',img,type:'army',ownership:{player:3},system:{side:'allies',score:0,notes:'Team members share control of every squad and model.'},members:[],livingMembers:[],items:[],isOwner:true,effectiveSide:'allies'};
const unit={uuid:'Actor.unit',name:'1st Infantry Section',img,type:'unit',system:{side:'allies',kind:'infantry',quality:'regular',pins:2,order:'advance',activated:true,ncoAlive:true,startingSize:5,moveAdvance:6,moveRun:12,points:50,notes:'A squad contains individually customisable models.'},army,members:soldiers,livingMembers:soldiers.slice(0,4),items:[],weapons:[rifle],isOwner:true,points:50,morale:9,damageValue:4,effectiveSide:'allies'};
army.members=[unit];soldiers.forEach(s=>{s.unit=unit;s.army=army;s.effectiveSide='allies';});
army.points=50;
const staticModel={...soldiers[0],type:'modelStatic',name:'Anti-tank gun',system:{...soldiers[0].system,basePoints:50,crew:3,moveAdvance:0},points:50};
const vehicleModel={...soldiers[0],type:'modelVehicle',name:'Medium tank',system:{...soldiers[0].system,basePoints:200,damageValue:9,capacity:0,moveAdvance:9,moveRun:18},points:200};
globalThis.game={user:{isGM:true},users:[{id:'player',name:'Alex',isGM:false}],items:[],packs:[],actors:[army,unit,...soldiers],boltaction:{profiles:async()=>({faction:{name:'United States'},traits:[]})}};
async function render(template,context){return Handlebars.compile(await readFile(path.join(root,'templates',template+'.hbs'),'utf8'))(context);}
async function actorContext(actor){const app=new BoltActorSheet();app.actor=actor;return app._prepareContext({});}
const itemApp=new BoltItemSheet();itemApp.item=rifle;
const panels=[['Player Team',await render('actor-sheet',await actorContext(army))],['Squad',await render('actor-sheet',await actorContext(unit))],['Infantry Model',await render('actor-sheet',await actorContext(soldiers[0]))],['Static Model',await render('actor-sheet',await actorContext(staticModel))],['Vehicle Model',await render('actor-sheet',await actorContext(vehicleModel))],['Weapon profile',await render('item-sheet',await itemApp._prepareContext({}))]];
const css=await readFile(path.join(root,'styles/boltaction.css'),'utf8');
const html=`<!doctype html><html><head><meta charset="utf-8"><title>Bolt Action · UI review</title><style>*{box-sizing:border-box}body{margin:0;background:#101412;font:14px Arial,sans-serif;color:#eee}nav{padding:20px;position:sticky;top:0;background:#101412;z-index:10}nav a{color:#d4b576;margin-right:24px}main{max-width:1000px;margin:auto}section.preview{margin:24px 0 50px;border:1px solid #454c41;border-radius:8px;background:#181e1b}section.preview>h2{font:12px Arial;padding:12px;background:#30392f;margin:0;color:#d4b576;letter-spacing:2px;text-transform:uppercase}button{font-family:inherit}textarea{font-family:inherit}input,select{height:34px}details{display:block}${css}</style></head><body><nav>${panels.map(([name],i)=>`<a href="#panel${i}">${name}</a>`).join('')}</nav><main>${panels.map(([name,html],i)=>`<section class="preview boltaction" id="panel${i}"><h2>${name} · static template review</h2>${html}</section>`).join('')}</main></body></html>`;
const output=path.resolve(process.argv[2]||'../private/ui-preview.html');await mkdir(path.dirname(output),{recursive:true});await writeFile(output,html);console.log(output);
