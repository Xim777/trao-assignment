import dotenv from "dotenv";
import { extractJobDescription } from "@prepkit/core";
import { generateWithGemini } from "./services/llm/gemini-provider.js";
import { fileURLToPath } from "node:url";

import express from "express";
import cors from "cors";
import helmet from "helmet";

import { InterviewKitSchema } from "@prepkit/core";

dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url))
});

const app = express();

const PORT = Number(process.env.PORT ?? 4000);

const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN ??
  "http://localhost:3000";


// ----------------------------------
// Middleware
// ----------------------------------

app.use(helmet());

app.use(cors({
  origin: FRONTEND_ORIGIN,
  credentials: true
}));

app.use(express.json({
  limit: "1mb"
}));


// ----------------------------------
// Health Check
// ----------------------------------

app.get("/health", (_req, res) => {

  res.status(200).json({
    status: "ok",
    service: "ai-interview-prep-api"
  });

});


// ----------------------------------
// Validate Interview Kit
// ----------------------------------

app.post("/api/kits/validate", (req, res) => {

  const result = InterviewKitSchema.safeParse(req.body);

  if (!result.success) {

    return res.status(400).json({

      error: "INVALID_KIT",

      message: "Interview kit validation failed",

      issues: result.error.issues.map(issue => ({

        path: issue.path.join("."),

        message: issue.message

      }))

    });

  }


  return res.status(200).json({

    valid: true,

    kit: result.data

  });

});


// ----------------------------------
// Extract Job Description
// ----------------------------------

app.post("/api/kits/extract-role", (req, res) => {
  const { jd } = req.body;

  // Validate input
  if (typeof jd !== "string" || !jd.trim()) {
    return res.status(400).json({
      error: "INVALID_INPUT",
      message: "A non-empty job description is required."
    });
  }

  // Run the extraction pipeline
  void extractJobDescription(jd, generateWithGemini)
    .then(role => {
      return res.status(200).json({
        success: true,
        role
      });
    })
    .catch(error => {
      console.error("JD extraction failed:", error);

      return res.status(502).json({
        error: "EXTRACTION_FAILED",
        message: "Failed to extract job description."
      });
    });
});


// ----------------------------------
// 404 Handler
// ----------------------------------

app.use((_req, res) => {

  res.status(404).json({
    error: "NOT_FOUND",
    message: "Endpoint does not exist"
  });

});


// ----------------------------------
// Start Server
// ----------------------------------

app.listen(PORT, "0.0.0.0", () => {

  console.log(
    `Backend running at http://localhost:${PORT}`
  );

});
