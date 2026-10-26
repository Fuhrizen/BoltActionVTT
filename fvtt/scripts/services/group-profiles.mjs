/** Resolve team inheritance at render/use time, without copying faction rules to models. */
export async function profiles(actor){
 const team=actor.type==='army'?actor:actor.army;
 const faction=team?.system.factionUuid?await fromUuid(team.system.factionUuid):null;
 const squad=actor.type==='unit'?null:actor.unit;
 const refs=[...(actor.system.traitUuids??[]),...(squad?.system.traitUuids??[]),...(faction?.system.traitUuids??[])];
 const linked=await Promise.all([...new Set(refs)].map(uuid=>fromUuid(uuid)));
 const own=(actor.items??[]).filter(i=>i.type==='trait');
 return {squad,faction:faction?.visible===false?null:faction,traits:[...linked,...own].filter(i=>i?.type==='trait'&&i.visible!==false)};
}
