import fs from "node:fs";
const t=fs.readFileSync(process.argv[2],"utf8");
const checks=[
 'UP="energy testv1"','yb="energy testv1"',
 'F4==="development"?"energy testv1 Dev":"energy testv1"',
 'const W4=F4==="development"?"energy testv1 Dev":"energy testv1"',
 'e==="development"?`${UP} Dev`:UP,e==="development"?"energy-testv1-dev":"energy testv1"',
 'app.setName(W4)','title:"energy testv1"','label:"energy testv1"',
 'Copyright © 2026 energy testv1',
 'http://127.0.0.1:7788'
];
for(const c of checks) console.log((t.includes(c)?"OK   ":"MISS ")+c);
console.log("\n--- remaining getenergy/remote hosts ---");
for(const m of new Set(t.match(/https?:\/\/[a-z0-9.-]*getenergy[a-z0-9.-]*|https?:\/\/[a-z0-9.-]*computerwork[a-z0-9.-]*|https?:\/\/[a-z0-9.-]*generalwork[a-z0-9.-]*|betterstackdata\.com/g)||[])) console.log("  "+m);
console.log("\n--- remaining bare 'Energy' display strings ---");
const re=/Energy/g; let mm,c=0;
while((mm=re.exec(t))&&c<25){const ctx=t.slice(Math.max(0,mm.index-50),mm.index+50).replace(/\s+/g," ");if(!/energy-|ENERGY_|getenergy|newco|computerwork|EnergyL|energy\b/i.test(ctx)){console.log("  ..."+ctx+"...");c++}}
