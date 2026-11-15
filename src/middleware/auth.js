import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config.js";

export function requireAuth(req, res, next) {
  const authorization = req.get("authorization");
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);

  if (!match) {
    res.set("WWW-Authenticate", 'Bearer realm="api"');
    return res.status(401).json({
      error: { message: "Authentication required" },
    });
  }

  let payload;
  try {
    payload = jwt.verify(match[1], JWT_SECRET, { algorithms: ["HS256"] });
  } catch {
    res.set("WWW-Authenticate", 'Bearer realm="api", error="invalid_token"');
    return res.status(401).json({
      error: { message: "Invalid or expired token" },
    });
  }

  if (typeof payload !== "object" || payload === null || typeof payload.sub !== "string") {
    res.set("WWW-Authenticate", 'Bearer realm="api", error="invalid_token"');
    return res.status(401).json({
      error: { message: "Invalid or expired token" },
    });
  }

  req.user = { id: payload.sub };
  return next();
}
