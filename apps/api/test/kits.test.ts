import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import { KitModel } from "../src/models/index.js";
import { requireAuth } from "../src/middleware/require-auth.js";
import { createKitRouter } from "../src/routes/kits.js";

vi.mock("../src/services/auth-service.js", () => ({
  findUserForSession: vi.fn(async () => ({
    id: "64b000000000000000000001",
    email: "owner@example.com"
  }))
}));

describe("owner-scoped kit persistence routes", () => {
  let server: Server | undefined;
  let baseUrl: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close(error => error ? reject(error) : resolve());
      });
      server = undefined;
    }
  });

  async function startServer() {
    const app = express();
    app.use("/api/kits", requireAuth, createKitRouter());

    server = await new Promise<Server>(resolve => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test server did not bind to a TCP port.");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  it("filters kit lists by the authenticated user", async () => {
    const lean = vi.fn().mockResolvedValue([]);
    const select = vi.fn().mockReturnValue({ lean });
    const sort = vi.fn().mockReturnValue({ select });
    const find = vi.spyOn(KitModel, "find").mockReturnValue({ sort } as never);
    await startServer();

    const response = await fetch(`${baseUrl}/api/kits`, {
      headers: { cookie: "trao_session=valid-session-token" }
    });

    expect(response.status).toBe(200);
    expect(find).toHaveBeenCalledWith({ userId: "64b000000000000000000001" });
    expect(sort).toHaveBeenCalledWith({ updatedAt: -1 });
  });

  it("does not reveal a kit that is not owned by the authenticated user", async () => {
    const lean = vi.fn().mockResolvedValue(null);
    const findOne = vi.spyOn(KitModel, "findOne").mockReturnValue({ lean } as never);
    await startServer();

    const response = await fetch(
      `${baseUrl}/api/kits/64b000000000000000000002`,
      { headers: { cookie: "trao_session=valid-session-token" } }
    );

    expect(response.status).toBe(404);
    expect(findOne).toHaveBeenCalledWith({
      _id: "64b000000000000000000002",
      userId: "64b000000000000000000001"
    });
  });

  it("orders practice cards by lowest confidence and reports coverage", async () => {
    const saved = {
      kit: {
        flashcards: [
          { id: "f1", front: "First", back: "Answer 1", requirement_ids: ["r1"] },
          { id: "f2", front: "Second", back: "Answer 2", requirement_ids: ["r2"] },
          { id: "f3", front: "Third", back: "Answer 3", requirement_ids: ["r3"] }
        ]
      },
      practiceProgress: [
        {
          flashcardId: "f1",
          confidence: 5,
          covered: true,
          reviewCount: 2,
          lastReviewedAt: new Date("2026-11-16T10:00:00.000Z")
        },
        {
          flashcardId: "f2",
          confidence: 2,
          covered: true,
          reviewCount: 1,
          lastReviewedAt: new Date("2026-11-16T11:00:00.000Z")
        }
      ]
    };
    const lean = vi.fn().mockResolvedValue(saved);
    vi.spyOn(KitModel, "findOne").mockReturnValue({ lean } as never);
    await startServer();

    const response = await fetch(
      `${baseUrl}/api/kits/64b000000000000000000002/practice`,
      { headers: { cookie: "trao_session=valid-session-token" } }
    );
    const body = await response.json() as {
      cards: Array<{ id: string; confidence: number | null; covered: boolean }>;
      total: number;
      covered: number;
    };

    expect(response.status).toBe(200);
    expect(body.cards.map(card => card.id)).toEqual(["f3", "f2", "f1"]);
    expect(body.cards[0]?.confidence).toBeNull();
    expect(body.total).toBe(3);
    expect(body.covered).toBe(2);
  });

  it("validates confidence updates before touching persistence", async () => {
    const findOne = vi.spyOn(KitModel, "findOne");
    await startServer();

    const response = await fetch(
      `${baseUrl}/api/kits/64b000000000000000000002/practice/f1`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: "trao_session=valid-session-token"
        },
        body: JSON.stringify({ confidence: 6, covered: true })
      }
    );

    expect(response.status).toBe(400);
    expect(findOne).not.toHaveBeenCalled();
  });

  it("blocks kit access when no session cookie is present", async () => {
    await startServer();
    const response = await fetch(`${baseUrl}/api/kits`);
    expect(response.status).toBe(401);
  });
});
