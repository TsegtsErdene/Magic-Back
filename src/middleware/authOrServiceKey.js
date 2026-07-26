const crypto = require("crypto");
const authMiddleware = require("./authMiddleware");

// Constant-time comparison so the shared key can't be recovered via timing.
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Gate for the file-URL endpoint. Accepts EITHER:
//   - a signed-in user (JWT, via authMiddleware) -> project-scoped access, or
//   - a trusted server-to-server caller (the Power Automate file flows) that
//     presents the shared service key in the `x-flow-key` header.
// Anonymous callers are rejected. The service-key path is only honoured when
// FILE_URL_SHARED_SECRET is configured, so an unset secret fails closed to JWT.
function authOrServiceKey(req, res, next) {
  const provided = req.get("x-flow-key");
  const expected = process.env.FILE_URL_SHARED_SECRET;
  if (expected && provided && safeEqual(provided, expected)) {
    req.serviceCall = true;
    return next();
  }
  return authMiddleware(req, res, next);
}

module.exports = authOrServiceKey;
