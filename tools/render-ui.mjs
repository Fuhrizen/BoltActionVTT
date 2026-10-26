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
const {BoltActorSheet,BoltArmyBuilder}=await import('../scripts/applications/actor-sheet.mjs');
const {BoltItemSheet}=await import('../scripts/applications/item-sheet.mjs');
const {armyBuilderCatalogue}=await import('../scripts/services/army-builder.mjs');
const {getModelChoices}=await import('../scripts/services/model-choices.mjs');
const {loadCatalogue,modelTemplate}=await import('../scripts/services/catalogue.mjs');
const root=fileURLToPath(new URL('../',import.meta.url));
globalThis.fetch=async url=>({ok:true,json:async()=>JSON.parse(await readFile(path.join(root,url.replace('systems/boltaction/','')),'utf8'))});
const catalogue=await loadCatalogue();
const svg=await readFile(path.join(root,'assets/soldier.svg'),'utf8');
const img=`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const rifle={id:'rifle',uuid:'Actor.soldier.Item.rifle',name:'Rifle',type:'weapon',img,isOwner:true,system:{slug:'rifle',range:24,shots:1,penetration:0,quantity:1,cost:0,traits:[],notes:'Standard infantry armament.'}};
const soldiers=Array.from({length:5},(_,i)=>({uuid:`Actor.soldier${i}`,name:i===0?'Sergeant Harris':`Rifleman ${i}`,img,type:'model',flags:{boltaction:{catalogueSlug:'great-britain-regular-infantry'}},system:{dead:i===4,role:'rifleman',quality:'regular',basePoints:10,pointsAdjustment:0,notes:''},items:[rifle],members:[],livingMembers:[],isOwner:true,points:10}));
const army={uuid:'Actor.army',name:'Allied Expeditionary Force',img,type:'army',ownership:{player:3},system:{factionUuid:'Item.previewFaction',side:'allies',score:0,notes:'Team members share control of every squad and model.'},members:[],livingMembers:[],items:[],isOwner:true,effectiveSide:'allies'};
const unit={uuid:'Actor.unit',name:'1st Infantry Section',img,type:'unit',system:{side:'allies',kind:'infantry',quality:'regular',pins:2,order:'advance',activated:true,ncoAlive:true,startingSize:5,moveAdvance:6,moveRun:12,points:50,notes:'A squad contains individually customisable models.'},army,members:soldiers,livingMembers:soldiers.slice(0,4),items:[],weapons:[rifle],isOwner:true,points:50,morale:9,damageValue:4,effectiveSide:'allies'};
army.members=[unit];soldiers.forEach(s=>{s.unit=unit;s.army=army;s.effectiveSide='allies';});
army.points=50;
const staticModel={...soldiers[0],...await modelTemplate(catalogue.units.find(r=>r.system.kind==='artillery')),isOwner:true,img};
const vehicleModel={...soldiers[0],...await modelTemplate(catalogue.units.find(r=>r.slug==='great-britain-sherman-75')),isOwner:true,img};
globalThis.game={user:{isGM:true},users:[{id:'player',name:'Alex',isGM:false}],items:[],packs:[],actors:[army,unit,...soldiers],boltaction:{armyBuilderCatalogue,getModelChoices,profiles:async()=>({faction:{name:'Great Britain'},traits:[]})}};
globalThis.fromUuid=async uuid=>uuid==='Item.previewFaction'?{system:{slug:'great-britain'}}:game.actors.find(actor=>actor.uuid===uuid);
async function render(template,context){return Handlebars.compile(await readFile(path.join(root,'templates',template+'.hbs'),'utf8'))(context);}
async function actorContext(actor,builder=false){const app=builder?new BoltArmyBuilder():new BoltActorSheet();app.actor=actor;return app._prepareContext({});}
const itemApp=new BoltItemSheet();itemApp.item=rifle;
const panels=[['Army Builder',await render('actor-sheet',await actorContext(army,true))],['Army',await render('actor-sheet',await actorContext(army))],['Squad',await render('actor-sheet',await actorContext(unit))],['Infantry Model',await render('actor-sheet',await actorContext(soldiers[0]))],['Static Model',await render('actor-sheet',await actorContext(staticModel))],['Vehicle Model',await render('actor-sheet',await actorContext(vehicleModel))],['Weapon profile',await render('item-sheet',await itemApp._prepareContext({}))]];
const css=await readFile(path.join(root,'styles/boltaction.css'),'utf8');
// Neutral preview scaffolding only. Runtime controls inherit the user's Foundry theme.
const html=`<!doctype html><html><head><meta charset="utf-8"><title>Bolt Action UI review</title><style>*{box-sizing:border-box}body{margin:0;background:#eee;font:14px system-ui,sans-serif;color:#222}nav{padding:20px;position:sticky;top:0;background:#fff;z-index:10;display:flex;gap:18px;flex-wrap:wrap}main{max-width:1440px;margin:auto}section.preview{margin:24px 0 50px;border:1px solid #aaa;background:#fff}section.preview>h2{padding:12px;margin:0;border-bottom:1px solid #aaa;font-size:16px}button,input,select,textarea{font:inherit}button{cursor:pointer;min-height:32px}input,select{height:32px}textarea{min-height:70px}input[type=checkbox]{height:auto}h2{font-size:18px}summary{cursor:pointer}details{display:block}${css}</style></head><body><nav>${panels.map(([name],i)=>`<a href="#panel${i}">${name}</a>`).join('')}</nav><main>${panels.map(([name,html],i)=>`<section class="preview" id="panel${i}"><h2>${name} · template layout review</h2>${html}</section>`).join('')}</main></body></html>`;
const output=path.resolve(process.argv[2]||'../private/ui-preview.html');await mkdir(path.dirname(output),{recursive:true});await writeFile(output,html);console.log(output);
