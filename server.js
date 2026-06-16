import dgram from "node:dgram";
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const oscHost = process.env.OSC_HOST || "127.0.0.1";
const oscPort = Number(process.env.OSC_PORT || 7000);
const httpPort = Number(process.env.PORT || 4173);
const udp = dgram.createSocket("udp4");

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function pad4(buffer) {
  const padding = (4 - (buffer.length % 4)) % 4;
  return padding ? Buffer.concat([buffer, Buffer.alloc(padding)]) : buffer;
}

function oscString(value) {
  return pad4(Buffer.from(`${value}\0`, "utf8"));
}

function oscFloat(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeFloatBE(Number(value) || 0, 0);
  return buffer;
}

function oscPacket(address, value) {
  const isNumber = typeof value === "number";
  return Buffer.concat([
    oscString(address),
    oscString(isNumber ? ",f" : ",s"),
    isNumber ? oscFloat(value) : oscString(String(value)),
  ]);
}

function sendOsc(name, value) {
  const safeName = String(name).replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeName) return;
  const packet = oscPacket(`/av/${safeName}`, value);
  udp.send(packet, oscPort, oscHost);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/param") {
      const body = await readJson(req);
      sendOsc(body.name, body.value);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, host: oscHost, port: oscPort }));
      return;
    }

    const rawPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    const safePath = normalize(rawPath).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(root, safePath);

    if (!existsSync(filePath) || !filePath.startsWith(root)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "content-type": mime[extname(filePath)] || "application/octet-stream",
    });
    createReadStream(filePath).pipe(res);
  } catch (error) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: error.message }));
  }
});

server.listen(httpPort, () => {
  console.log(`AV Control Rack: http://localhost:${httpPort}`);
  console.log(`OSC output: ${oscHost}:${oscPort}`);
});
