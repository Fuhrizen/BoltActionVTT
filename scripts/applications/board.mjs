import {createSquad, safely} from './dialogs.mjs';
export class BattleBoard extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  static DEFAULT_OPTIONS={id:'boltaction-battle-board',classes:['boltaction','battle-board'],window:{title:'Bolt Action · Battle Board',icon:'fa-solid fa-dice'},position:{width:960,height:740},actions:{draw:this.draw,nextRound:this.nextRound,importStarter:this.importStarter,configureScene:this.configureScene,createSquad:this.createSquad,open:this.open,activate:this.activate,select:this.select}};
  static PARTS={main:{template:'systems/boltaction/templates/board.hbs'}};
  async _prepareContext() {
    const units=game.actors.filter(a=>a.type==='unit'&&a.visible!==false);
    const combat=game.combat;
    const bag=combat?.getFlag('boltaction','bag');
    return {drawnSide:bag?.drawnSide??'Awaiting draw',remainingDice:bag?.remaining?.length??0,activeUnitName:units.find(a=>a.uuid===bag?.activeUnitUuid)?.name,isGM:game.user.isGM,round:combat?.round??0,units:units.map(a=>({uuid:a.uuid,name:a.name,img:a.img,side:a.effectiveSide,quality:a.system.quality,kind:a.system.kind,pins:a.system.pins,order:a.system.order||'Awaiting orders',activated:a.system.activated,destroyed:a.isDestroyed,living:a.livingMembers.length,owner:a.isOwner,army:a.army?.visible===false?'Assigned force':a.army?.name??'Independent'})),armies:game.actors.filter(a=>a.type==='army'&&a.visible!==false).map(a=>({uuid:a.uuid,name:a.name,count:a.members.filter(u=>u.visible!==false).length,points:a.members.filter(u=>u.visible!==false).reduce((n,u)=>n+(u.system.points||0),0),limit:a.system.pointsLimit})),unitCount:units.length,ready:units.filter(a=>!a.system.activated&&!a.isDestroyed).length};
  }
  static async draw(){return safely(()=>game.boltaction.drawDie());}
  static async nextRound(){return safely(()=>game.boltaction.nextRound());}
  static async importStarter(){return safely(()=>game.boltaction.importStarter());}
  static async configureScene(){return safely(()=>game.boltaction.configureScene());}
  static async createSquad(){return safely(()=>createSquad());}
  static async open(_e,t){const a=await fromUuid(t.dataset.uuid);a?.sheet.render({force:true});}
  static async activate(_e,t){return safely(async()=>game.boltaction.activateUnit(await fromUuid(t.dataset.uuid)));}
  static async select(_e,t){return safely(async()=>game.boltaction.selectUnit(await fromUuid(t.dataset.uuid)));}
}
