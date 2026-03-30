import { pathExists, readJson } from 'fs-extra/esm';
import { join, basename } from 'path';
import { readdirSync, readFileSync, existsSync } from 'fs';

// ── Extension → language mapping for distribution estimation ──────────

const EXT_TO_LANGUAGE = {
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java', '.kt': 'Kotlin', '.kts': 'Kotlin',
  '.cs': 'C#',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.swift': 'Swift',
  '.dart': 'Dart',
  '.html': 'HTML', '.cshtml': 'C#', '.razor': 'C#',
  '.css': 'CSS', '.scss': 'CSS', '.less': 'CSS',
  '.vue': 'JavaScript', '.svelte': 'JavaScript',
  '.c': 'C', '.h': 'C',
  '.cpp': 'C++', '.cc': 'C++', '.cxx': 'C++', '.hpp': 'C++',
  '.sql': 'SQL',
  '.tf': 'HCL', '.hcl': 'HCL',
};

// ── Database detection helpers ────────────────────────────────────────

/**
 * Detect databases from a dependency list using a package-to-database mapping.
 * Returns deduplicated array of canonical database IDs.
 */
function detectDatabases(deps, mapping) {
  const databases = [];
  for (const [pkg, dbId] of Object.entries(mapping)) {
    if (deps.some((d) => d === pkg || d.startsWith(pkg + '/'))) {
      if (!databases.includes(dbId)) databases.push(dbId);
    }
  }
  return databases;
}

/**
 * Detect databases from raw file content using substring matching.
 * Returns deduplicated array of canonical database IDs.
 */
function detectDatabasesFromContent(content, mapping) {
  const databases = [];
  for (const [pattern, dbId] of Object.entries(mapping)) {
    if (content.includes(pattern) && !databases.includes(dbId)) {
      databases.push(dbId);
    }
  }
  return databases;
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', 'vendor',
  '__pycache__', '.venv', 'venv', 'target', 'bin', 'obj', '.nuget',
  'coverage', '.cache', 'tmp', '.turbo', '.output',
  'templates', 'fixtures', 'testdata', 'test-fixtures',
]);

/**
 * Recursively find files matching a given extension, up to maxDepth levels.
 * Returns array of absolute paths.
 */
function findFilesRecursive(dir, ext, maxDepth, _depth = 0) {
  if (_depth > maxDepth) return [];
  const results = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(ext)) {
      results.push(join(dir, entry.name));
    } else if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
      results.push(...findFilesRecursive(join(dir, entry.name), ext, maxDepth, _depth + 1));
    }
  }
  return results;
}

/**
 * Estimate language distribution by counting source files per extension.
 * Returns { "C#": 72, "JavaScript": 18, ... } or null if no source files found.
 */
function estimateLanguageDistribution(dir) {
  const counts = {};

  function walkSync(currentDir, depth) {
    if (depth > 6) return;
    let entries;
    try { entries = readdirSync(currentDir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          walkSync(join(currentDir, entry.name), depth + 1);
        }
      } else if (entry.isFile()) {
        const dotIdx = entry.name.lastIndexOf('.');
        if (dotIdx === -1) continue;
        const ext = entry.name.slice(dotIdx);
        const lang = EXT_TO_LANGUAGE[ext];
        if (lang) {
          counts[lang] = (counts[lang] || 0) + 1;
        }
      }
    }
  }

  walkSync(dir, 0);

  const total = Object.values(counts).reduce((s, c) => s + c, 0);
  if (total === 0) return null;

  const distribution = {};
  for (const [lang, count] of Object.entries(counts)) {
    const pct = Math.round((count / total) * 100);
    if (pct >= 2) {
      distribution[lang] = pct;
    }
  }

  return Object.keys(distribution).length > 0 ? distribution : null;
}

// ── Language / framework detectors ────────────────────────────────────

const DETECTORS = [
  {
    file: 'package.json',
    detect: async (dir) => {
      const pkg = await readJson(join(dir, 'package.json')).catch(() => null);
      if (!pkg) return null;
      const result = { languages: [], frameworks: [], packageManager: 'npm' };

      if (
        pkg.devDependencies?.typescript ||
        pkg.dependencies?.typescript ||
        (await pathExists(join(dir, 'tsconfig.json')))
      ) {
        result.languages.push('TypeScript');
      } else {
        result.languages.push('JavaScript');
      }

      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      result._allDependencies = Object.keys(allDeps);

      if (allDeps.next) result.frameworks.push('Next.js');
      if (allDeps.react && !allDeps.next) result.frameworks.push('React');
      if (allDeps.vue) result.frameworks.push('Vue');
      if (allDeps['@angular/core']) result.frameworks.push('Angular');
      if (allDeps.express) result.frameworks.push('Express');
      if (allDeps.fastify) result.frameworks.push('Fastify');
      if (allDeps.tailwindcss) result.frameworks.push('Tailwind CSS');

      // Expanded framework detection
      if (allDeps.svelte || allDeps['@sveltejs/kit']) result.frameworks.push('SvelteKit');
      if (allDeps.nuxt) result.frameworks.push('Nuxt');
      if (allDeps.astro) result.frameworks.push('Astro');
      if (allDeps.gatsby) result.frameworks.push('Gatsby');
      if (allDeps['@nestjs/core']) result.frameworks.push('NestJS');
      if (allDeps['@remix-run/react']) result.frameworks.push('Remix');
      if (allDeps['socket.io'] || allDeps.ws) result.frameworks.push('Socket.io');
      if (allDeps.electron) result.frameworks.push('Electron');
      if (allDeps['react-native']) result.frameworks.push('React Native');
      if (allDeps.expo) result.frameworks.push('Expo');
      if (allDeps['@tauri-apps/api']) result.frameworks.push('Tauri');
      if (allDeps.hardhat) result.frameworks.push('Hardhat');
      if (allDeps.ethers || allDeps.viem || allDeps.web3) result.frameworks.push('Web3');
      if (allDeps['@apollo/server'] || allDeps['graphql-yoga'] || allDeps['type-graphql']) result.frameworks.push('GraphQL');
      if (allDeps.langchain || allDeps['@langchain/core']) result.frameworks.push('LangChain');
      if (allDeps.openai) result.frameworks.push('OpenAI SDK');
      if (allDeps.phaser) result.frameworks.push('Phaser');
      if (allDeps.three) result.frameworks.push('Three.js');
      if (allDeps.prisma || allDeps['@prisma/client']) result.frameworks.push('Prisma');
      if (allDeps['drizzle-orm']) result.frameworks.push('Drizzle');
      if (allDeps['single-spa']) result.frameworks.push('Single-SPA');
      if (allDeps.commander || allDeps.yargs) result.frameworks.push('CLI Framework');
      if (allDeps['@playwright/test'] || allDeps.playwright) result.frameworks.push('Playwright');
      if (allDeps['discord.js']) result.frameworks.push('Discord.js');
      if (allDeps.ai) result.frameworks.push('Vercel AI SDK');
      if (allDeps['@docusaurus/core']) result.frameworks.push('Docusaurus');
      if (allDeps['@babylonjs/core'] || allDeps.babylonjs) result.frameworks.push('Babylon.js');

      // CMS / E-commerce
      if (allDeps['@wordpress/scripts'] || allDeps['@wordpress/blocks'] || allDeps['@wordpress/element']) result.frameworks.push('WordPress');
      if (allDeps['@shopify/hydrogen']) result.frameworks.push('Shopify');
      if (allDeps['@shopify/polaris'] || allDeps['@shopify/cli'] || allDeps['@shopify/theme']) result.frameworks.push('Shopify');

      // Database detection from npm dependencies
      const dbMap = {
        pg: 'postgresql', postgres: 'postgresql', '@types/pg': 'postgresql',
        mysql2: 'mysql', mysql: 'mysql',
        mongodb: 'mongodb', mongoose: 'mongodb',
        mssql: 'sql-server', tedious: 'sql-server',
        'better-sqlite3': 'sqlite', 'sql.js': 'sqlite',
        redis: 'redis', ioredis: 'redis', '@upstash/redis': 'redis',
        '@aws-sdk/client-dynamodb': 'dynamodb',
        'neo4j-driver': 'neo4j',
        '@elastic/elasticsearch': 'elasticsearch',
      };
      result.databases = detectDatabases(Object.keys(allDeps), dbMap);

      if (await pathExists(join(dir, 'pnpm-lock.yaml'))) result.packageManager = 'pnpm';
      else if (await pathExists(join(dir, 'yarn.lock'))) result.packageManager = 'yarn';
      else if (await pathExists(join(dir, 'bun.lockb'))) result.packageManager = 'bun';

      return { name: pkg.name, description: pkg.description, ...result };
    },
  },
  {
    file: 'go.mod',
    detect: async (dir) => {
      const frameworks = [];
      const _allDependencies = [];
      try {
        const content = readFileSync(join(dir, 'go.mod'), 'utf8');
        // Extract module paths from require blocks
        const reqMatches = content.matchAll(/^\s+([\w./-]+)\s/gm);
        for (const m of reqMatches) _allDependencies.push(m[1]);
        if (content.includes('github.com/gin-gonic/gin')) frameworks.push('Gin');
        if (content.includes('github.com/labstack/echo')) frameworks.push('Echo');
        if (content.includes('github.com/spf13/cobra')) frameworks.push('Cobra');
        if (content.includes('github.com/gorilla/websocket')) frameworks.push('WebSocket');
        if (content.includes('github.com/gofiber/fiber')) frameworks.push('Fiber');
      } catch {}
      // Database detection from Go modules
      const databases = detectDatabasesFromContent(content, {
        'github.com/lib/pq': 'postgresql', 'github.com/jackc/pgx': 'postgresql',
        'go.mongodb.org/mongo-driver': 'mongodb',
        'github.com/go-sql-driver/mysql': 'mysql',
        'github.com/microsoft/go-mssqldb': 'sql-server', 'github.com/denisenkom/go-mssqldb': 'sql-server',
        'github.com/mattn/go-sqlite3': 'sqlite', 'modernc.org/sqlite': 'sqlite',
        'github.com/redis/go-redis': 'redis', 'github.com/go-redis/redis': 'redis',
      });
      return { languages: ['Go'], frameworks, _allDependencies, databases };
    },
  },
  {
    file: 'Cargo.toml',
    detect: async (dir) => {
      const frameworks = [];
      const _allDependencies = [];
      try {
        const content = readFileSync(join(dir, 'Cargo.toml'), 'utf8');
        // Extract crate names from [dependencies] section
        const depMatches = content.matchAll(/^([\w-]+)\s*=/gm);
        for (const m of depMatches) _allDependencies.push(m[1]);
        if (content.includes('actix')) frameworks.push('Actix');
        if (content.includes('tokio')) frameworks.push('Tokio');
        if (content.includes('axum')) frameworks.push('Axum');
        if (content.includes('warp')) frameworks.push('Warp');
        if (content.includes('clap')) frameworks.push('Clap');
        if (content.includes('tauri')) frameworks.push('Tauri');
      } catch {}
      // Database detection from Rust crates
      const databases = detectDatabases(_allDependencies, {
        'tokio-postgres': 'postgresql', sqlx: 'postgresql',
        mongodb: 'mongodb',
        redis: 'redis',
        rusqlite: 'sqlite',
        diesel: 'postgresql',
      });
      return { languages: ['Rust'], frameworks, _allDependencies, databases };
    },
  },
  {
    file: 'pyproject.toml',
    detect: async (dir) => {
      const frameworks = [];
      const _allDependencies = [];
      try {
        const content = readFileSync(join(dir, 'pyproject.toml'), 'utf8');
        // Extract dependency names from dependencies array
        const depMatches = content.matchAll(/["']([\w-]+)(?:[><=!~\s]|$)/gm);
        for (const m of depMatches) _allDependencies.push(m[1].toLowerCase());
        if (content.includes('django')) frameworks.push('Django');
        if (content.includes('flask')) frameworks.push('Flask');
        if (content.includes('fastapi')) frameworks.push('FastAPI');
        if (/\btorch\b/.test(content) || content.includes('pytorch')) frameworks.push('PyTorch');
        if (content.includes('tensorflow')) frameworks.push('TensorFlow');
        if (content.includes('scikit-learn') || content.includes('sklearn')) frameworks.push('scikit-learn');
        if (content.includes('langchain')) frameworks.push('LangChain');
        if (content.includes('streamlit')) frameworks.push('Streamlit');
        if (content.includes('airflow')) frameworks.push('Airflow');
        if (content.includes('pandas')) frameworks.push('Pandas');
        if (content.includes('pydantic')) frameworks.push('Pydantic');
        if (content.includes('scrapy')) frameworks.push('Scrapy');
        if (content.includes('click') || content.includes('typer')) frameworks.push('CLI Framework');
        if (content.includes('huggingface-hub') || content.includes('transformers')) frameworks.push('Hugging Face');
        if (content.includes('dbt-core')) frameworks.push('dbt');
        if (content.includes('llama-index') || content.includes('llama_index')) frameworks.push('LlamaIndex');
        if (/["']dash["']/.test(content)) frameworks.push('Dash');
        if (content.includes('graphene')) frameworks.push('Graphene');
      } catch {}
      // Database detection from Python dependencies
      const databases = detectDatabases(_allDependencies, {
        psycopg2: 'postgresql', 'psycopg2-binary': 'postgresql', psycopg: 'postgresql', asyncpg: 'postgresql',
        pymongo: 'mongodb', motor: 'mongodb',
        'mysql-connector-python': 'mysql', mysqlclient: 'mysql', pymysql: 'mysql',
        pyodbc: 'sql-server', pymssql: 'sql-server',
        redis: 'redis', aioredis: 'redis',
      });
      return { languages: ['Python'], frameworks, _allDependencies, databases };
    },
  },
  {
    file: 'requirements.txt',
    detect: async (dir) => {
      const frameworks = [];
      const _allDependencies = [];
      try {
        const content = readFileSync(join(dir, 'requirements.txt'), 'utf8');
        const lines = content.split('\n');
        for (const line of lines) {
          const name = line.trim().split(/[><=!~\s\[;#]/)[0];
          if (name) _allDependencies.push(name.toLowerCase());
        }
        const lc = content.toLowerCase();
        if (lc.includes('django')) frameworks.push('Django');
        if (lc.includes('flask')) frameworks.push('Flask');
        if (lc.includes('fastapi')) frameworks.push('FastAPI');
        if (/\btorch\b/.test(lc) || lc.includes('pytorch')) frameworks.push('PyTorch');
        if (lc.includes('tensorflow')) frameworks.push('TensorFlow');
        if (lc.includes('scikit-learn') || lc.includes('sklearn')) frameworks.push('scikit-learn');
        if (lc.includes('langchain')) frameworks.push('LangChain');
        if (lc.includes('streamlit')) frameworks.push('Streamlit');
        if (lc.includes('airflow')) frameworks.push('Airflow');
        if (lc.includes('pandas')) frameworks.push('Pandas');
        if (lc.includes('pydantic')) frameworks.push('Pydantic');
        if (lc.includes('scrapy')) frameworks.push('Scrapy');
        if (lc.includes('click') || lc.includes('typer')) frameworks.push('CLI Framework');
        if (lc.includes('huggingface-hub') || lc.includes('transformers')) frameworks.push('Hugging Face');
        if (lc.includes('dbt-core')) frameworks.push('dbt');
        if (lc.includes('llama-index') || lc.includes('llama_index')) frameworks.push('LlamaIndex');
        if (_allDependencies.includes('dash')) frameworks.push('Dash');
        if (lc.includes('graphene')) frameworks.push('Graphene');
      } catch {}
      // Database detection from Python dependencies
      const databases = detectDatabases(_allDependencies, {
        psycopg2: 'postgresql', 'psycopg2-binary': 'postgresql', psycopg: 'postgresql', asyncpg: 'postgresql',
        pymongo: 'mongodb', motor: 'mongodb',
        'mysql-connector-python': 'mysql', mysqlclient: 'mysql', pymysql: 'mysql',
        pyodbc: 'sql-server', pymssql: 'sql-server',
        redis: 'redis', aioredis: 'redis',
      });
      return { languages: ['Python'], frameworks, _allDependencies, databases };
    },
  },
  {
    file: 'pom.xml',
    detect: async (dir) => {
      const frameworks = ['Spring Boot'];
      const databases = [];
      try {
        const content = readFileSync(join(dir, 'pom.xml'), 'utf8');
        const dbMap = {
          'org.postgresql': 'postgresql', postgresql: 'postgresql',
          'com.mysql': 'mysql', 'mysql-connector': 'mysql',
          'com.microsoft.sqlserver': 'sql-server', 'mssql-jdbc': 'sql-server',
          'mongodb-driver': 'mongodb', 'spring-boot-starter-data-mongodb': 'mongodb',
          'spring-boot-starter-data-redis': 'redis', 'jedis': 'redis',
          'com.h2database': 'sqlite',
        };
        for (const [pattern, dbId] of Object.entries(dbMap)) {
          if (content.includes(pattern) && !databases.includes(dbId)) databases.push(dbId);
        }
      } catch {}
      return { languages: ['Java'], frameworks, databases };
    },
  },
  {
    file: 'build.gradle',
    detect: async (dir) => {
      const languages = ['Java'];
      const frameworks = [];
      const databases = [];
      try {
        const content = readFileSync(join(dir, 'build.gradle'), 'utf8');
        if (content.includes('kotlin')) languages.push('Kotlin');
        if (content.includes('spring')) frameworks.push('Spring Boot');
        if (content.includes('compose')) frameworks.push('Jetpack Compose');
        // Database detection
        for (const [pattern, dbId] of Object.entries({
          'org.postgresql': 'postgresql', postgresql: 'postgresql',
          'com.mysql': 'mysql', 'mysql-connector': 'mysql',
          'com.microsoft.sqlserver': 'sql-server', 'mssql-jdbc': 'sql-server',
          'mongodb-driver': 'mongodb', 'spring-boot-starter-data-mongodb': 'mongodb',
          'spring-boot-starter-data-redis': 'redis', jedis: 'redis',
          'com.h2database': 'sqlite',
        })) {
          if (content.includes(pattern) && !databases.includes(dbId)) databases.push(dbId);
        }
      } catch {}
      return { languages, frameworks, databases };
    },
  },
  {
    file: 'build.gradle.kts',
    detect: async (dir) => {
      const frameworks = [];
      const databases = [];
      try {
        const content = readFileSync(join(dir, 'build.gradle.kts'), 'utf8');
        if (content.includes('spring')) frameworks.push('Spring Boot');
        if (content.includes('compose')) frameworks.push('Jetpack Compose');
        // Database detection
        for (const [pattern, dbId] of Object.entries({
          'org.postgresql': 'postgresql', postgresql: 'postgresql',
          'com.mysql': 'mysql', 'mysql-connector': 'mysql',
          'com.microsoft.sqlserver': 'sql-server', 'mssql-jdbc': 'sql-server',
          'mongodb-driver': 'mongodb', 'spring-boot-starter-data-mongodb': 'mongodb',
          'spring-boot-starter-data-redis': 'redis', jedis: 'redis',
          'com.h2database': 'sqlite',
        })) {
          if (content.includes(pattern) && !databases.includes(dbId)) databases.push(dbId);
        }
      } catch {}
      return { languages: ['Kotlin', 'Java'], frameworks, databases };
    },
  },
  {
    file: '*.csproj',
    detect: async (dir) => {
      const result = { languages: ['C#'], frameworks: [], databases: [] };
      try {
        const csprojFiles = findFilesRecursive(dir, '.csproj', 3);
        // Read ALL .csproj files (not just the first) to catch database packages in any project
        for (const csprojPath of csprojFiles) {
          try {
            const content = readFileSync(csprojPath, 'utf8');
            if (content.includes('Microsoft.AspNetCore') || content.includes('Microsoft.NET.Sdk.Web')) {
              if (!result.frameworks.includes('ASP.NET Core')) result.frameworks.push('ASP.NET Core');
            }
            if ((content.includes('Maui') || content.includes('Microsoft.Maui')) && !result.frameworks.includes('.NET MAUI')) {
              result.frameworks.push('.NET MAUI');
            }
            if (content.includes('HotChocolate') && !result.frameworks.includes('HotChocolate')) result.frameworks.push('HotChocolate');
            if (content.includes('SignalR') && !result.frameworks.includes('SignalR')) result.frameworks.push('SignalR');

            // Database detection from NuGet PackageReference elements
            const dbDetected = detectDatabasesFromContent(content, {
              'EntityFrameworkCore.SqlServer': 'sql-server',
              'Microsoft.Data.SqlClient': 'sql-server',
              'System.Data.SqlClient': 'sql-server',
              'Npgsql': 'postgresql',
              'EntityFrameworkCore.PostgreSQL': 'postgresql',
              'Pomelo.EntityFrameworkCore.MySql': 'mysql',
              'MySql.Data': 'mysql',
              'MySqlConnector': 'mysql',
              'EntityFrameworkCore.Sqlite': 'sqlite',
              'Microsoft.Data.Sqlite': 'sqlite',
              'MongoDB.Driver': 'mongodb',
              'StackExchange.Redis': 'redis',
              'Microsoft.Extensions.Caching.StackExchangeRedis': 'redis',
              'EntityFrameworkCore.Cosmos': 'cosmosdb',
              'Microsoft.Azure.Cosmos': 'cosmosdb',
            });
            for (const db of dbDetected) {
              if (!result.databases.includes(db)) result.databases.push(db);
            }

            // Detect Entity Framework Core ORM
            if (content.includes('Microsoft.EntityFrameworkCore') && !result.frameworks.includes('Entity Framework Core')) {
              result.frameworks.push('Entity Framework Core');
            }
          } catch {}
        }
        // Detect Razor / Blazor by scanning for .cshtml / .razor files
        try {
          const allFiles = readdirSync(dir, { recursive: true }).map(String);
          if (allFiles.some((f) => f.endsWith('.cshtml'))) {
            if (!result.frameworks.includes('ASP.NET Core')) result.frameworks.push('ASP.NET Core');
            if (!result.frameworks.includes('Razor')) result.frameworks.push('Razor');
          }
          if (allFiles.some((f) => f.endsWith('.razor'))) {
            if (!result.frameworks.includes('Blazor')) result.frameworks.push('Blazor');
          }
        } catch {}
      } catch {}
      return result;
    },
    checkExists: async (dir) => {
      try { return findFilesRecursive(dir, '.csproj', 3).length > 0; } catch { return false; }
    },
  },
  {
    file: '*.sln',
    detect: async (dir) => {
      const result = { languages: ['C#'], frameworks: [], databases: [] };
      try {
        const csprojFiles = findFilesRecursive(dir, '.csproj', 3);
        for (const csprojPath of csprojFiles) {
          try {
            const content = readFileSync(csprojPath, 'utf8');
            if (content.includes('Microsoft.AspNetCore') || content.includes('Microsoft.NET.Sdk.Web')) {
              if (!result.frameworks.includes('ASP.NET Core')) result.frameworks.push('ASP.NET Core');
            }
            if ((content.includes('Maui') || content.includes('Microsoft.Maui')) && !result.frameworks.includes('.NET MAUI')) {
              result.frameworks.push('.NET MAUI');
            }

            // Database detection from NuGet PackageReference elements
            const dbDetected = detectDatabasesFromContent(content, {
              'EntityFrameworkCore.SqlServer': 'sql-server',
              'Microsoft.Data.SqlClient': 'sql-server',
              'System.Data.SqlClient': 'sql-server',
              'Npgsql': 'postgresql',
              'EntityFrameworkCore.PostgreSQL': 'postgresql',
              'Pomelo.EntityFrameworkCore.MySql': 'mysql',
              'MySql.Data': 'mysql',
              'MySqlConnector': 'mysql',
              'EntityFrameworkCore.Sqlite': 'sqlite',
              'Microsoft.Data.Sqlite': 'sqlite',
              'MongoDB.Driver': 'mongodb',
              'StackExchange.Redis': 'redis',
              'Microsoft.Extensions.Caching.StackExchangeRedis': 'redis',
              'EntityFrameworkCore.Cosmos': 'cosmosdb',
              'Microsoft.Azure.Cosmos': 'cosmosdb',
            });
            for (const db of dbDetected) {
              if (!result.databases.includes(db)) result.databases.push(db);
            }

            // Detect Entity Framework Core ORM
            if (content.includes('Microsoft.EntityFrameworkCore') && !result.frameworks.includes('Entity Framework Core')) {
              result.frameworks.push('Entity Framework Core');
            }
          } catch {}
        }
        // Detect Razor / Blazor by scanning for .cshtml / .razor files
        try {
          const allFiles = readdirSync(dir, { recursive: true }).map(String);
          if (allFiles.some((f) => f.endsWith('.cshtml'))) {
            if (!result.frameworks.includes('ASP.NET Core')) result.frameworks.push('ASP.NET Core');
            if (!result.frameworks.includes('Razor')) result.frameworks.push('Razor');
          }
          if (allFiles.some((f) => f.endsWith('.razor'))) {
            if (!result.frameworks.includes('Blazor')) result.frameworks.push('Blazor');
          }
        } catch {}
      } catch {}
      return result;
    },
    checkExists: async (dir) => {
      try { return readdirSync(dir).some((f) => f.endsWith('.sln')); } catch { return false; }
    },
  },
  {
    file: 'Gemfile',
    detect: async (dir) => {
      const frameworks = [];
      const databases = [];
      try {
        const content = readFileSync(join(dir, 'Gemfile'), 'utf8');
        if (content.includes('rails')) frameworks.push('Rails');
        // Database detection from Gemfile
        const dbMap = {
          "'pg'": 'postgresql', '"pg"': 'postgresql',
          "'mysql2'": 'mysql', '"mysql2"': 'mysql',
          "'sqlite3'": 'sqlite', '"sqlite3"': 'sqlite',
          "'mongoid'": 'mongodb', '"mongoid"': 'mongodb', "'mongo'": 'mongodb', '"mongo"': 'mongodb',
          "'redis'": 'redis', '"redis"': 'redis',
        };
        for (const [pattern, dbId] of Object.entries(dbMap)) {
          if (content.includes(pattern) && !databases.includes(dbId)) databases.push(dbId);
        }
      } catch {}
      return { languages: ['Ruby'], frameworks, databases };
    },
  },
  {
    file: 'composer.json',
    detect: async (dir) => {
      const frameworks = [];
      const databases = [];
      try {
        const pkg = await readJson(join(dir, 'composer.json')).catch(() => null);
        if (pkg) {
          const allDeps = { ...pkg.require, ...pkg['require-dev'] };
          if (allDeps['laravel/framework']) frameworks.push('Laravel');
          if (pkg.type === 'wordpress-plugin' || pkg.type === 'wordpress-theme') frameworks.push('WordPress');
          if (allDeps['wpackagist-plugin/woocommerce'] || allDeps['johnpbloch/wordpress-core'] || allDeps['roots/wordpress']) frameworks.push('WordPress');
          // Database detection
          const dbMap = {
            'predis/predis': 'redis', 'phpredis/phpredis': 'redis',
            'mongodb/mongodb': 'mongodb',
            'ext-pgsql': 'postgresql',
            'ext-mysqli': 'mysql',
            'ext-mongodb': 'mongodb',
            'ext-redis': 'redis',
            'ext-sqlite3': 'sqlite',
          };
          for (const [pkg, dbId] of Object.entries(dbMap)) {
            if (allDeps[pkg] && !databases.includes(dbId)) databases.push(dbId);
          }
        }
      } catch {}
      return { languages: ['PHP'], frameworks, databases };
    },
  },
  // ── New detectors ─────────────────────────────────────────────────────
  {
    file: 'pubspec.yaml',
    detect: async (dir) => {
      const frameworks = [];
      try {
        const content = readFileSync(join(dir, 'pubspec.yaml'), 'utf8');
        if (content.includes('flutter')) frameworks.push('Flutter');
      } catch {}
      return { languages: ['Dart'], frameworks };
    },
  },
  {
    file: 'foundry.toml',
    detect: async () => ({ languages: ['Solidity'], frameworks: ['Foundry'] }),
  },
  {
    file: 'hardhat.config.js',
    detect: async () => ({ languages: ['Solidity'], frameworks: ['Hardhat'] }),
    checkExists: async (dir) => {
      try {
        return readdirSync(dir).some((f) => f.startsWith('hardhat.config'));
      } catch { return false; }
    },
  },
  {
    file: 'serverless.yml',
    detect: async () => ({ languages: [], frameworks: ['Serverless Framework'] }),
    checkExists: async (dir) => {
      try {
        return readdirSync(dir).some((f) => f.startsWith('serverless.'));
      } catch { return false; }
    },
  },
  {
    file: 'ProjectSettings/ProjectVersion.txt',
    detect: async () => ({ languages: ['C#'], frameworks: ['Unity'] }),
  },
  {
    file: 'manifest.json',
    detect: async (dir) => {
      try {
        const manifest = await readJson(join(dir, 'manifest.json')).catch(() => null);
        if (manifest && (manifest.content_scripts || manifest.browser_action || manifest.action)) {
          return { languages: [], frameworks: ['Browser Extension'] };
        }
      } catch {}
      return null;
    },
  },
  {
    file: '*.tf',
    detect: async () => ({ languages: ['HCL'], frameworks: ['Terraform'] }),
    checkExists: async (dir) => {
      try { return readdirSync(dir).some((f) => f.endsWith('.tf')); } catch { return false; }
    },
  },
  {
    file: 'hugo.toml',
    detect: async (dir) => {
      return { languages: ['Go'], frameworks: ['Hugo'] };
    },
    checkExists: async (dir) => {
      try {
        if (existsSync(join(dir, 'hugo.toml'))) return true;
        if (existsSync(join(dir, 'hugo.yaml'))) return true;
        if (existsSync(join(dir, 'hugo.json'))) return true;
        // config.toml with Hugo markers
        if (existsSync(join(dir, 'config.toml'))) {
          const content = readFileSync(join(dir, 'config.toml'), 'utf8');
          if (content.includes('baseURL') && (content.includes('theme') || existsSync(join(dir, 'themes')))) return true;
        }
        return false;
      } catch { return false; }
    },
  },
  {
    file: '_config.yml',
    detect: async (dir) => {
      try {
        // Verify it's Jekyll: check Gemfile for jekyll or config for Jekyll-specific keys
        let isJekyll = false;
        if (existsSync(join(dir, 'Gemfile'))) {
          const gemfile = readFileSync(join(dir, 'Gemfile'), 'utf8');
          if (gemfile.includes('jekyll')) isJekyll = true;
        }
        if (!isJekyll) {
          const config = readFileSync(join(dir, '_config.yml'), 'utf8');
          if (config.includes('permalink') || config.includes('collections') || config.includes('kramdown')) isJekyll = true;
        }
        if (isJekyll) return { languages: ['Ruby'], frameworks: ['Jekyll'] };
      } catch {}
      return null;
    },
  },
  {
    file: 'dbt_project.yml',
    detect: async () => ({ languages: ['SQL'], frameworks: ['dbt'] }),
  },
  {
    file: 'project.godot',
    detect: async () => ({ languages: ['GDScript'], frameworks: ['Godot'] }),
  },
  // ── WordPress detectors ──────────────────────────────────────────────
  {
    file: 'style.css',
    detect: async (dir) => {
      try {
        const content = readFileSync(join(dir, 'style.css'), 'utf8');
        // WordPress theme: style.css has "Theme Name:" in a comment header
        if (/Theme Name\s*:/i.test(content.slice(0, 2000))) {
          return { languages: ['PHP'], frameworks: ['WordPress'] };
        }
      } catch {}
      return null;
    },
  },
  {
    file: 'functions.php',
    detect: async (dir) => {
      try {
        const content = readFileSync(join(dir, 'functions.php'), 'utf8');
        // Must contain WordPress-specific hooks to avoid generic PHP match
        if ((content.includes('add_action') && content.includes('wp_enqueue')) || content.includes('add_theme_support')) {
          return { languages: ['PHP'], frameworks: ['WordPress'] };
        }
      } catch {}
      return null;
    },
  },
  {
    file: 'theme.json',
    detect: async (dir) => {
      try {
        const content = readFileSync(join(dir, 'theme.json'), 'utf8');
        if (content.includes('schemas.wp.org') || (content.includes('"version"') && content.includes('"settings"') && content.includes('"styles"'))) {
          return { languages: ['PHP'], frameworks: ['WordPress'] };
        }
      } catch {}
      return null;
    },
  },
  // ── C / C++ detectors ────────────────────────────────────────────────
  {
    file: 'CMakeLists.txt',
    detect: async (dir) => {
      const languages = [];
      const frameworks = ['CMake'];
      try {
        const content = readFileSync(join(dir, 'CMakeLists.txt'), 'utf8');
        // Detect C++ vs C
        if (/CXX|CMAKE_CXX_STANDARD|\.cpp|\.cc|\.cxx/i.test(content)) {
          languages.push('C++');
          // Also add C if explicitly listed
          if (/\bC\b/.test(content.match(/project\s*\([^)]*LANGUAGES\s+([^)]*)\)/i)?.[1] || '')) {
            languages.push('C');
          }
        } else {
          languages.push('C');
        }
        // Detect frameworks from find_package / FetchContent_Declare
        const pkgMatches = content.matchAll(/(?:find_package|FetchContent_Declare)\s*\(\s*(\w+)/gi);
        const pkgNames = [...pkgMatches].map((m) => m[1].toLowerCase());
        // Also check add_subdirectory for vendored deps
        const subdirMatches = content.matchAll(/add_subdirectory\s*\(\s*(?:[\w/]*\/)?(\w+)/gi);
        for (const m of subdirMatches) pkgNames.push(m[1].toLowerCase());

        const fwMap = {
          qt5: 'Qt', qt6: 'Qt', qt: 'Qt',
          boost: 'Boost',
          sdl2: 'SDL', sdl: 'SDL',
          sfml: 'SFML',
          opencv: 'OpenCV',
          gtest: 'Google Test', googletest: 'Google Test',
          catch2: 'Catch2',
          grpc: 'gRPC', protobuf: 'gRPC',
          gtk: 'GTK', 'gtk+': 'GTK', gtkmm: 'GTK',
          wxwidgets: 'wxWidgets',
          imgui: 'Dear ImGui',
          drogon: 'Drogon',
          crow: 'Crow',
          freertos: 'FreeRTOS',
          zephyr: 'Zephyr',
        };
        for (const pkg of pkgNames) {
          const fw = fwMap[pkg];
          if (fw && !frameworks.includes(fw)) frameworks.push(fw);
        }
      } catch {}
      return { languages, frameworks };
    },
  },
  {
    file: 'meson.build',
    detect: async (dir) => {
      const languages = [];
      const frameworks = ['Meson'];
      try {
        const content = readFileSync(join(dir, 'meson.build'), 'utf8');
        // project('name', 'cpp') or project('name', 'c', 'cpp')
        const projMatch = content.match(/project\s*\([^)]*$/m) ? null : content.match(/project\s*\(([^)]*)\)/);
        const projArgs = projMatch ? projMatch[1] : '';
        if (/['"]cpp['"]/.test(projArgs)) languages.push('C++');
        if (/['"]c['"]/.test(projArgs)) languages.push('C');
        if (languages.length === 0) languages.push('C');

        // Parse dependency() calls
        const depMatches = content.matchAll(/dependency\s*\(\s*'([^']+)'/g);
        const depMap = {
          'qt5': 'Qt', 'qt6': 'Qt',
          'boost': 'Boost',
          'sdl2': 'SDL',
          'sfml': 'SFML',
          'opencv4': 'OpenCV', 'opencv': 'OpenCV',
          'gtest': 'Google Test', 'gtest_main': 'Google Test',
          'catch2': 'Catch2', 'catch2-with-main': 'Catch2',
          'grpc': 'gRPC', 'grpc++': 'gRPC',
          'gtk+-3.0': 'GTK', 'gtk4': 'GTK', 'gtkmm-3.0': 'GTK',
          'wxwidgets': 'wxWidgets',
          'drogon': 'Drogon',
          'freertos': 'FreeRTOS',
        };
        for (const m of depMatches) {
          const fw = depMap[m[1]];
          if (fw && !frameworks.includes(fw)) frameworks.push(fw);
        }
      } catch {}
      return { languages, frameworks };
    },
  },
  {
    file: 'conanfile.txt',
    detect: async (dir) => {
      const frameworks = [];
      const fwCheck = (lc) => {
        if (lc.includes('boost')) frameworks.push('Boost');
        if (/\bqt\b/.test(lc)) frameworks.push('Qt');
        if (lc.includes('sdl')) frameworks.push('SDL');
        if (lc.includes('sfml')) frameworks.push('SFML');
        if (lc.includes('opencv')) frameworks.push('OpenCV');
        if (lc.includes('gtest')) frameworks.push('Google Test');
        if (lc.includes('catch2')) frameworks.push('Catch2');
        if (lc.includes('grpc')) frameworks.push('gRPC');
        if (lc.includes('gtk')) frameworks.push('GTK');
        if (lc.includes('wxwidgets')) frameworks.push('wxWidgets');
        if (lc.includes('imgui')) frameworks.push('Dear ImGui');
        if (lc.includes('drogon')) frameworks.push('Drogon');
        if (lc.includes('crow')) frameworks.push('Crow');
        if (lc.includes('freertos')) frameworks.push('FreeRTOS');
      };
      try {
        if (existsSync(join(dir, 'conanfile.txt'))) {
          const content = readFileSync(join(dir, 'conanfile.txt'), 'utf8');
          const reqSection = content.match(/\[requires\]([\s\S]*?)(?:\[|$)/);
          if (reqSection) fwCheck(reqSection[1].toLowerCase());
        } else if (existsSync(join(dir, 'conanfile.py'))) {
          const content = readFileSync(join(dir, 'conanfile.py'), 'utf8');
          fwCheck(content.toLowerCase());
        }
      } catch {}
      return { languages: ['C++'], frameworks };
    },
    checkExists: async (dir) => {
      try {
        return existsSync(join(dir, 'conanfile.txt')) || existsSync(join(dir, 'conanfile.py'));
      } catch { return false; }
    },
  },
  {
    file: 'vcpkg.json',
    detect: async (dir) => {
      const frameworks = [];
      try {
        const pkg = JSON.parse(readFileSync(join(dir, 'vcpkg.json'), 'utf8'));
        const deps = (pkg.dependencies || []).map((d) =>
          (typeof d === 'string' ? d : d.name || '').toLowerCase()
        );
        const fwMap = {
          boost: 'Boost', qt: 'Qt', qt5: 'Qt', qt6: 'Qt',
          sdl2: 'SDL', sfml: 'SFML', opencv: 'OpenCV', opencv4: 'OpenCV',
          gtest: 'Google Test', catch2: 'Catch2',
          grpc: 'gRPC', gtk: 'GTK', gtkmm: 'GTK',
          wxwidgets: 'wxWidgets', imgui: 'Dear ImGui',
          drogon: 'Drogon', crow: 'Crow',
        };
        for (const dep of deps) {
          const fw = fwMap[dep];
          if (fw && !frameworks.includes(fw)) frameworks.push(fw);
        }
      } catch {}
      return { languages: ['C++'], frameworks };
    },
  },
  {
    file: 'platformio.ini',
    detect: async (dir) => {
      const frameworks = [];
      try {
        const content = readFileSync(join(dir, 'platformio.ini'), 'utf8');
        const fwMatch = content.match(/framework\s*=\s*(.*)/i);
        if (fwMatch) {
          const fwLine = fwMatch[1].toLowerCase();
          if (fwLine.includes('espidf')) frameworks.push('ESP-IDF');
          if (fwLine.includes('freertos')) frameworks.push('FreeRTOS');
          if (fwLine.includes('zephyr')) frameworks.push('Zephyr');
        }
      } catch {}
      return { languages: ['C++', 'C'], frameworks };
    },
  },
  {
    file: '*.uproject',
    detect: async () => ({ languages: ['C++'], frameworks: ['Unreal Engine'] }),
    checkExists: async (dir) => {
      try { return readdirSync(dir).some((f) => f.endsWith('.uproject')); } catch { return false; }
    },
  },
  {
    file: 'WORKSPACE',
    detect: async (dir) => {
      const languages = [];
      const frameworks = ['Bazel'];
      try {
        // Check both WORKSPACE and WORKSPACE.bazel
        let content = '';
        if (existsSync(join(dir, 'WORKSPACE'))) content = readFileSync(join(dir, 'WORKSPACE'), 'utf8');
        else if (existsSync(join(dir, 'WORKSPACE.bazel'))) content = readFileSync(join(dir, 'WORKSPACE.bazel'), 'utf8');
        if (content.includes('rules_cc') || content.includes('cc_library') || content.includes('cc_binary')) {
          languages.push('C++');
          languages.push('C');
        }
      } catch {}
      return { languages, frameworks };
    },
    checkExists: async (dir) => {
      try {
        return existsSync(join(dir, 'WORKSPACE')) || existsSync(join(dir, 'WORKSPACE.bazel'));
      } catch { return false; }
    },
  },
  // ── Shopify detectors ────────────────────────────────────────────────
  {
    file: 'shopify.app.toml',
    detect: async () => ({ languages: [], frameworks: ['Shopify'] }),
  },
  {
    file: 'config/settings_schema.json',
    detect: async (dir) => {
      try {
        const data = await readJson(join(dir, 'config', 'settings_schema.json')).catch(() => null);
        if (Array.isArray(data)) {
          return { languages: [], frameworks: ['Shopify'] };
        }
      } catch {}
      return null;
    },
    checkExists: async (dir) => existsSync(join(dir, 'config', 'settings_schema.json')),
  },
];

// ── Project type detection ────────────────────────────────────────────

async function detectProjectType(dir) {
  // Monorepo indicators
  const monorepoIndicators = [
    'lerna.json',
    'pnpm-workspace.yaml',
    'nx.json',
    'turbo.json',
    'rush.json',
  ];

  for (const indicator of monorepoIndicators) {
    if (await pathExists(join(dir, indicator))) return 'monorepo';
  }

  // Check package.json workspaces
  try {
    const pkg = await readJson(join(dir, 'package.json')).catch(() => null);
    if (pkg?.workspaces) return 'monorepo';
  } catch {}

  // Check for packages/ or apps/ directories with multiple sub-packages
  for (const subdir of ['packages', 'apps', 'services', 'modules']) {
    const subdirPath = join(dir, subdir);
    if (await pathExists(subdirPath)) {
      try {
        const entries = readdirSync(subdirPath, { withFileTypes: true });
        const subdirs = entries.filter((e) => e.isDirectory()).length;
        if (subdirs >= 2) return 'monorepo';
      } catch {}
    }
  }

  // Microservice indicators
  if (await pathExists(join(dir, 'docker-compose.yml')) || await pathExists(join(dir, 'docker-compose.yaml'))) {
    try {
      const content = readFileSync(
        await pathExists(join(dir, 'docker-compose.yml'))
          ? join(dir, 'docker-compose.yml')
          : join(dir, 'docker-compose.yaml'),
        'utf8'
      );
      const serviceCount = (content.match(/^\s{2}\w[\w-]*:/gm) || []).length;
      if (serviceCount >= 3) return 'microservice';
    } catch {}
  }

  // Library indicators
  try {
    const pkg = await readJson(join(dir, 'package.json')).catch(() => null);
    if (pkg) {
      if (pkg.main || pkg.module || pkg.exports) {
        if (!pkg.bin && !pkg.scripts?.start) return 'library';
      }
      if (pkg.bin) return 'cli';
    }
  } catch {}

  // Python library
  if (await pathExists(join(dir, 'setup.py')) || await pathExists(join(dir, 'setup.cfg'))) {
    return 'library';
  }

  return 'monolith';
}

// ── Code style detection ──────────────────────────────────────────────

async function detectCodeStyle(dir) {
  const styles = [];

  const checks = [
    { files: ['.prettierrc', '.prettierrc.json', '.prettierrc.js', '.prettierrc.cjs', 'prettier.config.js', 'prettier.config.cjs'], name: 'prettier' },
    { files: ['.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs', 'eslint.config.js', 'eslint.config.mjs'], name: 'eslint' },
    { files: ['.editorconfig'], name: 'editorconfig' },
    { files: ['.stylelintrc', '.stylelintrc.json', 'stylelint.config.js'], name: 'stylelint' },
    { files: ['.golangci.yml', '.golangci.yaml'], name: 'golangci-lint' },
    { files: ['.rubocop.yml'], name: 'rubocop' },
    { files: ['.php-cs-fixer.php', '.php-cs-fixer.dist.php'], name: 'php-cs-fixer' },
    { files: ['rustfmt.toml', '.rustfmt.toml'], name: 'rustfmt' },
    { files: ['checkstyle.xml'], name: 'checkstyle' },
    { files: ['.clang-format'], name: 'clang-format' },
    { files: ['.clang-tidy'], name: 'clang-tidy' },
  ];

  for (const { files, name } of checks) {
    for (const f of files) {
      if (await pathExists(join(dir, f))) {
        styles.push(name);
        break;
      }
    }
  }

  // Check pyproject.toml for Python tools
  if (await pathExists(join(dir, 'pyproject.toml'))) {
    try {
      const content = readFileSync(join(dir, 'pyproject.toml'), 'utf8');
      if (content.includes('[tool.ruff]') || content.includes('[tool.ruff.')) styles.push('ruff');
      if (content.includes('[tool.black]')) styles.push('black');
      if (content.includes('[tool.mypy]')) styles.push('mypy');
      if (content.includes('[tool.isort]')) styles.push('isort');
    } catch {}
  }

  return styles;
}

// ── Subproject detection (for monorepos) ──────────────────────────────

async function detectSubprojects(dir) {
  const subprojects = [];
  const scanDirs = ['packages', 'apps', 'services', 'modules', 'libs'];

  for (const scanDir of scanDirs) {
    const scanPath = join(dir, scanDir);
    if (!(await pathExists(scanPath))) continue;

    try {
      const entries = readdirSync(scanPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const subPath = join(scanPath, entry.name);
        const subInfo = { name: entry.name, path: `${scanDir}/${entry.name}`, languages: [], frameworks: [], databases: [] };

        // Run detectors on subproject
        for (const { file, detect, checkExists } of DETECTORS) {
          const exists = checkExists
            ? await checkExists(subPath)
            : await pathExists(join(subPath, file));
          if (exists) {
            const detected = await detect(subPath);
            if (detected) {
              for (const lang of detected.languages || []) {
                if (!subInfo.languages.includes(lang)) subInfo.languages.push(lang);
              }
              for (const fw of detected.frameworks || []) {
                if (!subInfo.frameworks.includes(fw)) subInfo.frameworks.push(fw);
              }
              for (const db of detected.databases || []) {
                if (!subInfo.databases.includes(db)) subInfo.databases.push(db);
              }
            }
          }
        }

        if (subInfo.languages.length > 0 || subInfo.frameworks.length > 0) {
          subprojects.push(subInfo);
        }
      }
    } catch {}
  }

  return subprojects;
}

// ── CI/CD detection ───────────────────────────────────────────────────

async function detectCICD(dir) {
  const ci = [];
  const checks = [
    { path: '.github/workflows', name: 'GitHub Actions' },
    { path: '.gitlab-ci.yml', name: 'GitLab CI' },
    { path: 'Jenkinsfile', name: 'Jenkins' },
    { path: '.circleci', name: 'CircleCI' },
    { path: '.travis.yml', name: 'Travis CI' },
    { path: 'azure-pipelines.yml', name: 'Azure Pipelines' },
    { path: 'bitbucket-pipelines.yml', name: 'Bitbucket Pipelines' },
    { path: '.drone.yml', name: 'Drone CI' },
  ];

  for (const { path, name } of checks) {
    if (await pathExists(join(dir, path))) ci.push(name);
  }

  return ci;
}

// ── Sensitive file detection ──────────────────────────────────────────

async function detectSensitiveFiles(dir) {
  const found = [];
  const patterns = [
    '.env', '.env.local', '.env.production', '.env.development',
    'credentials.json', 'secrets.yaml', 'secrets.yml',
    'serviceAccountKey.json',
  ];

  for (const p of patterns) {
    if (await pathExists(join(dir, p))) found.push(p);
  }

  // Check if .gitignore covers sensitive files
  let gitignoreCovers = false;
  try {
    const gitignore = readFileSync(join(dir, '.gitignore'), 'utf8');
    gitignoreCovers = gitignore.includes('.env') || gitignore.includes('*.env');
  } catch {}

  return { found, gitignoreCovers };
}

// ── Main detection entry point ────────────────────────────────────────

export async function detectProject(targetDir) {
  const result = {
    name: '',
    description: '',
    languages: [],
    frameworks: [],
    databases: [],
    _allDependencies: [],
    hasGit: false,
    packageManager: null,
    projectType: 'monolith',
    codeStyle: [],
    subprojects: [],
    cicd: [],
    sensitiveFiles: { found: [], gitignoreCovers: false },
    languageDistribution: null,
  };

  // Check git
  result.hasGit = await pathExists(join(targetDir, '.git'));

  // Run language/framework detectors
  for (const { file, detect, checkExists } of DETECTORS) {
    const exists = checkExists
      ? await checkExists(targetDir)
      : await pathExists(join(targetDir, file));
    if (exists) {
      const detected = await detect(targetDir);
      if (detected) {
        if (detected.name) result.name = detected.name;
        if (detected.description) result.description = detected.description;
        if (detected.packageManager) result.packageManager = detected.packageManager;
        for (const lang of detected.languages || []) {
          if (!result.languages.includes(lang)) result.languages.push(lang);
        }
        for (const fw of detected.frameworks || []) {
          if (!result.frameworks.includes(fw)) result.frameworks.push(fw);
        }
        for (const dep of detected._allDependencies || []) {
          if (!result._allDependencies.includes(dep)) result._allDependencies.push(dep);
        }
        for (const db of detected.databases || []) {
          if (!result.databases.includes(db)) result.databases.push(db);
        }
      }
    }
  }

  // Detect project type
  result.projectType = await detectProjectType(targetDir);

  // Detect code style tools
  result.codeStyle = await detectCodeStyle(targetDir);

  // Detect subprojects if monorepo
  if (result.projectType === 'monorepo') {
    result.subprojects = await detectSubprojects(targetDir);
    // Merge subproject languages/frameworks/databases into root
    for (const sub of result.subprojects) {
      for (const lang of sub.languages) {
        if (!result.languages.includes(lang)) result.languages.push(lang);
      }
      for (const fw of sub.frameworks) {
        if (!result.frameworks.includes(fw)) result.frameworks.push(fw);
      }
      for (const db of sub.databases || []) {
        if (!result.databases.includes(db)) result.databases.push(db);
      }
    }
  }

  // Detect CI/CD
  result.cicd = await detectCICD(targetDir);

  // Detect sensitive files
  result.sensitiveFiles = await detectSensitiveFiles(targetDir);

  // Collect root-level filenames for server-side stack pack file-pattern matching
  try {
    result._rootFiles = readdirSync(targetDir).filter((f) => {
      // Exclude hidden dirs like .git, node_modules
      if (f === 'node_modules' || f === '.git') return false;
      return true;
    });
  } catch {
    result._rootFiles = [];
  }

  // Estimate language distribution from file counts
  result.languageDistribution = estimateLanguageDistribution(targetDir);

  // Reconcile: add languages with >= 15% distribution missed by detectors
  if (result.languageDistribution) {
    for (const [lang, pct] of Object.entries(result.languageDistribution)) {
      if (pct >= 15 && !result.languages.includes(lang)) {
        result.languages.push(lang);
      }
    }
  }

  // Fallback name from directory
  if (!result.name) {
    result.name = targetDir.split(/[/\\]/).filter(Boolean).pop() || 'my-project';
  }

  return result;
}
