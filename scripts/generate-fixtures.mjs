import { mkdir, writeFile } from "node:fs/promises";

const start = Date.parse("2027-01-10T12:00:00Z");
const inputs = {
  Site01:{darkness:[[30,36],[82,100]],earth:[[0,22],[32,70],[78,140]]},Site04:{darkness:[[20,28],[68,77],[139,151]],earth:[[0,48],[65,105],[124,168]]},Site07:{darkness:[[27,39],[64,80],[130,145]],earth:[[8,27],[44,60],[95,142]]},Site11:{darkness:[[50,66],[108,123]],earth:[[0,55],[68,98],[110,160]]},Site20:{darkness:[[6,12],[55,62],[100,112]],earth:[[18,28],[47,58],[105,130]]},Site23:{darkness:[[14,32],[96,104],[150,160]],earth:[[0,40],[45,90],[99,156]]}
};
const iso = h => new Date(start + h * 3600000).toISOString();
const visible = (h, xs) => xs.some(([a,b]) => h >= a && h < b);
await mkdir("public/data", { recursive: true });
for (const [siteId, input] of Object.entries(inputs)) {
  const index = Object.keys(inputs).indexOf(siteId), phase = index * .73;
  const horizon = az => 2.2 + 1.25 * Math.sin(az*Math.PI/90+phase)+.55*Math.sin(az*Math.PI/30-phase);
  const horizonProfile = Array.from({length:361},(_,az)=>({azDeg:az,elDeg:+horizon(az).toFixed(4)}));
  const samples = Array.from({length:673},(_,i)=>{const h=i/4, sunAz=(32+h*3.2+index*17)%360, earthAz=(210+h*2.1+index*17)%360; const position=(az,on,bounds)=>{const d=Math.min(12,...bounds.flat().map(x=>Math.abs(h-x))); return +(horizon(az)+(on?1:-1)*Math.min(5.5,d*1.4)).toFixed(4)}; return {tUtc:iso(h),sunAzDeg:+sunAz.toFixed(4),sunElDeg:position(sunAz,!visible(h,input.darkness),input.darkness),earthAzDeg:+earthAz.toFixed(4),earthElDeg:position(earthAz,visible(h,input.earth),input.earth)}});
  const intervals = xs => xs.map(([a,b])=>({startUtc:iso(a),endUtc:iso(b)}));
  const sunlight=[]; let p=0; for(const [a,b] of input.darkness){if(p<a)sunlight.push([p,a]);p=b} if(p<168)sunlight.push([p,168]);
  const result={schemaVersion:"1.0",siteId,dataMode:"synthetic-demo",coverage:{startUtc:iso(0),endUtc:iso(168)},sampleIntervalSeconds:900,samples,horizonProfile,visibilityIntervals:{sunlight:intervals(sunlight),earth:intervals(input.earth)},provenance:{label:"Deterministic illustrative fixture",synthetic:true,generator:"scripts/generate-fixtures.mjs"}};
  await writeFile(`public/data/${siteId}.json`,JSON.stringify(result));
}
