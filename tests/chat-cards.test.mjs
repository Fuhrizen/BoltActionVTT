import test from 'node:test';
import assert from 'node:assert/strict';
import {checkCard,diceAudit} from '../fvtt/scripts/services/chat-cards.mjs';
import {chatCard} from '../fvtt/scripts/services/rolls.mjs';
test('check audit makes the final threshold, failure margin and actual dice inspectable',()=>{
 const html=checkCard({name:'<script>Squad</script>'},'Morale','Squad destroyed', [{formula:'2d6',dice:[{results:[{result:5},{result:6}]}]}],{passed:false,total:11,target:7},{quality:'regular',pins:2,ncoAlive:false,moraleBonus:1,modifier:0});
 assert.match(html,/Failed by 4/);assert.match(html,/11 rolled · 7 or less needed/);assert.match(html,/Missing \(−1 morale\)/);assert.match(html,/Inspect dice and modifiers/);assert.ok(!html.includes('<script>'));assert.match(html,/Die 2: 6/);
});
test('individual attack dice carry success and failure labels including six-then-six results',()=>{
 const html=diceAudit('Attack',[6,6,3],[true,false,false]);assert.match(html,/Die 1: 6 — success/);assert.match(html,/Die 2: 6 — failed/);
});
test('shooting audit counts rolled dice only and distinguishes suggested casualties from allocation',()=>{
 const html=chatCard({name:'Infantry'},{name:'Target'},{quality:'regular'},{range:10,pins:0,cover:'soft'},[{name:'Rifle',count:3,shots:1,hits:0,dice:[],note:'Out of range'},{name:'LMG',count:1,shots:4,hits:2,dice:[2,3,5,6],results:[false,false,true,true],target:4,modifiers:{cover:-1},damage:{damageValue:4,casualties:1,exceptional:[],results:[false,true]},damageDice:[2,5],exceptionalDice:[]}]);
 assert.match(html,/4 attack dice · 1 suggested casualties/);assert.match(html,/2 hits; 2 missed/);assert.match(html,/Out of range/);assert.match(html,/separate target-owner allocation/);assert.match(html,/Inspect damage/);assert.match(html,/-1 to roll/);
});
