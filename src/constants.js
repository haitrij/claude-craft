import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

export const VERSION = pkg.version;
export const TOOL_NAME = 'claude-craft';

// ── Step 1: User intents ──────────────────────────────────────────────

export const INTENTS = [
  { name: 'Implementing new features', value: 'implementing', description: 'Build features from specs, tickets, or ideas' },
  { name: 'Debugging & troubleshooting', value: 'debugging', description: 'Track down bugs, analyze stack traces, fix issues' },
  { name: 'Refactoring & cleanup', value: 'refactoring', description: 'Improve code structure without changing behavior' },
  { name: 'Writing documentation', value: 'documentation', description: 'READMEs, API docs, architecture decisions' },
  { name: 'Testing & QA', value: 'testing', description: 'Unit, integration, and e2e tests' },
  { name: 'Code review', value: 'reviewing', description: 'Review PRs, suggest improvements, catch issues' },
];

// ── Personas ────────────────────────────────────────────────────────

export const PERSONAS = [
  {
    name: 'I\'m building something new — describe what I want, Claude handles the rest',
    value: 'vibe',
    description: 'Streamlined setup with smart defaults',
  },
  {
    name: 'I\'m a developer — full control over agents, skills, MCPs, and workflows',
    value: 'developer',
    description: 'All configuration options available',
  },
];

export const VIBE_DEFAULTS = {
  // Intentionally narrowed to core intents for non-technical users.
  // Full intent list is available in the developer path via gatherUserProfile().
  intents: ['implementing', 'debugging'],
  sourceControl: 'github',
  documentTools: [],
};

// ── Source control platforms ─────────────────────────────────────────

export const SOURCE_CONTROLS = [
  { name: 'GitHub', value: 'github', description: 'GitHub.com or GitHub Enterprise' },
  { name: 'GitLab', value: 'gitlab', description: 'GitLab.com or self-hosted' },
  { name: 'Bitbucket', value: 'bitbucket', description: 'Bitbucket Cloud or Data Center' },
  { name: 'Azure DevOps', value: 'azure-devops', description: 'Azure Repos and Pipelines' },
  { name: 'None / Git only', value: 'none', description: 'Local git without a hosting platform' },
];

// ── Document & project management tools ─────────────────────────────

export const DOCUMENT_TOOLS = [
  { name: 'None', value: 'none' },
  { name: 'Notion', value: 'notion' },
  { name: 'Linear', value: 'linear' },
  { name: 'Google Docs', value: 'google-docs' },
  { name: 'Confluence', value: 'confluence' },
  { name: 'Jira', value: 'jira' },
  { name: 'Azure DevOps', value: 'azure-devops' },
  { name: 'ClickUp', value: 'clickup' },
  { name: 'Asana', value: 'asana' },
  { name: 'Shortcut', value: 'shortcut' },
  { name: 'Monday.com', value: 'monday' },
  { name: 'YouTrack', value: 'youtrack' },
  { name: 'Trello', value: 'trello' },
  { name: 'Todoist', value: 'todoist' },
  { name: 'Plane', value: 'plane' },
  { name: 'Other', value: 'other' },
];

// ── Step 2: Project types ─────────────────────────────────────────────

export const PROJECT_TYPES = [
  { name: 'Monorepo (multiple packages/apps)', value: 'monorepo' },
  { name: 'Microservices', value: 'microservice' },
  { name: 'Monolith', value: 'monolith' },
  { name: 'Library / Package', value: 'library' },
  { name: 'CLI Tool', value: 'cli' },
  { name: 'Other / Unknown', value: 'other' },
];

// ── Languages & Frameworks ────────────────────────────────────────────

export const SUPPORTED_LANGUAGES = [
  'JavaScript',
  'TypeScript',
  'Python',
  'Go',
  'Rust',
  'Java',
  'C#',
  'Ruby',
  'PHP',
  'Swift',
  'Kotlin',
  'Dart',
  'SQL',
  'Solidity',
  'C',
  'C++',
];

export const SUPPORTED_FRAMEWORKS = [
  // Web frameworks
  'Next.js',
  'React',
  'Vue',
  'Angular',
  'Express',
  'Fastify',
  'Django',
  'Flask',
  'FastAPI',
  'Gin',
  'Echo',
  'Actix',
  'Spring Boot',
  'ASP.NET Core',
  'Rails',
  'Laravel',
  'Tailwind CSS',
  // Expanded web frameworks
  'SvelteKit',
  'Nuxt',
  'Astro',
  'Gatsby',
  'NestJS',
  'Remix',
  'Socket.io',
  // Desktop / Mobile
  'Electron',
  'React Native',
  'Expo',
  'Tauri',
  'Flutter',
  // Blockchain
  'Hardhat',
  'Foundry',
  'Web3',
  // Data / AI
  'GraphQL',
  'LangChain',
  'OpenAI SDK',
  'PyTorch',
  'TensorFlow',
  'scikit-learn',
  'Streamlit',
  'Airflow',
  'Pandas',
  'Pydantic',
  'Hugging Face',
  // Game
  'Phaser',
  'Three.js',
  'Unity',
  'Godot',
  'Babylon.js',
  // ORM / DB
  'Prisma',
  'Drizzle',
  // Go frameworks
  'Go API',
  'Cobra',
  'Fiber',
  // Rust frameworks
  'Tokio',
  'Axum',
  'Warp',
  'Clap',
  // Infrastructure
  'Terraform',
  'Serverless Framework',
  // Static sites
  'Hugo',
  'Jekyll',
  'Docusaurus',
  // Mobile / Desktop (extended)
  'Jetpack Compose',
  '.NET MAUI',
  // Data
  'dbt',
  'Dash',
  // AI (extended)
  'LlamaIndex',
  'Vercel AI SDK',
  // Testing
  'Playwright',
  // Bot
  'Discord.js',
  // .NET variants
  'Razor',
  'Blazor',
  'Graphene',
  'HotChocolate',
  'SignalR',
  // CMS / E-commerce
  'WordPress',
  'Shopify',
  // Other
  'Single-SPA',
  'CLI Framework',
  'Scrapy',
  'Browser Extension',
  // C / C++ build systems
  'CMake',
  'Meson',
  'Bazel',
  // C / C++ GUI
  'Qt',
  'GTK',
  'wxWidgets',
  'Dear ImGui',
  // C / C++ multimedia / game
  'SDL',
  'SFML',
  'Unreal Engine',
  // C / C++ web / networking
  'Boost',
  'Drogon',
  'Crow',
  'gRPC',
  // C / C++ embedded / IoT
  'FreeRTOS',
  'ESP-IDF',
  'Zephyr',
  // C / C++ ML / vision
  'OpenCV',
  // C / C++ testing
  'Google Test',
  'Catch2',
];

// ── Components (now auto-selected by scoring) ─────────────────────────

export const COMPONENTS = [
  { name: 'CLAUDE.md', value: 'claude-md', checked: true },
{ name: 'Agents (.claude/agents/)', value: 'agents', checked: true },
  { name: 'Rules (.claude/rules/)', value: 'rules', checked: true },
  { name: 'Hooks (.claude/settings.json)', value: 'hooks', checked: true },
  { name: 'Skills (.claude/skills/)', value: 'skills', checked: true },
  { name: 'Commands (.claude/commands/)', value: 'commands', checked: true },
  { name: 'MCP Servers (.claude/settings.json)', value: 'mcps', checked: true },
  { name: 'Workflows (.claude/workflows/)', value: 'workflows', checked: true },
  { name: 'User Guide', value: 'user-guide', checked: true },
];

export const PRESET_ALIASES = {
  nextjs:    { frameworks: ['Next.js'], languages: ['TypeScript'] },
  'go-api':  { frameworks: ['Go API'], languages: ['Go'] },
  python:    { frameworks: [], languages: ['Python'] },
  rust:      { frameworks: [], languages: ['Rust'] },
  aspnet:    { frameworks: ['ASP.NET Core'], languages: ['C#'] },
  cmake:     { frameworks: ['CMake'], languages: ['C++'] },
};

// ── Security defaults ─────────────────────────────────────────────────

// ── Component types ──────────────────────────────────────────────────

export const COMPONENT_TYPES = {
  CORE: 'core',
  OPTIONAL: 'optional',
  PLUGIN: 'plugin',
};

export const SENSITIVE_PATTERNS = [
  '.env', '.env.*', '*.pem', '*.key', '*.cert',
  'credentials.json', 'secrets.yaml', 'secrets.yml',
  '*.secret', 'id_rsa', 'id_ed25519',
  '.aws/credentials', '.gcp/credentials.json',
  'serviceAccountKey.json', 'firebase-adminsdk*.json',
];
