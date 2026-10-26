import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.foundry={canvas:{placeables:{Token:class {_onClickLeft2(){return 'base';}_onClickRight(){return 'native-hud';}_onClickRight2(){return 'native-config';}_refreshEffects(){}}}}};
const {collectGroupModels,deployGroup,fellowSquadTokens,registerSceneGroups,centeredDefaultTokenTexture,centeredDefaultTokenData,normalizeSceneTokenDefaults,refreshNcoBadge,clearNcoBadges,setSquadHover,tokenStateLabels,refreshTokenStateBadges,clearTokenStateBadges}=await import('../fvtt/scripts/services/scene-groups.mjs');
const {BoltToken}=await import('../fvtt/scripts/documents/token.mjs');
const actor=(id,type,system={})=>({id,uuid:`Actor.${id}`,type,system,isOwner:true,visible:true,async getTokenDocument(){return{toObject:()=>({_id:'prototype',width:type==='modelVehicle'?2:1,height:1,texture:{src:'own-art.webp'}})};}});
function setup(){const a=actor('a','army',{unitUuids:['Actor.s','Actor.s']});const s=actor('s','unit',{armyUuid:a.uuid,modelUuids:['Actor.m','Actor.v','Actor.m','Actor.stray','Actor.hidden']});const m=actor('m','model',{unitUuid:s.uuid});const v=actor('v','modelVehicle',{unitUuid:s.uuid});const stray=actor('stray','model',{unitUuid:'Actor.other'});const hidden=actor('hidden','model',{unitUuid:s.uuid});hidden.visible=false;globalThis.game={actors:[a,s,m,v,stray,hidden],user:{isGM:true}};globalThis.CONFIG={Token:{documentClass:{canUserCreate:()=>true}}};delete globalThis.canvas;return{a,s,m,v,hidden};}
test('group collection follows reciprocal owned visible membership and deduplicates models',()=>{const {a,s,m,v}=setup();assert.deepEqual(collectGroupModels(a),[m,v]);assert.deepEqual(collectGroupModels(s),[m,v]);v.isOwner=false;assert.deepEqual(collectGroupModels(a),[m]);a.isOwner=false;assert.throws(()=>collectGroupModels(a),/own/);});
test('deployment produces linked individual tokens in one batch without overlapping unequal bases',async()=>{const {a,m}=setup();m.displayName='Private Smith';let created;const canvas={ready:true,scene:{grid:{size:100},async createEmbeddedDocuments(type,rows){created={type,rows};return rows;}}};const rows=await deployGroup(a,{canvas,x:40,y:80});assert.equal(created.type,'Token');assert.equal(rows.length,2);assert.equal(rows[0].name,'Private Smith');assert.equal(rows[0].actorLink,true);assert.equal(rows[0]._id,undefined);assert.ok(rows[1].x>=rows[0].x+200);assert.equal(rows[0].texture.src,'own-art.webp');});
test('permission, invalid position, empty group and scene changes reject before token writes',async()=>{const {s,m,v}=setup();let writes=0;const canvas={ready:true,scene:{async createEmbeddedDocuments(){writes++;}}};await assert.rejects(deployGroup(s,{canvas,x:NaN,y:0}),/location/);CONFIG.Token.documentClass.canUserCreate=()=>false;await assert.rejects(deployGroup(s,{canvas,x:0,y:0}),/permission/);CONFIG.Token.documentClass.canUserCreate=()=>true;m.visible=v.visible=false;await assert.rejects(deployGroup(s,{canvas,x:0,y:0}),/no available/);m.visible=true;globalThis.canvas={scene:{}};await assert.rejects(deployGroup(s,{canvas,x:0,y:0}),/changed/);assert.equal(writes,0);});
test('hover membership excludes self, hidden, unrelated and one-way models',()=>{const {m,v,hidden}=setup();const tokens=[{actor:m,visible:true},{actor:v,visible:true},{actor:hidden,visible:false},{actor:actor('else','model',{unitUuid:'Actor.s'}),visible:true}];assert.deepEqual(fellowSquadTokens(tokens[0],tokens),[tokens[1]]);});
test('drop hook synchronously cancels only world group actor drops',async()=>{const {s,m,v}=setup();const hooks={};globalThis.Hooks={on:(key,fn)=>hooks[key]=fn};globalThis.ui={notifications:{warn:()=>{}}};registerSceneGroups();assert.equal(hooks.dropCanvasData({}, {type:'Actor',uuid:m.uuid}),undefined);assert.equal(hooks.dropCanvasData({}, {type:'Actor',uuid:'Compendium.x.y'}),undefined);assert.equal(hooks.dropCanvasData({ready:true,scene:{createEmbeddedDocuments:async()=>[]}}, {type:'Actor',uuid:s.uuid,x:0,y:0}),false);await new Promise(resolve=>setTimeout(resolve,0));let destroyed=0;globalThis.PIXI={Graphics:class{lineStyle(){return this;}drawRoundedRect(){return this;}destroy(){destroyed++;}}};const a={actor:m,visible:true},b={actor:v,visible:true,w:100,h:100,addChild(g){g.parent={removeChild(){}};}};globalThis.canvas={tokens:{placeables:[a,b]}};hooks.hoverToken(a,true);assert.equal(destroyed,0);hooks.hoverToken(a,false);assert.equal(destroyed,1);hooks.canvasTearDown();assert.equal(destroyed,1);let sourceUpdate;const document={actor:m,updateSource:data=>{sourceUpdate=data;}};hooks.preCreateToken(document,{texture:{src:'systems/boltaction/assets/model-token.svg',anchorY:0,scaleX:.5}});assert.equal(sourceUpdate.texture.anchorY,.5);assert.equal(sourceUpdate.texture.scaleX,1);sourceUpdate=null;hooks.preCreateToken(document,{texture:{src:'custom.webp',anchorY:0,scaleX:.5}});assert.deepEqual(sourceUpdate,{lockRotation:false});});

test('managed default token transforms are centered while custom artwork and opt-out transforms are preserved',()=>{
 const managed={src:'systems/boltaction/assets/factions/germany/model-token.svg',anchorX:.5,anchorY:0,scaleX:.5,scaleY:.5,fit:'cover',tint:'#fff'};
 assert.deepEqual(centeredDefaultTokenTexture(managed),{...managed,src:managed.src+'?v=13',anchorX:.5,anchorY:.5,scaleX:1,scaleY:-1,fit:'contain'});
 const custom={...managed,src:'worlds/game/custom.webp'};assert.deepEqual(centeredDefaultTokenTexture(custom),custom);assert.deepEqual(centeredDefaultTokenTexture(managed,true),managed);
});
test('active scene repair changes only default model artwork and is idempotent',async()=>{
 const {m}=setup();const texture={src:'systems/boltaction/assets/model-token.svg',anchorY:0,scaleX:.5};
 const tokens=[{id:'default',actor:m,texture:{...texture}},{id:'custom',actor:m,lockRotation:false,texture:{...texture,src:'own.webp'}},{id:'optout',actor:m,lockRotation:false,texture:{...texture},flags:{boltaction:{preserveTokenTransform:true}}}];
 let calls=0;const scene={tokens,async updateEmbeddedDocuments(type,updates){calls++;assert.equal(type,'Token');assert.deepEqual(updates.map(row=>row._id),['default']);for(const row of updates)Object.assign(tokens.find(t=>t.id===row._id),row);}};
 await normalizeSceneTokenDefaults(scene);assert.equal(tokens[0].texture.anchorY,.5);assert.equal(tokens[0].texture.scaleX,1);assert.equal(tokens[1].texture.scaleX,.5);await normalizeSceneTokenDefaults(scene);assert.equal(calls,1);
});
test('NCO scene badge appears only while hovering its squad and does not change custom art',()=>{
 const {m,v}=setup();m.system.role='NCO';const texture={src:'personal-portrait.webp',scaleX:.7};let destroyed=0,stars=0;
 globalThis.PIXI={Graphics:class{lineStyle(){return this;}drawRoundedRect(){return this;}beginFill(){return this;}drawPolygon(points){assert.equal(points.length,20);stars++;return this;}endFill(){return this;}destroy(){destroyed++;}}};
 const token={actor:m,texture,w:100,h:100,visible:true,addChild(g){g.parent={removeChild(){}};}};
 const fellow={actor:v,w:100,h:100,visible:true,addChild:token.addChild};
 globalThis.canvas={tokens:{placeables:[token,fellow]}};
 refreshNcoBadge(token);assert.equal(stars,0);
 setSquadHover(fellow,true);assert.equal(stars,1);assert.equal(token.texture,texture);
 setSquadHover(fellow,false);assert.equal(stars,1);assert.ok(destroyed>=2);
 setSquadHover(token,true);assert.equal(stars,2);m.system.role='rifleman';refreshNcoBadge(token);assert.equal(stars,2);
 setSquadHover(token,false);clearNcoBadges();
});
test('managed art has ring scaling disabled and rotation enabled without replacing custom subjects',()=>{
 const texture={src:'systems/boltaction/assets/model-token.svg',scaleX:.5,anchorY:0};
 const fixed=centeredDefaultTokenData({texture,ring:{enabled:true,subject:{scale:.5}}},'model');
 assert.equal(fixed.ring.enabled,false);assert.equal(fixed.ring.subject.scale,1);assert.equal(fixed.lockRotation,false);assert.equal(fixed.texture.src,texture.src+'?v=13');
 const custom={texture:{...texture,src:'my.webp'},ring:{enabled:true,subject:{texture:'custom-subject.webp'}}};
 assert.deepEqual(centeredDefaultTokenData(custom,'modelVehicle'),{lockRotation:false});
 assert.deepEqual(centeredDefaultTokenData({texture,ring:{subject:{texture:'custom-subject.webp'}}},'modelStatic'),{lockRotation:false});
});
test('scene doubleclick opens a visible containing squad, falling back to the native model interaction',()=>{
 const token=new BoltToken();let rendered=0;token.actor={type:'model',unit:{type:'unit',visible:true,sheet:{render(options){assert.deepEqual(options,{force:true});rendered++;return 'squad';}}}};
 assert.equal(token._onClickLeft2({}),'squad');assert.equal(rendered,1);token.actor.unit.visible=false;assert.equal(token._onClickLeft2({}),'base');token.actor.unit=null;assert.equal(token._onClickLeft2({}),'base');
});
test('custom token counters distinguish squad pins and explicit vehicle states',async()=>{const {tokenStateLabels}=await import('../fvtt/scripts/services/scene-groups.mjs');const unit={type:'unit',system:{pins:3}},vehicle={type:'modelVehicle',unit,system:{vehicleStates:['onFire','turretJammed'],immobilised:true}};assert.deepEqual(tokenStateLabels(vehicle).map(x=>x.text),['P:3','IMM','FIRE','JAM']);assert.deepEqual(tokenStateLabels({type:'model',unit,system:{}}).map(x=>x.text),['P:3']);});

test('token state labels show inherited pins, dead models and vehicle states without generic status mutation',()=>{
 const {s,m,v}=setup();s.system.pins=3;m.unit=v.unit=s;m.system.dead=true;v.system.vehicleStates=['immobilised','onFire','turretJammed','stunned'];
 assert.deepEqual(tokenStateLabels(m).map(x=>x.text),['☠','P:3']);
 assert.deepEqual(tokenStateLabels(v).map(x=>x.text),['P:3','IMM','FIRE','JAM','STUN']);
});
test('overlay caches ignore movement coordinates and rebuild only when state or role changes',()=>{
 const {s,m}=setup();s.system.pins=2;m.unit=s;m.system.isMedic=true;let made=0,destroyed=0;
 globalThis.PIXI={VERSION:'7',Graphics:class{lineStyle(){return this;}drawRoundedRect(){return this;}destroy(){destroyed++;}},Text:class{constructor(text){this.text=text;made++;}destroy(){destroyed++;}}};
 const token={actor:m,w:100,h:100,visible:true,x:1,y:1,addChild(node){node.parent={removeChild(){}};}};globalThis.canvas={tokens:{placeables:[token]}};
 setSquadHover(token,true);refreshTokenStateBadges(token);const initial=made;
 for(let i=0;i<20;i++){token.x+=10;refreshNcoBadge(token);refreshTokenStateBadges(token);}
 assert.equal(made,initial);assert.equal(destroyed,0);
 s.system.pins=4;refreshTokenStateBadges(token);assert.equal(made,initial+1);assert.equal(destroyed,1);
 m.system.isObserver=true;refreshNcoBadge(token);assert.equal(made,initial+3);setSquadHover(token,false);clearTokenStateBadges();clearNcoBadges();
});
test('system token rightclick HUD is suppressed and native effect icons are replaced without changing art',()=>{
 const token=new BoltToken();token.actor={type:'model'};token.effects={visible:true};assert.equal(token._onClickRight({}),undefined);assert.equal(token._onClickRight2({}),undefined);token._refreshEffects();assert.equal(token.effects.visible,false);
 token.actor.type='other';assert.equal(token._onClickRight({}),'native-hud');assert.equal(token._onClickRight2({}),'native-config');
});

test('managed deployed footprints respect profile overrides and avoid overlapping large vehicle bases',async()=>{
 const {a,m,v}=setup();v.system.damageValue=10;v.flags={boltaction:{profile:{tokenSize:{width:3,height:4}}}};
 for(const model of [m,v])model.getTokenDocument=async()=>({toObject:()=>({width:1,height:1,texture:{src:'systems/boltaction/assets/model-token.svg'}})});
 const canvas={ready:true,scene:{grid:{size:100},createEmbeddedDocuments:async(_type,rows)=>rows}};
 const rows=await deployGroup(a,{canvas,x:0,y:0});assert.deepEqual(rows.map(row=>[row.width,row.height]),[[1,1],[3,4]]);assert.ok(rows[1].x>=300);
 const preserved=centeredDefaultTokenData({width:5,height:6,texture:{src:'systems/boltaction/assets/model-token.svg'},flags:{boltaction:{preserveTokenSize:true}}},m);
 assert.equal(preserved.width,undefined);assert.equal(preserved.height,undefined);
 const custom=centeredDefaultTokenData({width:5,height:6,texture:{src:'my-art.webp'}},v);assert.equal(custom.width,undefined);
});
