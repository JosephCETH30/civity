import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, Response, NextFunction } from 'express';
import { config } from './config.ts';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

/** Stored as "salt:hash" (hex). */
export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${(await scryptAsync(pw, salt, 64)).toString('hex')}`;
}
export async function checkPassword(pw: string, stored: string | null | undefined) {
  const [salt, hash] = stored?.split(':') ?? [];
  if (!salt || !hash) return false;
  const a = await scryptAsync(pw, Buffer.from(salt, 'hex'), 64);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Session identity carried in a signed token. The token IS the account: there is no password. */
export interface Identity {
  sub: string; // user uuid
  exp: number;
}

const sign = (data: string) => createHmac('sha256', config.authSecret).update(data).digest('base64url');

// shortcut: long-lived bearer token stored on the device; losing it loses the identity. Add recovery (email/passkey) if users need multi-device.
export function issueToken(sub: string, ttlSec = 60 * 60 * 24 * 365) {
  const body = Buffer.from(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + ttlSec })).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifyToken(token: string | undefined | null): Identity | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const id = JSON.parse(Buffer.from(body, 'base64url').toString()) as Identity;
    return typeof id.sub === 'string' && id.exp > Date.now() / 1000 ? id : null;
  } catch {
    return null;
  }
}

declare global {
  namespace Express {
    interface Request {
      identity?: Identity;
    }
  }
}

export function readIdentity(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  req.identity = verifyToken(h?.startsWith('Bearer ') ? h.slice(7) : null) ?? undefined;
  next();
}
export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.identity) return void res.status(401).json({ error: 'Enter a username first' });
  next();
}

/** Fixed-window limiter. shortcut: in-memory per process; move to Redis when running more than one server instance. */
export function rateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key: string) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) {
      if (hits.size > 10000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      hits.set(key, { n: 1, reset: now + windowMs });
      return true;
    }
    return ++h.n <= limit;
  };
}
