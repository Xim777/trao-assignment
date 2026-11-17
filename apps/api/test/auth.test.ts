import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createAuthRouter } from "../src/routes/auth.js";
import { hashPassword, verifyPassword } from "../src/services/auth-service.js";

describe("authentication", () => {
  let server: Server | undefined;
  let baseUrl: string;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close(error => error ? reject(error) : resolve());
      });
      server = undefined;
    }
  });

  async function startServer() {
    const app = express();
    app.use(express.json());
    app.use("/api/auth", createAuthRouter());

    server = await new Promise<Server>(resolve => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test server did not bind to a TCP port.");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  it("rejects weak passwords before accessing the database", async () => {
    await startServer();

    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "candidate@example.com",
        password: "short"
      })
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      error: "INVALID_INPUT"
    });
  });

  it("rejects malformed login input before accessing the database", async () => {
    await startServer();

    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "not-an-email",
        password: "some-password"
      })
    });

    expect(response.status).toBe(400);
  });

  it("does not expose the current-user endpoint without a session", async () => {
    await startServer();

    const response = await fetch(`${baseUrl}/api/auth/me`);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      success: false,
      error: "UNAUTHENTICATED"
    });
  });

  it("allows logout without a session and clears the session cookie", async () => {
    await startServer();

    const response = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST"
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("trao_session=");
  });

  it("stores a salted password hash and verifies credentials", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(stored).not.toContain("correct horse battery staple");
    expect(stored.split(":")).toHaveLength(2);
    await expect(verifyPassword("correct horse battery staple", stored)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", stored)).resolves.toBe(false);
  });
});
