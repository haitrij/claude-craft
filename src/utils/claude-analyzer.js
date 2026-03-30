import { isClaudeAvailable, runClaude } from './run-claude.js';
import { extractJsonObject } from './json-extract.js';
import { formatContextForAnalyzer } from './existing-setup.js';
import * as logger from './logger.js';

/**
 * Claude-powered project analysis prompt.
 *
 * Inspired by SuperClaude's repo-index agent — uses 5-category parallel
 * discovery to build a structured project index, identifies entry points,
 * measures complexity, and detects architecture patterns.
 */
const ANALYSIS_PROMPT = `You are a project analysis agent. Your job is to deeply understand this codebase
and produce a structured JSON index. Be thorough — this index will be used to configure
the development environment and will save thousands of tokens in future sessions.

## Discovery Process (do all 5 in parallel where possible)

### 1. CODE — Glob for source files
- Glob for: **/*.{js,jsx,ts,tsx,py,go,rs,java,kt,cs,rb,php,swift,html,cshtml,razor,css,scss,vue,svelte,dart,sql,hcl,tf}
- Count total files and estimate lines of code per language
- Calculate language distribution as percentages of the codebase (must sum to ~100)
- Identify entry points: main files, CLI entry, server start, index files

### 2. CONFIG — Read manifest and config files
- Read: package.json, go.mod, Cargo.toml, pyproject.toml, *.csproj, pom.xml, build.gradle, composer.json, Gemfile
- Read: tsconfig.json, .babelrc, webpack.config.*, vite.config.*, next.config.*
- Read: Dockerfile, docker-compose.yml/yaml
- Extract: name, description, dependencies, scripts/commands

### 3. DOCS — Check documentation
- Read first 80 lines of README.md or README
- Check for: docs/, doc/, wiki/, ARCHITECTURE.md, CONTRIBUTING.md, ADR/
- Summarize what the project does and its purpose

### 4. TESTS — Identify test infrastructure
- Glob for: **/*.test.*, **/*.spec.*, **/test_*.*, tests/, __tests__/, spec/
- Identify test framework: jest, vitest, pytest, go test, cargo test, junit, xunit, rspec
- Estimate test coverage based on test file count vs source file count

### 5. INFRASTRUCTURE — Check CI/CD and deployment
- Check: .github/workflows/, .gitlab-ci.yml, Jenkinsfile, .circleci/, bitbucket-pipelines.yml
- Check: Dockerfile, docker-compose.yml, k8s/, terraform/, pulumi/, serverless.yml
- Check for code style: .eslintrc*, .prettierrc*, .editorconfig, [tool.ruff], .golangci.yml, rustfmt.toml

## Architecture Detection

Identify the architecture pattern from directory structure:
- **Layered/MVC**: controllers/, models/, views/, services/, routes/
- **Clean Architecture**: domain/, application/, infrastructure/, presentation/
- **Hexagonal**: ports/, adapters/, core/
- **Microservices**: multiple services/ with own configs, docker-compose with multiple services
- **Monorepo**: packages/, apps/, libs/ with workspace config
- **Serverless**: functions/, lambda/, serverless.yml
- **Event-driven**: events/, handlers/, queues/, subscribers/

## Complexity Assessment

Estimate project complexity on a 0.0 to 1.0 scale based on:
- File count: <20 files = 0.1, 20-100 = 0.3, 100-500 = 0.5, 500-2000 = 0.7, 2000+ = 0.9
- Directory depth: max nesting level
- Dependency count: total production dependencies
- Language count: multiple languages = higher complexity
- Subproject count: monorepo with many packages = higher
Average these factors.

## Output Format

Return ONLY a valid JSON object. No markdown fences, no explanation — just the JSON:
{
  "name": "project-name",
  "description": "One-two sentence description of what this project does and its purpose",
  "projectType": "monorepo|microservice|monolith|library|cli",
  "languages": ["TypeScript"],
  "languageDistribution": { "TypeScript": 85, "CSS": 10, "HTML": 5 },
  "frameworks": ["Next.js", "Express"],
  "codeStyle": ["eslint", "prettier"],
  "cicd": ["GitHub Actions"],
  "architecture": "Layered MVC with service layer",
  "complexity": 0.5,
  "metrics": {
    "totalFiles": 150,
    "totalDirs": 25,
    "maxDepth": 5,
    "dependencyCount": 42,
    "testFileCount": 30,
    "sourceFileCount": 120,
    "estimatedTestCoverage": "25%"
  },
  "entryPoints": [
    { "type": "server", "path": "src/index.ts", "command": "npm start" },
    { "type": "cli", "path": "bin/cli.js", "command": "node bin/cli.js" }
  ],
  "coreModules": [
    { "path": "src/services/", "purpose": "Business logic layer", "key": true },
    { "path": "src/routes/", "purpose": "API route definitions", "key": true }
  ],
  "subprojects": [
    { "name": "web", "path": "apps/web", "languages": ["TypeScript"], "frameworks": ["Next.js"] }
  ],
  "buildCommands": {
    "install": "npm install",
    "dev": "npm run dev",
    "build": "npm run build",
    "test": "npm test",
    "lint": "npm run lint"
  },
  "databases": ["postgresql", "redis"],
  "testFramework": "jest",
  "packageManager": "npm"
}

Rules:
- projectType must be one of: "monorepo", "microservice", "monolith", "library", "cli"
- Language names: "JavaScript", "TypeScript", "Python", "Go", "Rust", "Java", "Kotlin", "C#", "Ruby", "PHP", "Swift", "HTML", "CSS", "SQL", "Dart", "HCL"
- Framework names: "Next.js", "React", "Vue", "Angular", "Express", "Fastify", "Django", "Flask", "FastAPI", "Gin", "Echo", "Actix", "Spring Boot", "ASP.NET Core", "Razor", "Blazor", "Rails", "Laravel", "Tailwind CSS"
- Database names: "postgresql", "sql-server", "mysql", "sqlite", "mongodb", "redis", "cosmosdb", "dynamodb", "neo4j", "elasticsearch", "mariadb", "firestore", "cockroachdb". Detect from dependency manifests (NuGet PackageReference, npm packages, pip packages, etc.)
- languageDistribution values are integers representing percentages, must sum to approximately 100
- Only include languages with >= 2% of the codebase in languageDistribution. If exact LOC is unavailable, estimate from file counts
- complexity must be a float between 0.0 and 1.0
- subprojects should be [] if not a monorepo
- buildCommands values should be null if unknown
- Return ONLY the JSON, nothing else`;

/**
 * Run Claude CLI to analyze the project directory.
 * Returns { analysis, failReason } where analysis is the parsed object or null,
 * and failReason is null on success or a string describing the failure.
 *
 * @param {string}      targetDir       - Project root
 * @param {object|null} existingContext  - Context from a previous Claude setup (optional)
 */
export async function analyzeWithClaude(targetDir, existingContext = null) {
  if (!isClaudeAvailable()) {
    return { analysis: null, failReason: 'cli-unavailable' };
  }

  try {
    const contextBlock = formatContextForAnalyzer(existingContext);
    const fullPrompt = ANALYSIS_PROMPT + contextBlock;

    const output = await runClaude([
      '-p',
      '--max-turns', '8',
      '--allowedTools', 'Read,Glob,Grep,Bash(ls:*),Bash(find:*),Bash(head:*),Bash(wc:*),Bash(cat:*)',
    ], { cwd: targetDir, stdinInput: fullPrompt });

    // Extract the JSON object from response using brace-balanced parsing
    const analysis = extractJsonObject(output);
    if (!analysis) {
      logger.warn('Claude analysis did not return valid JSON — falling back.');
      return { analysis: null, failReason: 'invalid-json' };
    }

    if (!analysis.name && !analysis.languages) {
      logger.warn('Claude analysis returned incomplete data — falling back.');
      return { analysis: null, failReason: 'incomplete-data' };
    }

    return { analysis: sanitizeAnalysis(analysis), failReason: null };
  } catch (err) {
    if (err.killed) {
      logger.warn('Claude analysis timed out — falling back to filesystem detection.');
      return { analysis: null, failReason: 'timeout' };
    } else {
      logger.warn('Claude analysis failed — falling back to filesystem detection.');
      return { analysis: null, failReason: 'error' };
    }
  }
}

/**
 * Sanitize and normalize a language distribution object.
 * Returns null if the data is missing or invalid.
 */
function sanitizeDistribution(dist) {
  if (!dist || typeof dist !== 'object' || Array.isArray(dist)) return null;
  const result = {};
  let total = 0;
  for (const [lang, pct] of Object.entries(dist)) {
    if (typeof lang === 'string' && typeof pct === 'number' && pct > 0) {
      const clamped = Math.max(0, Math.min(100, Math.round(pct)));
      if (clamped >= 1) {
        result[lang] = clamped;
        total += clamped;
      }
    }
  }
  if (Object.keys(result).length === 0) return null;
  // Normalize if total is wildly off (allow +/- 10% tolerance)
  if (total > 0 && (total < 90 || total > 110)) {
    for (const lang of Object.keys(result)) {
      result[lang] = Math.round((result[lang] / total) * 100);
    }
  }
  return result;
}

/**
 * Sanitize and normalize Claude's analysis output.
 */
export function sanitizeAnalysis(raw) {
  const safeArray = (arr) => Array.isArray(arr) ? arr.filter((v) => typeof v === 'string') : [];
  const safeStr = (val, fallback = '') => typeof val === 'string' ? val : fallback;
  const safeNum = (val, fallback = 0) => typeof val === 'number' ? val : fallback;

  return {
    name: safeStr(raw.name),
    description: safeStr(raw.description),
    projectType: ['monorepo', 'microservice', 'monolith', 'library', 'cli'].includes(raw.projectType)
      ? raw.projectType : 'monolith',
    languages: safeArray(raw.languages),
    languageDistribution: sanitizeDistribution(raw.languageDistribution),
    frameworks: safeArray(raw.frameworks),
    databases: safeArray(raw.databases),
    codeStyle: safeArray(raw.codeStyle),
    cicd: safeArray(raw.cicd),
    architecture: safeStr(raw.architecture),
    complexity: Math.max(0, Math.min(1, safeNum(raw.complexity, 0.5))),
    metrics: raw.metrics && typeof raw.metrics === 'object' ? {
      totalFiles: safeNum(raw.metrics.totalFiles),
      totalDirs: safeNum(raw.metrics.totalDirs),
      maxDepth: safeNum(raw.metrics.maxDepth),
      dependencyCount: safeNum(raw.metrics.dependencyCount),
      testFileCount: safeNum(raw.metrics.testFileCount),
      sourceFileCount: safeNum(raw.metrics.sourceFileCount),
      estimatedTestCoverage: safeStr(raw.metrics.estimatedTestCoverage, 'unknown'),
    } : { totalFiles: 0, totalDirs: 0, maxDepth: 0, dependencyCount: 0, testFileCount: 0, sourceFileCount: 0, estimatedTestCoverage: 'unknown' },
    entryPoints: Array.isArray(raw.entryPoints)
      ? raw.entryPoints.map((e) => ({ type: safeStr(e.type), path: safeStr(e.path), command: safeStr(e.command) }))
      : [],
    coreModules: Array.isArray(raw.coreModules)
      ? raw.coreModules.map((m) => ({ path: safeStr(m.path), purpose: safeStr(m.purpose), key: !!m.key }))
      : [],
    subprojects: Array.isArray(raw.subprojects)
      ? raw.subprojects.map((s) => ({
          name: safeStr(s.name),
          path: safeStr(s.path),
          languages: safeArray(s.languages),
          frameworks: safeArray(s.frameworks),
        }))
      : [],
    buildCommands: raw.buildCommands && typeof raw.buildCommands === 'object'
      ? {
          install: raw.buildCommands.install || null,
          dev: raw.buildCommands.dev || null,
          build: raw.buildCommands.build || null,
          test: raw.buildCommands.test || null,
          lint: raw.buildCommands.lint || null,
        }
      : { install: null, dev: null, build: null, test: null, lint: null },
    testFramework: safeStr(raw.testFramework),
    packageManager: safeStr(raw.packageManager),
  };
}
