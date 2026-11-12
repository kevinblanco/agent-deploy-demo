import http from "node:http";
import { quote, PricingError } from "./pricing.js";

const PORT = Number(process.env.PORT ?? 8080);
const VERSION = process.env.APP_VERSION ?? "dev";

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const readJson = (req) =>
  new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 64_000) reject(new PricingError("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new PricingError("body must be JSON"));
      }
    });
  });

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/healthz") return send(res, 200, { ok: true });
    if (req.method === "GET" && req.url === "/version") return send(res, 200, { version: VERSION });
    if (req.method === "POST" && req.url === "/quote") {
      const { items, discountCode, taxRate } = await readJson(req);
      return send(res, 200, quote(items, { discountCode, taxRate }));
    }
    return send(res, 404, { error: "not found" });
  } catch (err) {
    if (err instanceof PricingError) return send(res, 400, { error: err.message });
    console.error(err);
    return send(res, 500, { error: "internal error" });
  }
});

server.listen(PORT, () => console.log(`cart-pricing ${VERSION} listening on :${PORT}`));
