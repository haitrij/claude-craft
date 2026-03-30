import { isClaudeAvailable, runClaude } from './run-claude.js';
import { extractJsonObject } from './json-extract.js';
import { sanitizeAnalysis } from './claude-analyzer.js';
import * as logger from './logger.js';

/**
 * Prompt for inferring tech stack from a project description.
 *
 * Unlike the full ANALYSIS_PROMPT (which scans real files), this prompt asks
 * Claude to reason about a free-text description and infer the likely stack.
 * It produces the same JSON shape so the server scoring engine works unchanged.
 */
const DESCRIPTION_PROMPT = `You are a project requirements analyzer. Given a project description and developer context, infer the likely tech stack that will be used.

## Rules

- ONLY include technologies that are explicitly mentioned or strongly implied by the description.
- When uncertain, OMIT rather than guess. Empty arrays are better than wrong guesses.
- For complexity, estimate based on described scope:
  - Simple single-page app or script → 0.2
  - Standard CRUD app → 0.4
  - Multi-feature app with auth, API, etc. → 0.5
  - Multi-service or multi-module system → 0.7
  - Large distributed platform → 0.9
- For languageDistribution, estimate percentages based on likely code split.
- For metrics, entryPoints, coreModules — leave empty/null since no code exists yet.
- For buildCommands — infer from the frameworks (e.g., Next.js → "npm run dev", "npm run build").

## Canonical Names

Use these exact names:

- **Languages:** "JavaScript", "TypeScript", "Python", "Go", "Rust", "Java", "Kotlin", "C#", "Ruby", "PHP", "Swift", "HTML", "CSS", "SQL", "Dart", "HCL"
- **Frameworks:** "Next.js", "React", "Vue", "Angular", "Express", "Fastify", "Django", "Flask", "FastAPI", "Gin", "Echo", "Actix", "Spring Boot", "ASP.NET Core", "Razor", "Blazor", "Rails", "Laravel", "Tailwind CSS", "Svelte", "SvelteKit", "Nuxt", "Remix", "Astro", "Hono", "NestJS", "Prisma", "Drizzle", "tRPC"
- **Databases:** "postgresql", "sql-server", "mysql", "sqlite", "mongodb", "redis", "cosmosdb", "dynamodb", "neo4j", "elasticsearch", "mariadb", "firestore", "cockroachdb", "supabase"
- **projectType:** "monorepo", "microservice", "monolith", "library", "cli"

## Output Format

Return ONLY a valid JSON object — no markdown fences, no explanation:
{
  "name": "",
  "description": "",
  "projectType": "monolith",
  "languages": [],
  "languageDistribution": null,
  "frameworks": [],
  "codeStyle": [],
  "cicd": [],
  "architecture": "",
  "complexity": 0.5,
  "metrics": null,
  "entryPoints": [],
  "coreModules": [],
  "subprojects": [],
  "buildCommands": { "install": null, "dev": null, "build": null, "test": null, "lint": null },
  "databases": [],
  "testFramework": "",
  "packageManager": ""
}

Return ONLY the JSON, nothing else.`;

/**
 * Use Claude to infer a structured project analysis from a free-text description.
 *
 * Returns the same { analysis, failReason } tuple as analyzeWithClaude(),
 * so callers can use identical fallback logic.
 *
 * @param {string} description - User's project description (free text)
 * @param {string} projectType - Project type the user selected
 * @returns {Promise<{ analysis: object|null, failReason: string|null }>}
 */
export async function analyzeDescription(description, projectType) {
  if (!isClaudeAvailable()) {
    return { analysis: null, failReason: 'cli-unavailable' };
  }

  try {
    const userBlock = `
## Input

Description: "${description}"
Project Type: ${projectType}

Analyze the description above and return the JSON.`;

    const fullPrompt = DESCRIPTION_PROMPT + userBlock;

    const output = await runClaude([
      '-p',
      '--max-turns', '1',
    ], { stdinInput: fullPrompt, timeout: 30_000 });

    const analysis = extractJsonObject(output);
    if (!analysis) {
      logger.warn('Description analysis did not return valid JSON — using defaults.');
      return { analysis: null, failReason: 'invalid-json' };
    }

    // Override name/description/projectType with user-provided values
    // (user explicitly chose these in the prompts)
    analysis.projectType = projectType;

    return { analysis: sanitizeAnalysis(analysis), failReason: null };
  } catch (err) {
    if (err.killed) {
      logger.warn('Description analysis timed out — using defaults.');
      return { analysis: null, failReason: 'timeout' };
    }
    logger.warn('Description analysis failed — using defaults.');
    return { analysis: null, failReason: 'error' };
  }
}
