import type { RequestHandler } from "express";

export const SPA_CONTENT_SECURITY_POLICY =
  "script-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'";
export function configuredOrigins(
  values: Array<string | undefined>,
): Set<string> {
  return new Set(
    values.flatMap((value) => {
      try {
        return value ? [new URL(value).origin] : [];
      } catch {
        return [];
      }
    }),
  );
}
export const browserSecurityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
};
export const spaContentSecurityPolicy: RequestHandler = (_req, res, next) => {
  res.setHeader("Content-Security-Policy", SPA_CONTENT_SECURITY_POLICY);
  next();
};
export function browserMutationGuard(origins: Set<string>): RequestHandler {
  return (req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin");
      if (
        req.get("sec-fetch-site") === "cross-site" ||
        (origin && !origins.has(origin))
      ) {
        res
          .status(403)
          .json({ error: "このサイトからの変更要求は許可されていません。" });
        return;
      }
    }
    next();
  };
}
