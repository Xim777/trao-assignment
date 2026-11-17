import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { generateWithGemini } from "./services/llm/gemini-provider.js";
import { createTavilySearchProvider } from "./services/search/tavily-provider.js";
import { connectDatabase } from "./database.js";
import { createAuthRouter } from "./routes/auth.js";
import { createKitRouter } from "./routes/kits.js";
import { requireAuth } from "./middleware/require-auth.js";
import { createKitGenerationRouter } from "./routes/kit-generation.js";
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
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";

app.use(helmet());
app.use(cors({
  origin: FRONTEND_ORIGIN,
  credentials: true
}));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_request, response) => {
  response.status(200).json({
    status: "ok",
    service: "ai-interview-prep-api"
  });
});

app.use("/api/auth", createAuthRouter());

// All kit operations require a valid, unexpired session.
app.use("/api/kits", requireAuth);

app.post("/api/kits/validate", (request, response) => {
  const result = InterviewKitSchema.safeParse(request.body);
  if (!result.success) {
    response.status(400).json({
      error: "INVALID_KIT",
      message: "Interview kit validation failed",
      issues: result.error.issues.map(issue => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
    return;
  }

  response.status(200).json({ valid: true, kit: result.data });
});

app.post("/api/kits/extract-role", async (request, response) => {
  const jd = request.body?.jd;
  if (typeof jd !== "string" || !jd.trim() || jd.length > 50000) {
    response.status(400).json({
      error: "INVALID_INPUT",
      message: "A non-empty job description of at most 50000 characters is required."
    });
    return;
  }

  try {
    const role = await extractJobDescription(jd, generateWithGemini);
    response.status(200).json({ success: true, role });
  } catch (error) {
    console.error("JD extraction failed:", error);
    response.status(502).json({
      error: "EXTRACTION_FAILED",
      message: error instanceof Error ? error.message : "Failed to extract job description."
    });
  }
});

app.post("/api/research/discussions", async (request, response) => {
  const { company, role } = request.body ?? {};
  if (
    typeof company !== "string" || !company.trim() || company.trim().length > 100 ||
    typeof role !== "string" || !role.trim() || role.trim().length > 100
  ) {
    response.status(400).json({
      error: "INVALID_INPUT",
      message: "A valid company name and role are required."
    });
    return;
  }

  try {
    const report = await searchCompanyDiscussions(
      { company: company.trim(), role: role.trim() },
      tavilySearchProvider
    );
    response.status(200).json({ success: true, report });
  } catch (error) {
    console.error("Company discussion search failed:", error);
    response.status(500).json({
      error: "DISCUSSION_SEARCH_FAILED",
      message: "Failed to search company discussions."
    });
  }
});

app.post("/api/kits/research", async (request, response) => {
  const validation = RunResearchInputSchema.safeParse(request.body);
  if (!validation.success) {
    response.status(400).json({
      success: false,
      error: "INVALID_INPUT",
      details: validation.error.flatten()
    });
    return;
  }

  try {
    const dependencies = createResearchServiceDependencies(
      generateWithGemini,
      tavilySearchProvider
    );
    const result = await runResearchPipeline(validation.data, dependencies);
    response.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error("Research pipeline failed:", error);
    response.status(502).json({
      success: false,
      error: "RESEARCH_PIPELINE_FAILED",
      message: error instanceof Error ? error.message : "Research pipeline failed."
    });
  }
});

app.use("/api/kits", createKitGenerationRouter({
  generateJson: generateWithGemini
}));
app.use("/api/kits", createKitRouter());

app.use((_request, response) => {
  response.status(404).json({
    error: "NOT_FOUND",
    message: "Endpoint does not exist"
  });
});

async function startServer(): Promise<void> {
  await connectDatabase();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Backend running at http://localhost:${PORT}`);
  });
}

startServer().catch(error => {
  console.error("Backend startup failed:", error);
  process.exit(1);
});
