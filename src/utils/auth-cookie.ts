import { Request, Response, CookieOptions } from "express";
import config from "./config";

// The refresh token lives in an HttpOnly cookie so client-side JavaScript can
// never read it (XSS cannot exfiltrate it). The short-lived access token stays
// in memory on the client and is sent via the Authorization header.
export const REFRESH_TOKEN_COOKIE = "refreshToken";

// Scope the cookie to the auth endpoints so it is only ever sent to /refresh
// and /logout, not attached to every API request.
const REFRESH_COOKIE_PATH = "/api/auth";

const MILLISECONDS_PER_SECOND = 1000;

// The Secure attribute is driven by the *actual* connection protocol, not by
// NODE_ENV. A browser silently drops a Secure cookie on a non-secure context
// (e.g. the app served over plain HTTP on a LAN IP), which would store no
// refresh cookie at all and log the user out on every page refresh. req.secure
// reflects X-Forwarded-Proto because the app sets 'trust proxy'.
const buildCookieOptions = (req: Request): CookieOptions => ({
  httpOnly: true,
  secure: req.secure,
  sameSite: "strict",
  path: REFRESH_COOKIE_PATH,
  maxAge: config.refreshTokenExpiresIn * MILLISECONDS_PER_SECOND,
});

export const setRefreshTokenCookie = (req: Request, res: Response, refreshToken: string): void => {
  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, buildCookieOptions(req));
};

export const clearRefreshTokenCookie = (req: Request, res: Response): void => {
  res.clearCookie(REFRESH_TOKEN_COOKIE, {
    httpOnly: true,
    secure: req.secure,
    sameSite: "strict",
    path: REFRESH_COOKIE_PATH,
  });
};

export const readRefreshTokenCookie = (req: Request): string | null => {
  const header = req.headers.cookie;
  if (!header) {
    return null;
  }

  for (const part of header.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const name = part.slice(0, separatorIndex).trim();
    if (name === REFRESH_TOKEN_COOKIE) {
      return decodeURIComponent(part.slice(separatorIndex + 1).trim());
    }
  }

  return null;
};
