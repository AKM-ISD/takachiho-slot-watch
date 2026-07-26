import fs from "fs";

const html = fs.readFileSync("debug/p4-after-yoyaku.html", "utf8");
const re = /<(input|select|textarea)([^>]*)>/gi;
const out = [];
let m;
while ((m = re.exec(html))) {
  const attrs = m[2];
  const pick = (n) => {
    const r = attrs.match(new RegExp(`${n}="([^"]*)"`, "i"));
    return r ? r[1] : "";
  };
  out.push({
    tag: m[1],
    type: pick("type"),
    name: pick("name"),
    id: pick("id"),
    placeholder: pick("placeholder"),
    value: pick("value"),
  });
}
fs.writeFileSync("debug/p4-fields-parsed.json", JSON.stringify(out, null, 2));
const visible = out.filter((x) => !/hidden/i.test(x.type));
console.log(visible.map((x) => [x.type || x.tag, x.name, x.id, x.placeholder].join("\t")).join("\n"));
