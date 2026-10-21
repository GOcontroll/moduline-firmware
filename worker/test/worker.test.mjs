import { test } from "node:test";
import assert from "node:assert/strict";
import { handle, objectKey, contentRange } from "../src/index.js";

// Minimal stand-in for the R2 binding: enough of head()/get() to exercise the Worker's status
// codes and headers. Preconditions only model If-None-Match and If-Match; ranges only "bytes=a-b".
function fakeBucket(objects) {
  const meta = (key, body) => ({
    key,
    size: body.length,
    httpEtag: `"etag-${key}"`,
    uploaded: new Date("2026-08-17T14:16:08Z"),
    writeHttpMetadata(headers) {
      if (key.endsWith(".json")) headers.set("content-type", "application/json");
    },
  });
  return {
    async head(key) {
      return key in objects ? meta(key, objects[key]) : null;
    },
    async get(key, options = {}) {
      if (!(key in objects)) return null;
      const body = objects[key];
      const m = meta(key, body);
      const h = options.onlyIf;
      if (h?.get("if-none-match") === m.httpEtag) return m;
      if (h?.has("if-match") && h.get("if-match") !== m.httpEtag) return m;
      const r = options.range?.get("range");
      if (r) {
        const [, a, b] = /^bytes=(\d+)-(\d+)$/.exec(r) ?? [];
        if (a === undefined || Number(a) >= body.length) throw new Error("invalid range");
        const offset = Number(a);
        const length = Math.min(Number(b), body.length - 1) - offset + 1;
        return { ...m, range: { offset, length }, body: body.slice(offset, offset + length) };
      }
      return { ...m, body };
    },
  };
}

const MANIFEST = '{"updated":"2026-08-17","modules":[]}';
const env = { FIRMWARE_BUCKET: fakeBucket({ "modules/manifest.json": MANIFEST, "brcm/a.bin": "0123456789" }) };
const req = (path, init) => new Request(`https://firmware.gocontroll.tech${path}`, init);

test("GET of an object returns its bytes and metadata", async () => {
  const res = await handle(req("/modules/manifest.json"), env);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), MANIFEST);
  assert.equal(res.headers.get("content-type"), "application/json");
  assert.equal(res.headers.get("etag"), '"etag-modules/manifest.json"');
  assert.equal(res.headers.get("last-modified"), "Mon, 17 Aug 2026 14:16:08 GMT");
  assert.equal(res.headers.get("accept-ranges"), "bytes");
});

test("HEAD returns headers with the object size and no body", async () => {
  const res = await handle(req("/brcm/a.bin", { method: "HEAD" }), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-length"), "10");
  assert.equal(res.body, null);
});

test("missing objects, the root and directories are 404", async () => {
  for (const path of ["/nope.json", "/", "/modules/", "/%E0%A4%A"]) {
    const res = await handle(req(path), env);
    assert.equal(res.status, 404, path);
  }
  const head = await handle(req("/nope.json", { method: "HEAD" }), env);
  assert.equal(head.status, 404);
});

test("only GET and HEAD are served", async () => {
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const res = await handle(req("/modules/manifest.json", { method, body: method === "DELETE" ? undefined : "x" }), env);
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("allow"), "GET, HEAD");
  }
});

test("conditional GET: matching If-None-Match is 304, failing If-Match is 412", async () => {
  const notModified = await handle(req("/modules/manifest.json", { headers: { "if-none-match": '"etag-modules/manifest.json"' } }), env);
  assert.equal(notModified.status, 304);
  assert.equal(notModified.headers.get("etag"), '"etag-modules/manifest.json"');
  const failed = await handle(req("/modules/manifest.json", { headers: { "if-match": '"other"' } }), env);
  assert.equal(failed.status, 412);
});

test("byte ranges are 206 with Content-Range; an unsatisfiable range is 416", async () => {
  const res = await handle(req("/brcm/a.bin", { headers: { range: "bytes=2-5" } }), env);
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(await res.text(), "2345");
  const bad = await handle(req("/brcm/a.bin", { headers: { range: "bytes=50-60" } }), env);
  assert.equal(bad.status, 416);
});

test("objectKey decodes the path and rejects root, directories and bad escapes", () => {
  assert.equal(objectKey("/brcm/brcmfmac43430-sdio.GOcontroll%2Cmoduline.txt"), "brcm/brcmfmac43430-sdio.GOcontroll,moduline.txt");
  assert.equal(objectKey("/"), null);
  assert.equal(objectKey("/modules/"), null);
  assert.equal(objectKey("/%E0%A4%A"), null);
});

test("contentRange handles offset/length and suffix ranges", () => {
  assert.equal(contentRange({ offset: 0, length: 4 }, 10), "bytes 0-3/10");
  assert.equal(contentRange({ offset: 6 }, 10), "bytes 6-9/10");
  assert.equal(contentRange({ suffix: 3 }, 10), "bytes 7-9/10");
});
