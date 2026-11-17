# AI Interview Prep Kit

A full-stack application that researches a company and turns a job description into a structured interview preparation kit.

## Stack

- Frontend: Next.js, React and Tailwind CSS
- Backend: Node.js, Express and TypeScript
- Database: MongoDB with Mongoose
- Validation: Zod
- LLM: Gemini (configured through `GEMINI_API_KEY`)
- Public discussion search: Tavily (configured through `TAVILY_API_KEY`)

## Local setup

Requirements: Node.js 22+, npm and MongoDB.

```bash
npm ci
cp .env.example .env
```

Set the credentials in `.env`:

| Variable | Purpose |
|---|---|
| `PORT` | API port (default 4000) |
| `NODE_ENV` | Runtime environment; production enables secure cookies and blocks private website targets |
| `FRONTEND_ORIGIN` | Exact frontend origin allowed by CORS |
| `MONGODB_URI` | MongoDB connection string |
| `GEMINI_API_KEY` | Gemini API credential |
| `LLM_MODEL` | Optional Gemini model override |
| `TAVILY_API_KEY` | Tavily public discussion search credential |

Build and test:

```bash
npm run build
npm test
```

Run the application:

```bash
npm run dev
```

The API listens on `http://localhost:4000`; the web app listens on `http://localhost:3000`.

## Backend architecture

- `packages/core/src/extraction`: extracts a role and stable requirement IDs from pasted job-description text.
- `packages/core/src/research`: checks site policy, crawls and ranks company pages, searches public discussions and creates an evidence-grounded company brief.
- `packages/core/src/generation`: generates category-specific questions, performs deterministic coverage checks and a second pass, creates flashcards and allocates the study schedule.
- `packages/core/src/schemas`: validates the Appendix A interview-kit structure.
- `apps/api/src/services`: provider integrations and authentication.
- `apps/api/src/models`: MongoDB user, session and kit records.
- `apps/api/src/routes`: authentication, kit generation and owner-scoped kit CRUD endpoints.

The HTTP generation route and batch evaluator call the same `generateInterviewKit` core function. The assembled object is validated against `InterviewKitSchema` before it is returned or saved.

## Authentication and persistence

- Register: `POST /api/auth/register` with `{ "email": "...", "password": "..." }`.
- Login: `POST /api/auth/login`.
- Logout: `POST /api/auth/logout`.
- Current user: `GET /api/auth/me`.
- Sessions use opaque random tokens in HTTP-only cookies. Only a SHA-256 hash of each token is stored in MongoDB; sessions expire after seven days.
- Passwords are stored as salted scrypt hashes.
- All `/api/kits/*` endpoints and `/api/research/*` endpoints require a valid session.
- Kit list, read, update and delete queries are scoped by the authenticated user's ID. A kit belonging to another user is reported as not found.

Kit endpoints:

- `POST /api/kits/generate`: generate a complete Appendix A kit from a role and company research result.
- `POST /api/kits`: save a validated kit.
- `GET /api/kits`: list the signed-in user's kits.
- `GET /api/kits/:id`: retrieve one owned kit.
- `PUT /api/kits/:id`: replace an owned kit with a validated kit.
- `DELETE /api/kits/:id`: delete an owned kit.
- `POST /api/kits/research`: run the research pipeline.
- `POST /api/kits/extract-role`: extract role requirements.
- `POST /api/kits/validate`: validate an Appendix A kit.

## Required batch evaluator

Input file:

```json
[
  {
    "id": "case-01",
    "jd": "Senior Backend Engineer\\n\\nWe are looking for ...",
    "company_url": "http://localhost:8099/acme/",
    "days": 5
  }
]
```

Run the exact required command:

```bash
npm run evaluate -- --input cases.json --output kits.json
```

The output contains `version`, `generated_at` and one result per input case in `kits`. Each case is recorded as `ok` with a complete Appendix A kit, or `failed` with an error code and message. A failed case does not stop subsequent cases. Cases run sequentially to respect provider and host rate limits.

Local/private website targets are permitted when `NODE_ENV` is not `production` so the evaluator can use local test servers. Production retrieval rejects private and loopback addresses.

## Research and generation sequence

1. Extract role requirements from the pasted job description; no retrieval is performed on the job description.
2. Crawl the supplied company URL, respecting robots.txt, rate limits, response size limits and same-origin redirects.
3. Rank discovered company links and fetch useful official pages, including hiring/interview information when discoverable.
4. Search public interview discussions. Discussion-search failure is recorded as a limitation rather than discarding successful official research.
5. Generate the company brief using collected evidence and validate its citations against collected sources.
6. Generate questions separately by category.
7. Compare generated question requirement IDs against must-have requirements. Run a second generation pass for uncovered must-have requirements and fail rather than shipping a kit with missing must-have coverage.
8. Generate flashcards and a deterministic schedule.
9. Validate the complete Appendix A object before returning or persisting it.

## Known limitations

- Email verification, password reset and role hierarchies are intentionally out of scope for the assessment.
- Generation and research require configured external Gemini and Tavily credentials.
- The batch evaluator runs cases sequentially; total completion time depends on provider quotas and the sites being crawled.
