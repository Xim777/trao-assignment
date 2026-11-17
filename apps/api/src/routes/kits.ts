import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { InterviewKitSchema } from "@prepkit/core";
import { KitModel } from "../models/index.js";

const SaveKitSchema = z.object({
  kit: InterviewKitSchema,
  title: z.string().trim().min(1).max(200).optional()
}).strict();

function isValidId(id: string): boolean {
  return mongoose.isValidObjectId(id);
}

export function createKitRouter(): Router {
  const router = Router();


  router.get("/", async (request, response) => {
    try {
      const kits = await KitModel.find({ userId: request.authUser!.id })
        .sort({ updatedAt: -1 })
        .select("_id title createdAt updatedAt")
        .lean();

      response.status(200).json({
        success: true,
        kits: kits.map(item => ({
          id: String(item._id),
          title: item.title,
          created_at: item.createdAt,
          updated_at: item.updatedAt
        }))
      });
    } catch {
      response.status(503).json({
        success: false,
        error: "KITS_UNAVAILABLE",
        message: "Unable to load your kits right now."
      });
    }
  });

  router.post("/", async (request, response) => {
    const parsed = SaveKitSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        success: false,
        error: "INVALID_KIT",
        details: parsed.error.flatten()
      });
      return;
    }

    try {
      const title = parsed.data.title ?? parsed.data.kit.role.title;
      const saved = await KitModel.create({
        userId: request.authUser!.id,
        title,
        kit: parsed.data.kit
      });

      response.status(201).json({
        success: true,
        kit: {
          id: String(saved._id),
          title: saved.title,
          data: saved.kit,
          created_at: saved.createdAt,
          updated_at: saved.updatedAt
        }
      });
    } catch {
      response.status(503).json({
        success: false,
        error: "KIT_SAVE_FAILED",
        message: "Unable to save this kit right now."
      });
    }
  });

  router.get("/:id", async (request, response) => {
    if (!isValidId(request.params.id!)) {
      response.status(404).json({ success: false, error: "KIT_NOT_FOUND" });
      return;
    }

    try {
      const saved = await KitModel.findOne({
        _id: request.params.id,
        userId: request.authUser!.id
      }).lean();

      if (!saved) {
        response.status(404).json({ success: false, error: "KIT_NOT_FOUND" });
        return;
      }

      response.status(200).json({
        success: true,
        kit: {
          id: String(saved._id),
          title: saved.title,
          data: saved.kit,
          created_at: saved.createdAt,
          updated_at: saved.updatedAt
        }
      });
    } catch {
      response.status(503).json({
        success: false,
        error: "KIT_LOAD_FAILED",
        message: "Unable to load this kit right now."
      });
    }
  });

  router.put("/:id", async (request, response) => {
    if (!isValidId(request.params.id!)) {
      response.status(404).json({ success: false, error: "KIT_NOT_FOUND" });
      return;
    }

    const parsed = SaveKitSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        success: false,
        error: "INVALID_KIT",
        details: parsed.error.flatten()
      });
      return;
    }

    try {
      const updated = await KitModel.findOneAndUpdate(
        {
          _id: request.params.id,
          userId: request.authUser!.id
        },
        {
          $set: {
            title: parsed.data.title ?? parsed.data.kit.role.title,
            kit: parsed.data.kit
          }
        },
        { new: true, runValidators: true }
      ).lean();

      if (!updated) {
        response.status(404).json({ success: false, error: "KIT_NOT_FOUND" });
        return;
      }

      response.status(200).json({
        success: true,
        kit: {
          id: String(updated._id),
          title: updated.title,
          data: updated.kit,
          created_at: updated.createdAt,
          updated_at: updated.updatedAt
        }
      });
    } catch {
      response.status(503).json({
        success: false,
        error: "KIT_UPDATE_FAILED",
        message: "Unable to update this kit right now."
      });
    }
  });

  router.delete("/:id", async (request, response) => {
    if (!isValidId(request.params.id!)) {
      response.status(404).json({ success: false, error: "KIT_NOT_FOUND" });
      return;
    }

    try {
      const deleted = await KitModel.findOneAndDelete({
        _id: request.params.id,
        userId: request.authUser!.id
      });

      if (!deleted) {
        response.status(404).json({ success: false, error: "KIT_NOT_FOUND" });
        return;
      }

      response.status(200).json({ success: true });
    } catch {
      response.status(503).json({
        success: false,
        error: "KIT_DELETE_FAILED",
        message: "Unable to delete this kit right now."
      });
    }
  });

  return router;
}
