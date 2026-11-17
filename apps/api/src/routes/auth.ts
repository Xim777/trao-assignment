import { Router } from "express";
import { z } from "zod";
import {
  authenticateUser,
  createUserSession,
  registerUser,
  revokeUserSession
} from "../services/auth-service.js";
import {
  readSessionCookie,
  requireAuth,
  requireTrustedOrigin,
  SESSION_COOKIE_NAME
} from "../middleware/require-auth.js";

const RegisterSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128)
}).strict();

const LoginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128)
}).strict();

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" as const : "lax" as const,
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000
  };
}

export function createAuthRouter(): Router {
  const router = Router();

  router.post("/register", requireTrustedOrigin, async (request, response) => {
    const parsed = RegisterSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        success: false,
        error: "INVALID_INPUT",
        details: parsed.error.flatten()
      });
      return;
    }

    try {
      const user = await registerUser(parsed.data.email, parsed.data.password);
      const session = await createUserSession(user.id);
      response.cookie(SESSION_COOKIE_NAME, session.token, cookieOptions());
      response.status(201).json({ success: true, user });
    } catch (error) {
      const duplicate = (
        error instanceof Error && error.message.includes("already exists")
      ) || (
        typeof error === "object" && error !== null &&
        "code" in error && error.code === 11000
      );

      response.status(duplicate ? 409 : 503).json({
        success: false,
        error: duplicate ? "EMAIL_ALREADY_REGISTERED" : "REGISTRATION_FAILED",
        message: duplicate
          ? "An account with this email already exists."
          : "Unable to create the account right now."
      });
    }
  });

  router.post("/login", requireTrustedOrigin, async (request, response) => {
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        success: false,
        error: "INVALID_INPUT",
        details: parsed.error.flatten()
      });
      return;
    }

    try {
      const user = await authenticateUser(parsed.data.email, parsed.data.password);
      if (!user) {
        response.status(401).json({
          success: false,
          error: "INVALID_CREDENTIALS",
          message: "Email or password is incorrect."
        });
        return;
      }

      const session = await createUserSession(user.id);
      response.cookie(SESSION_COOKIE_NAME, session.token, cookieOptions());
      response.status(200).json({ success: true, user });
    } catch {
      response.status(503).json({
        success: false,
        error: "LOGIN_UNAVAILABLE",
        message: "Unable to log in right now."
      });
    }
  });

  router.post("/logout", requireTrustedOrigin, async (request, response) => {
    const token = readSessionCookie(request);
    if (token) {
      try {
        await revokeUserSession(token);
      } catch {
        response.status(503).json({
          success: false,
          error: "LOGOUT_FAILED",
          message: "Unable to end the session right now."
        });
        return;
      }
    }

    response.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/"
    });
    response.status(200).json({ success: true });
  });

  router.get("/me", requireAuth, (request, response) => {
    response.status(200).json({
      success: true,
      user: request.authUser
    });
  });

  return router;
}
