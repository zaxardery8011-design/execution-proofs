const fs = require("node:fs");
const path = require("node:path");

const outDir = path.resolve(__dirname, "..", "dist-cjs");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "package.json"), `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`);
