import dotenv from "dotenv";
import { generateWithGemini } from "./services/llm/gemini-provider.js";
import { fileURLToPath } from "node:url";
import { createTavilySearchProvider } from "./services/search/tavily-provider.js";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import {
  createKitGenerationRouter
} from "./routes/kit-generation.js";

import {
  extractJobDescription,
  searchCompanyDiscussions,
  runResearchPipeline,
  createResearchServiceDependencies,
  RunResearchInputSchema,
  InterviewKitSchema
} from "@prepkit/core";

dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url))
});

const app = express();

const PORT = Number(process.env.PORT ?? 4000);

const tavilySearchProvider = createTavilySearchProvider();

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
// Search Company Interview Discussions
// ----------------------------------

app.post("/api/research/discussions", async (req, res) => {
  const { company, role } = req.body ?? {};

  // Validate input
  if (
    typeof company !== "string" ||
    !company.trim() ||
    company.trim().length > 100 ||
    typeof role !== "string" ||
    !role.trim() ||
    role.trim().length > 100
  ) {
    return res.status(400).json({
      error: "INVALID_INPUT",
      message: "A valid company name and role are required."
    });
  }

  try {
    const report = await searchCompanyDiscussions(
      {
        company: company.trim(),
        role: role.trim()
      },
      tavilySearchProvider
    );

    return res.status(200).json({
      success: true,
      report
    });

  } catch (error) {
    console.error("Company discussion search failed:", error);

    return res.status(500).json({
      error: "DISCUSSION_SEARCH_FAILED",
      message: "Failed to search company discussions."
    });
  }
});

// ----------------------------------
// Run Complete Research Pipeline
// ----------------------------------

app.post("/api/kits/research", async (req, res) => {
  const validation = RunResearchInputSchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({
      success: false,
      error: "INVALID_INPUT",
      details: validation.error.flatten()
    });
  }

  try {
    const dependencies = createResearchServiceDependencies(
      generateWithGemini,
      tavilySearchProvider
    );

    const result = await runResearchPipeline(
      validation.data,
      dependencies
    );

    return res.status(200).json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error("Research pipeline failed:", error);

    return res.status(502).json({
      success: false,
      error: "RESEARCH_PIPELINE_FAILED",
      message: error instanceof Error
        ? error.message
        : "Research pipeline failed."
    });
  }
});

// ----------------------------------
// Kit Generation
// ----------------------------------
app.use(
  "/api/kits",
  createKitGenerationRouter({
    generateJson: generateWithGemini
  })
);

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
