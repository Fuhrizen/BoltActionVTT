const f = foundry.data.fields;
const text = (initial = "", options = {}) => new f.StringField({required: true, blank: true, initial, ...options});
const num = (initial = 0, options = {}) => new f.NumberField({required: true, initial, min: 0, ...options});
const int = (initial = 0, options = {}) => num(initial, {integer: true, ...options});
const bool = (initial = false) => new f.BooleanField({required: true, initial});
const list = () => new f.ArrayField(text(), {required: true, initial: []});
const quality = () => text("regular", {choices: ["inexperienced", "regular", "veteran"]});

export class ArmyData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {side: text("allies"), factionUuid: text(), selectorUuid: text(), unitUuids: list(), score: int(), pointsLimit: int(1000), notes: text()};
  }
}
export class UnitData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      squadKind: text("", {choices: ["", "infantry", "vehicleStatic"]}),
      armyUuid: text(), factionUuid: text(), modelUuids: list(), side: text("allies"),
      kind: text("infantry", {choices: ["infantry", "artillery", "vehicle"]}), battlefieldRole: text("infantry"),
      quality: quality(), pins: int(), order: text("", {choices: ["", "fire", "advance", "run", "ambush", "rally", "down"]}),
      activated: bool(), destroyed: bool(), ncoAlive: bool(true), moraleBonus: int(0, {min: -10, max: 10}),
      startingSize: int(5, {min: 1, max: 100}), maxSize: int(10, {min: 1, max: 100}), fullStrength: bool(),
      damageValue: int(4, {min: 3, max: 11}), moveAdvance: num(6), moveRun: num(12), points: int(),
      reserve: bool(), deployment: text("field", {choices: ["field", "reserve", "outflank"]}), arrivalRound: int(),
      traitUuids: list(), transportUuid: text(), passengerUuids: list(), capacity: int(),
      vehicleDamage: text(), immobilised: bool(), openTopped: bool(), notes: text(),
      observerKind: text("", {choices: ["", "artillery", "air"]}), observerMission: text(), observerUsed: bool(), observerPending: bool(), observerTargetUuid: text(), observerRound: int(), observerSceneUuid: text(), observerX: num(), observerY: num(), observerResult: new f.ObjectField({initial: {}}), observerResolvedUuids: list(),
      attackPinTotals: new f.ObjectField({initial: {}}), specialPinTargets: list(),
      retained: bool(), firedWeaponUuids: list(), shotTargetUuid: text(), assaultResolved: bool(), hitTargetUuids: list()
    };
  }
}
export class ModelData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {unitUuid: text(), dead: bool(), role: text("rifleman"), quality: quality(), sourceFactionUuid: text(), traitUuids: list(), basePoints: num(), pointsAdjustment: num(0,{min:-100000}), notes: text()};
  }
}
export class StaticModelData extends ModelData {
  static defineSchema(){return {...super.defineSchema(),kind:text('artillery'),crew:int(2,{min:1,max:100}),moveAdvance:num(),moveRun:num(6),damageValue:int(4,{min:3,max:11})};}
}
export class VehicleModelData extends ModelData {
  static defineSchema(){return {...super.defineSchema(),kind:text('vehicle'),damageValue:int(7,{min:6,max:11}),capacity:int(),moveAdvance:num(9),moveRun:num(18),openTopped:bool(),immobilised:bool()};}
}
export class WeaponData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      slug: text(), cost: num(), range: num(24), minRange: num(), shots: int(1, {min: 1, max: 200}),
      ammoUsed: bool(), exhausted: bool(), indirectTargetUuid: text(), indirectZeroed: bool(), indirectRound: int(), indirectThreshold: int(6, {min: 2, max: 6}),
      shotsFormula: text(), indirectRange: num(), indirectMinRange: num(), heDiameter: num(),
      penetration: int(0, {max: 20}), traits: list(), quantity: int(1, {min: 1, max: 100}), notes: text()
    };
  }
}
export class TraitData extends foundry.abstract.TypeDataModel {
  static defineSchema() { return {slug: text(), effect: text(), notes: text()}; }
}
export class FactionData extends foundry.abstract.TypeDataModel {
  static defineSchema() { return {slug: text(), traitUuids: list(), notes: text()}; }
}
export class SelectorData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      slug: text(), factionUuid: text(), notes: text(),
      slots: new f.ArrayField(new f.SchemaField({kind: text(), min: int(), max: int(1)}), {initial: []})
    };
  }
}
