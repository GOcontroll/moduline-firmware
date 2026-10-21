// firmware.gocontroll.tech: public, read-only view of the R2 bucket `gocontroll-firmware`.
//
// firmware.gocontroll.com is an R2 custom domain on the same bucket. During the move of device
// traffic to gocontroll.tech both hostnames serve the same objects, byte for byte, so controllers,
// the app and image builds can switch host one at a time. Publishing is unchanged: the module
// repos and moduline-firmware write to the bucket over the S3 API, and an object is on both
// hostnames as soon as it is in the bucket.
//
// Behaviour mirrors the R2 custom domain: GET and HEAD of an object key, ETag / Last-Modified /
// Content-Type from the object, conditional requests (304/412) and byte ranges (206). There is no
// listing and no index page; anything that is not an object is a 404. No other method is served.

const ALLOW = "GET, HEAD";

export default {
  async fetch(request, env) {
    return handle(request, env);
  },
};

/**
 * @param {Request} request
 * @param {{ FIRMWARE_BUCKET: R2Bucket }} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const method = request.method;
  if (method !== "GET" && method !== "HEAD") {
    return text(405, "Method Not Allowed", { allow: ALLOW });
  }

  const key = objectKey(new URL(request.url).pathname);
  if (key === null) return text(404, "Not Found");

  if (method === "HEAD") {
    const head = await env.FIRMWARE_BUCKET.head(key);
    if (head === null) return text(404, "Not Found", {}, true);
    const headers = objectHeaders(head);
    headers.set("content-length", String(head.size));
    return new Response(null, { status: 200, headers });
  }

  const wantsRange = request.headers.has("range");
  let object;
  try {
    object = await env.FIRMWARE_BUCKET.get(key, { onlyIf: request.headers, range: request.headers });
  } catch (err) {
    // R2 rejects a Range it cannot satisfy; anything else is a real failure.
    if (wantsRange) return text(416, "Range Not Satisfiable");
    throw err;
  }
  if (object === null) return text(404, "Not Found");

  const headers = objectHeaders(object);
  if (!("body" in object) || !object.body) {
    // A precondition failed: If-None-Match / If-Modified-Since → 304, If-Match / If-Unmodified-Since → 412.
    const status = request.headers.has("if-match") || request.headers.has("if-unmodified-since") ? 412 : 304;
    return new Response(null, { status, headers });
  }
  if (wantsRange && object.range) {
    headers.set("content-range", contentRange(object.range, object.size));
    return new Response(object.body, { status: 206, headers });
  }
  return new Response(object.body, { status: 200, headers });
}

/**
 * Object key from the URL path: without the leading slash, percent-decoded. `null` for the root,
 * a "directory" (trailing slash) or a path that does not decode.
 * @param {string} pathname
 * @returns {string | null}
 */
export function objectKey(pathname) {
  let key;
  try {
    key = decodeURIComponent(pathname.replace(/^\/+/, ""));
  } catch {
    return null;
  }
  if (key === "" || key.endsWith("/")) return null;
  return key;
}

/**
 * @param {R2Object} object
 * @returns {Headers}
 */
function objectHeaders(object) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("last-modified", object.uploaded.toUTCString());
  headers.set("accept-ranges", "bytes");
  return headers;
}

/**
 * @param {R2Range} range
 * @param {number} size
 * @returns {string}
 */
export function contentRange(range, size) {
  let start;
  let end;
  if ("suffix" in range && range.suffix !== undefined) {
    start = Math.max(size - range.suffix, 0);
    end = size - 1;
  } else {
    start = range.offset ?? 0;
    end = range.length !== undefined ? start + range.length - 1 : size - 1;
  }
  return `bytes ${start}-${Math.min(end, size - 1)}/${size}`;
}

/**
 * @param {number} status
 * @param {string} message
 * @param {Record<string, string>} [extra]
 * @param {boolean} [headOnly]
 * @returns {Response}
 */
function text(status, message, extra = {}, headOnly = false) {
  return new Response(headOnly ? null : `${message}\n`, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...extra },
  });
}
