import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";

const COOKIE_NAME = "dplt_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

interface AuthState {
  password: {
    salt: string;
    hash: string;
  } | null;
  sessionSecret: string;
}

export function createAuth(storageDir: string) {
  fs.mkdirSync(storageDir, { recursive: true });
  const authPath = path.join(storageDir, "auth.json");
  const state = loadState(authPath);

  function isConfigured() {
    return Boolean(state.password);
  }

  function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (isPublicPath(req.path)) {
      next();
      return;
    }

    if (isRunnerPath(req.path) && verifyRunnerToken(req.headers.authorization)) {
      next();
      return;
    }

    if (!isConfigured()) {
      if (isApiPath(req.path)) {
        res.status(403).json({ error: "Admin password setup required" });
        return;
      }
      res.redirect("/auth.html?mode=setup");
      return;
    }

    if (verifyCookie(req.headers.cookie)) {
      next();
      return;
    }

    if (isApiPath(req.path) || req.path.startsWith("/socket.io/")) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    res.redirect("/auth.html");
  }

  const router = express.Router();

  router.get("/api/auth/status", (_req, res) => {
    res.json({ configured: isConfigured() });
  });

  router.post("/api/auth/setup", (req, res) => {
    if (isConfigured()) {
      res.status(409).json({ error: "Admin password is already configured" });
      return;
    }

    const password = String(req.body?.password ?? "");
    if (password.length < 10) {
      res.status(400).json({ error: "Password must be at least 10 characters" });
      return;
    }

    state.password = hashPassword(password);
    saveState(authPath, state);
    setSessionCookie(res, createSession());
    res.json({ ok: true });
  });

  router.post("/api/auth/login", (req, res) => {
    if (!isConfigured()) {
      res.status(403).json({ error: "Admin password setup required" });
      return;
    }

    const password = String(req.body?.password ?? "");
    if (!state.password || !verifyPassword(password, state.password)) {
      res.status(401).json({ error: "Invalid password" });
      return;
    }

    setSessionCookie(res, createSession());
    res.json({ ok: true });
  });

  router.post("/api/auth/logout", (_req, res) => {
    res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });

  function createSession() {
    const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_TTL_MS })).toString("base64url");
    const signature = sign(payload, state.sessionSecret);
    return `${payload}.${signature}`;
  }

  function verifySession(token: string | null) {
    if (!token) return false;
    const [payload, signature] = token.split(".");
    if (!payload || !signature || sign(payload, state.sessionSecret) !== signature) return false;
    try {
      const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: number };
      return typeof session.exp === "number" && session.exp > Date.now();
    } catch {
      return false;
    }
  }

  function verifyCookie(cookieHeader: string | undefined) {
    return verifySession(readCookie(cookieHeader, COOKIE_NAME));
  }

  return { routes: router, requireAuth, verifyCookie };
}

function isPublicPath(pathname: string) {
  return pathname === "/health" || pathname === "/auth.html" || pathname.startsWith("/api/auth/");
}

function isApiPath(pathname: string) {
  return pathname.startsWith("/api/");
}

function isRunnerPath(pathname: string) {
  return (
    pathname === "/api/runner/claim" ||
    pathname === "/api/execution-logs" ||
    /^\/api\/tasks\/[^/]+\/status$/.test(pathname)
  );
}

function verifyRunnerToken(header: string | undefined) {
  const token = process.env.RUNNER_API_TOKEN;
  return Boolean(token && header === `Bearer ${token}`);
}

function loadState(authPath: string): AuthState {
  if (fs.existsSync(authPath)) {
    const parsed = JSON.parse(fs.readFileSync(authPath, "utf8")) as Partial<AuthState>;
    return {
      password: parsed.password ?? null,
      sessionSecret: parsed.sessionSecret ?? crypto.randomBytes(32).toString("base64url")
    };
  }

  const state = {
    password: null,
    sessionSecret: crypto.randomBytes(32).toString("base64url")
  };
  saveState(authPath, state);
  return state;
}

function saveState(authPath: string, state: AuthState) {
  fs.writeFileSync(authPath, JSON.stringify(state, null, 2), { mode: 0o600 });
}

function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto.scryptSync(password, salt, 64).toString("base64url");
  return { salt, hash };
}

function verifyPassword(password: string, stored: { salt: string; hash: string }) {
  const hash = crypto.scryptSync(password, stored.salt, 64);
  const expected = Buffer.from(stored.hash, "base64url");
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}

function sign(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function setSessionCookie(res: express.Response, token: string) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`);
}

function readCookie(header: string | undefined, name: string) {
  const cookies = header?.split(";") ?? [];
  for (const cookie of cookies) {
    const [rawKey, ...rawValue] = cookie.trim().split("=");
    if (rawKey === name) return rawValue.join("=");
  }
  return null;
}
