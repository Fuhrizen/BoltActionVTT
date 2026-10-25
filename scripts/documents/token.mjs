const MODEL_TYPES = new Set(['model','modelStatic','modelVehicle']);
/** Scene models open their containing squad before their individual identity sheet. */
export class BoltToken extends foundry.canvas.placeables.Token {
  _onClickLeft2(event) {
    const squad = MODEL_TYPES.has(this.actor?.type) ? this.actor.unit : null;
    if (squad?.type === 'unit' && squad.visible !== false) return squad.sheet.render({force:true});
    return super._onClickLeft2(event);
  }
}
