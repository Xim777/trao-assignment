import type { NextFunction, Request, Response } from "express";
import { findUserForSession } from "../services/auth-service.js";

export interface AuthUser {
  id: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

export const SESSION_COOKIE_NAME = "trao_session";

export function readSessionCookie(request: Request): string | null {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;

    const name = part.slice(0, separator).trim();
    if (name !== SESSION_COOKIE_NAME) continue;

    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value) || null;
    } catch {
      return null;
    }
  }

  return null;
}

export async function requireAuth(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  const token = readSessionCookie(request);
  if (!token) {
    response.status(401).json({
      success: false,
      error: "UNAUTHENTICATED",
      message: "Please log in to continue."
    });
    return;
  }

  try {
    const user = await findUserForSession(token);
    if (!user) {
      response.clearCookie(SESSION_COOKIE_NAME, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/"
      });
      response.status(401).json({
        success: false,
        error: "SESSION_EXPIRED",
        message: "Your session is invalid or has expired. Please log in again."
      });
      return;
    }

    request.authUser = user;
    next();
  } catch {
    response.status(503).json({
      success: false,
      error: "AUTH_UNAVAILABLE",
      message: "Authentication is temporarily unavailable."
    });
  }
}
