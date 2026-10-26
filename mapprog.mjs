const rel0 = "watch/static/chunks/0885f028.bd876fd4a5c891f8.js";
let rel = rel0;
for (const marker of ["static/chunks/", "static/css/", "static/media/"]) {
  const i = rel.indexOf(marker);
  if (i >= 0) { rel = "_next/" + rel.substring(i); break; }
}
console.log("mapped:", rel);
import fs from "node:fs";
console.log("exists:", fs.existsSync("C:/LibreTV/out/" + rel));
