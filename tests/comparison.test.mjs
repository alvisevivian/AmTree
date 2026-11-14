import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
const inputs={Site01:{darkness:[[30,36],[82,100]],earth:[[0,22],[32,70],[78,140]]},Site23:{darkness:[[14,32],[96,104],[150,160]],earth:[[0,40],[45,90],[99,156]]}};
function metric(id,start,duration=72,limit=12){let both=0,run=0,longest=0;for(let h=start;h<start+duration;h+=.25){const s=!inputs[id].darkness.some(([a,b])=>h+.125>=a&&h+.125<b),e=inputs[id].earth.some(([a,b])=>h+.125>=a&&h+.125<b);if(s)run=0;else{run+=.25;longest=Math.max(longest,run)}if(s&&e)both+=.25}return{both,longest,meets:longest<=limit}}
test("required default and delayed darkness values",()=>{assert.equal(metric("Site01",0).longest,6);assert.equal(metric("Site01",48).longest,18);assert.equal(metric("Site23",0).longest,18);assert.equal(metric("Site23",48).longest,8)});
test("exactly twelve hours meets a twelve hour limit",()=>assert.equal(metric("Site01",24,12).meets,true));
test("sun and earth overlap is derived",()=>assert.ok(metric("Site01",0).both>0));
test("fixture positions cross the local horizon at visibility transitions",async()=>{const fixture=JSON.parse(await readFile(new URL("../public/data/Site01.json",import.meta.url),"utf8"));for(const hour of [22,30,32,36,70,78,82,100,140]){const sample=fixture.samples[hour*4];const horizon=az=>2.2+1.25*Math.sin(az*Math.PI/90)+.55*Math.sin(az*Math.PI/30);if([30,36,82,100].includes(hour))assert.ok(Math.abs(sample.sunElDeg-horizon(sample.sunAzDeg))<.001);else assert.ok(Math.abs(sample.earthElDeg-horizon(sample.earthAzDeg))<.001)}});
