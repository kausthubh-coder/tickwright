import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const [room, ...coordinates] = process.argv.slice(2);
if (!room || !/^[a-z0-9-]{1,48}$/.test(room)) throw new Error("Pass a QA room name and optional x y z marker");
const ports = JSON.parse(readFileSync(".local/ports.json", "utf8"));
const secret = readFileSync(".local/server-token", "utf8");
async function get(params = "") {
  const response = await fetch(`http://127.0.0.1:${ports.site}/world?room=${room}${params}`, { headers: { Authorization: `Bearer ${secret}` } });
  if (!response.ok) throw new Error(`Convex read failed (${response.status})`);
  return response.json();
}
const { meta: raw } = await get();
if (!raw) throw new Error("No v2 saved world");
const meta = JSON.parse(raw), keys = [];
let cursor = null;
for (;;) {
  const page = await get(`&manifest=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
  keys.push(...page.keys); if (page.done) break; cursor = page.cursor;
}
let marker = null;
if (coordinates.length) {
  const [x,y,z] = coordinates.map(Number);
  if (coordinates.length !== 3 || ![x,y,z].every(Number.isInteger)) throw new Error("Marker needs integer x y z");
  const { sections } = await get(`&cx=${x>>5}&cz=${z>>5}`);
  const saved = sections.find(s => s.key === `${x>>5},${y>>5},${z>>5}`);
  if (!saved) throw new Error("Marker section has no saved edits");
  const bytes=Uint8Array.from(saved.data),view=new DataView(bytes.buffer),count=view.getUint32(0,true);
  const index=((y&31)*32+(z&31))*32+(x&31);let cursor=0,value;
  for(let offset=4+count*2;offset<bytes.length;offset+=4){const length=view.getUint16(offset,true),palette=view.getUint16(offset+2,true);if(index<cursor+length){value=view.getUint16(4+palette*2,true);break;}cursor+=length;}
  marker={x,y,z,value,section:saved.key,revision:saved.revision,sha256:createHash("sha256").update(bytes).digest("hex")};
}
console.log(JSON.stringify({room,meta,savedSections:keys.length,keys,marker},null,2));
