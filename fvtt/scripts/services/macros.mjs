export const macroTemplates=Object.freeze([
 {key:'manual-roll',name:'Bolt Action: Roll dice',command:"const actor=canvas.tokens.controlled[0]?.actor; await game.boltaction.confirmManualRoll(actor?.unit??actor);"},
 {key:'shooting',name:'Bolt Action: Confirm squad shooting',command:"const actor=canvas.tokens.controlled[0]?.actor; if(!actor)ui.notifications.warn('Select a model token.');else await game.boltaction.confirmShooting(actor.unit??actor);"},
 {key:'sheet',name:'Bolt Action: Open squad sheet',command:"const actor=canvas.tokens.controlled[0]?.actor; if(actor)await (actor.unit??actor).sheet.render({force:true});else ui.notifications.warn('Select a model token.');"},
 {key:'cost',name:'Bolt Action: Inspect squad points',command:"const actor=canvas.tokens.controlled[0]?.actor;if(actor){const cost=await game.boltaction.calculateCost(actor.unit??actor);ui.notifications.info(`${cost.total} points${cost.unknown.length?' (known subtotal; unresolved options)':''}`);}else ui.notifications.warn('Select a model token.');"}
]);
/** Idempotent GM preparation; macro execution still uses the invoking user's permissions. */
export async function prepareMacros(){
 if(!game.user.isGM)throw new Error('The GM prepares macro tools.');
 let pack=game.packs.find(p=>p.metadata?.name==='boltaction-macros'&&p.metadata?.packageType==='world');
 if(!pack)pack=await foundry.documents.collections.CompendiumCollection.createCompendium({name:'boltaction-macros',label:'Bolt Action: Macro tools',type:'Macro',package:'world'});
 const existing=await pack.getDocuments();
 for(const template of macroTemplates){if(existing.some(m=>m.getFlag?.('boltaction','toolKey')===template.key))continue;if(pack.locked)throw new Error('Unlock the Macro tools compendium to add missing tools.');await CONFIG.Macro.documentClass.create({name:template.name,type:'script',scope:'global',command:template.command,img:'icons/svg/dice-target.svg',flags:{boltaction:{toolKey:template.key,apiVersion:1}}},{pack:pack.collection});}
 return pack;
}
