// Starts `next dev` with NODE_ENV cleared. Some PCs set NODE_ENV=production system-wide,
// which breaks Next.js development mode (CSS fails to compile).
const { spawn } = require("child_process");
const path = require("path");
delete process.env.NODE_ENV;
const bin = path.join(__dirname, "..", "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [bin, "dev", ...process.argv.slice(2)], { stdio: "inherit", env: process.env });
child.on("exit", (code) => process.exit(code ?? 0));
