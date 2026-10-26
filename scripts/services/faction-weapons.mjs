// Named examples verified against the supplied Second Edition rulebook.
// They share their rulebook weapon-class profile; an alias is not a distinct ballistic profile.
const aliases=Object.freeze({
 germany:{rifle:['Kar98k',35],pistol:['Walther P38',63],smg:['MP40',63],'assault-rifle':['StG44',63],lmg:['MG34 / MG42 (LMG)',158],mmg:['MG34 / MG42 (MMG)',158]},
 'united-states':{rifle:['M1 Garand',63],pistol:['Colt',63],smg:['Thompson (SMG)',63],'automatic-rifle':['Browning Automatic Rifle (BAR)',63],mmg:['M1919 Browning (MMG)',169],hmg:['.50 cal Browning (HMG)',63]},
 'great-britain':{rifle:['Lee-Enfield .303',63],pistol:['Webley',63],smg:['Sten (SMG)',63],lmg:['Bren (LMG)',63],mmg:['Vickers (MMG)',63]},
 'soviet-union':{rifle:['Mosin-Nagant',194],smg:['PPSh-41 (SMG)',63],lmg:['DP-28 (LMG)',127],mmg:['Maxim 1910 (MMG)',192]},
 'imperial-japan':{rifle:['Type 38 rifle',203],lmg:['Type 96 (LMG)',203],mmg:['Type 92 (MMG)',204]}
});
export function factionWeaponName(slug,factionSlug,fallback=slug){return aliases[factionSlug]?.[slug]?.[0]??fallback;}
/** Apply a sourced display identity. Canonical stats and slugs are never changed by a named example. */
export function applyFactionWeaponAlias(source,factionSlug){
 const data=structuredClone(source),slug=data.system?.slug??data.flags?.boltaction?.catalogueSlug;
 const alias=aliases[factionSlug]?.[slug],name=alias?.[0]??data.name;
 data.flags={...data.flags,boltaction:{...data.flags?.boltaction,catalogueSlug:slug,weaponClass:slug,...(alias?{displayAlias:true,factionSlug,className:data.flags?.boltaction?.className??data.name,aliasBasis:'Rulebook named example; statistics use the generic weapon class (page 62).',aliasSource:{title:'Bolt Action Second Edition',page:alias[1],kind:'named-example',weaponClassPage:62}}:{})}};
 data.name=name;return data;
}
