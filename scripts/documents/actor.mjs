const resolve = uuid => {
  if (!uuid) return null;
  try { return fromUuidSync(uuid); } catch { return null; }
};

export class BoltActor extends foundry.documents.Actor {
  get members() {
    const field = this.type === "army" ? "unitUuids" : "modelUuids";
    const types = this.type === "army" ? ["unit"] : ["model","modelStatic","modelVehicle"];
    return [...new Set(this.system[field] ?? [])].map(resolve)
      .filter(a => a?.documentName === "Actor" && types.includes(a.type)
        && a.system[this.type === "army" ? "armyUuid" : "unitUuid"] === this.uuid);
  }
  get livingMembers() { return this.members.filter(a => ["model","modelStatic","modelVehicle"].includes(a.type) ? !a.system.dead : !a.isDestroyed); }
  get unit() {
    if (this.type === "unit") return this;
    const unit = ["model","modelStatic","modelVehicle"].includes(this.type) && resolve(this.system.unitUuid);
    return unit?.documentName === "Actor" && unit.type === "unit" && unit.system.modelUuids.includes(this.uuid) ? unit : null;
  }
  get army() {
    if (this.type === "army") return this;
    const army = resolve(this.unit?.system.armyUuid);
    return army?.documentName === "Actor" && army.type === "army" && army.system.unitUuids.includes(this.unit.uuid) ? army : null;
  }
  get effectiveSide() { return this.army?.system.side || this.unit?.system.side || this.system.side || "unassigned"; }
  get morale() {
    const unit = this.unit;
    if (!unit) return 0;
    const base = {inexperienced: 8, regular: 9, veteran: 10}[unit.system.quality] ?? 9;
    const lastCrew = unit.items.some(i => i.type === "weapon" && i.system.traits.includes("team")) && unit.livingMembers.length === 1;
    return Math.min(10, Math.max(2, base + unit.system.moraleBonus - Number(!unit.system.ncoAlive || lastCrew) - unit.system.pins));
  }
  get damageValue() {
    const unit = this.unit;
    if (!unit) return 0;
    return unit.system.kind === "vehicle" ? unit.system.damageValue : {inexperienced: 3, regular: 4, veteran: 5}[unit.system.quality];
  }
  get weapons() {
    const actors = this.type === "unit" ? [this, ...this.livingMembers] : [this];
    return actors.filter(a => a.system.role !== 'loader' || !((this.getFlag?.('boltaction','upgrades') ?? []).some(u => u.loaderUuids?.includes(a.uuid) && u.modelUuids?.some(uuid => this.livingMembers.some(m=>m.uuid===uuid))))).flatMap(a => a.items.filter(i => i.type === "weapon"));
  }
  get isDestroyed() {
    if (["model","modelStatic","modelVehicle"].includes(this.type)) return this.system.dead;
    if (this.type !== "unit") return false;
    const base = {inexperienced: 8, regular: 9, veteran: 10}[this.system.quality] ?? 9;
    return this.system.destroyed || this.system.pins >= base
      || (this.system.kind !== "vehicle" && this.members.length > 0 && this.livingMembers.length === 0);
  }
}
