<div align="center">

# ccraft

**Intelligent Claude Code project configurator** — analyzes your codebase, scores your stack, and generates role-aware agents, skills, rules, MCPs, and workflows in seconds.

[![npm version](https://img.shields.io/npm/v/ccraft)](https://www.npmjs.com/package/ccraft)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)

[Getting Started](#getting-started) &bull; [How It Works](#how-it-works) &bull; [Commands](#commands) &bull; [Supported Stacks](#supported-stacks) &bull; [FAQ](#faq)

</div>

---

## The Problem

Setting up Claude Code for a real project takes hours. You need to write agents for your role, configure MCP servers for your tools, create rules for your stack, define skills for your workflows, and wire it all together in `.claude/`. Most developers either skip it entirely or copy a generic config that doesn't match their codebase.

**ccraft fixes this in one command.** A scoring engine analyzes your project — languages, frameworks, architecture, complexity — and your role as a developer, then selects and generates the exact Claude Code configuration your project needs.

## Getting Started

```bash
# 1. Install globally
npm install -g ccraft

# 2. Authenticate
ccraft auth YOUR_API_KEY

# 3. Configure your existing project
cd your-project
ccraft install
```

That's it. Your `.claude/` directory is now populated with agents, skills, rules, MCPs, and workflows — all scored and tailored to your stack and role.

### Starting a New Project?

```bash
ccraft install --name my-app --description "REST API for inventory management"
```

`ccraft install` auto-detects whether you're working with an existing project or starting fresh. If the target directory is empty or doesn't exist, it switches to new-project mode — scaffolds the directory, runs Claude Code's bootstrap, then generates the full `.claude/` configuration on top.

## How It Works

```
Your Codebase                    Scoring Engine                  .claude/ Output
┌──────────────┐    analyze     ┌──────────────────┐   render   ┌──────────────────┐
│ Languages    │───────────────>│ Score components  │──────────>│ agents/           │
│ Frameworks   │                │ Match role        │           │ skills/           │
│ Architecture │                │ Select MCPs       │           │ rules/            │
│ Complexity   │                │ Apply intents     │           │ commands/         │
│ CI/CD        │                │ Build config      │           │ workflows/        │
│ Dependencies │                └──────────────────┘           │ settings.json     │
└──────────────┘                        ▲                      │ CLAUDE.md         │
                                        │                      └──────────────────┘
                                  Your Profile
                              (role, intents, tools)
```

1. **Analyze** — Deep scans your codebase: file distribution, dependency graphs, config files, architecture patterns, test infrastructure, CI/CD pipelines
2. **Profile** — Asks your developer role (web, mobile, data, DevOps, security, QA) and work intents (implementing, debugging, refactoring, testing, reviewing, documenting)
3. **Score** — A scoring engine evaluates 200+ components from the catalog and selects the ones that match your stack, role, and intents
4. **Integrate** — Detects your source control (GitHub, GitLab, Bitbucket, Azure DevOps) and PM tools (Linear, Jira, Notion, etc.) to configure MCP servers
5. **Generate** — Renders everything into your `.claude/` directory, ready to use

## What Gets Generated

```
.claude/
├── CLAUDE.md              # Project instructions, build commands, conventions
├── settings.json          # Hooks, MCP server configs, permissions
├── agents/                # Role-aware agent definitions
│   ├── architect.md       #   System design & trade-off analysis
│   ├── debugger.md        #   Bug investigation with Playwright
│   ├── reviewer.md        #   Multi-lens code review
│   └── ...                #   Scored & selected for your stack
├── skills/                # Task-specific workflows
│   ├── tdd.md             #   Test-driven development
│   ├── deploy.md          #   Pre-deployment checklists
│   └── ...                #   Matched to your work intents
├── rules/                 # Coding standards & conventions
│   ├── error-handling.md  #   Error patterns for your framework
│   ├── testing.md         #   Test pyramid & coverage targets
│   └── ...                #   Stack-specific rules
├── commands/              # Slash commands for common tasks
├── workflows/             # Multi-step orchestration workflows
└── .claude-craft/         # Internal state (analysis cache, manifest)
```

Every file is selected by the scoring engine — not a static template. A React + TypeScript web app gets different agents than a Go microservice or a Python ML pipeline.

## Commands

### `ccraft auth <key>`

Store your API key for the claude-craft server.

```bash
ccraft auth sk-xxxxxxxxxxxx
ccraft auth sk-xxxxxxxxxxxx --server https://custom-server.example.com
```

### `ccraft install`

Generate Claude Code configuration. Auto-detects whether you're configuring an existing project or creating a new one.

**Existing project** (target directory has files):

```bash
ccraft install                          # Interactive mode
ccraft install -y                       # Non-interactive (accept defaults)
ccraft install -p nextjs                # Apply a framework preset
ccraft install -d /path/to/project      # Target a specific directory
```

**New project** (target directory is empty/missing, or `--name`/`--description` provided):

```bash
ccraft install --name my-app --description "REST API for inventory management"
ccraft install -d ./new-project         # Empty dir triggers new-project mode
ccraft install -y --name my-app         # Non-interactive new project
```

In new-project mode, ccraft creates the directory, initializes git, generates `.claude/` configuration, then runs Claude Code's `/bootstrap:auto` to scaffold the project.

**Options:**

| Flag | Description |
|------|-------------|
| `-y, --yes` | Accept all defaults (non-interactive) |
| `-n, --name <name>` | Project name (triggers new-project mode) |
| `--description <text>` | Project description (triggers new-project mode) |
| `-p, --preset <preset>` | Apply a framework preset (`nextjs`, `go-api`, `python`, `rust`, `aspnet`, `cmake`) |
| `--pro` | Developer mode — skip persona selection, show all options |
| `-d, --dir <path>` | Target directory (default: cwd) |

### `ccraft update`

Re-analyze your project and install new components for any stack changes. Run this after adding new frameworks or dependencies.

```bash
ccraft update                           # Re-analyze and delta install
ccraft update -y                        # Non-interactive
```

### `ccraft logout`

Remove your stored API key.

```bash
ccraft logout
```

## Supported Stacks

### 16 Languages

JavaScript, TypeScript, Python, Go, Rust, Java, C#, Ruby, PHP, Swift, Kotlin, Dart, SQL, Solidity, C, C++

### 80+ Frameworks

| Category | Frameworks |
|----------|-----------|
| **Web** | Next.js, React, Vue, Angular, Svelte, Astro, Nuxt, Remix, Gatsby |
| **Backend** | Express, Fastify, NestJS, Django, Flask, FastAPI, Gin, Echo, Fiber, Spring Boot, ASP.NET Core, Rails, Laravel, Actix, Axum |
| **Mobile** | React Native, Expo, Flutter, Jetpack Compose, .NET MAUI, Tauri |
| **Data / AI** | LangChain, LlamaIndex, PyTorch, TensorFlow, scikit-learn, Hugging Face, Pandas, Airflow, Streamlit, dbt |
| **Blockchain** | Hardhat, Foundry, Web3 |
| **Game** | Phaser, Three.js, Babylon.js, Unity, Godot, Unreal Engine, SDL, SFML |
| **Desktop** | Electron, Qt, GTK, Dear ImGui, wxWidgets |
| **Infra** | Terraform, Serverless Framework, Docker, Kubernetes |
| **C/C++** | CMake, Meson, Bazel, Boost, gRPC, OpenCV, FreeRTOS, ESP-IDF, Zephyr |

### Architecture Detection

Monorepo, microservices, monolith, clean architecture, hexagonal, event-driven, serverless, MVC — automatically detected and scored.

### Tool Integrations (MCP Servers)

| Platform | Integration |
|----------|------------|
| **Source Control** | GitHub, GitLab, Bitbucket, Azure DevOps |
| **Project Management** | Linear, Jira, ClickUp, Asana, Shortcut, Monday.com, YouTrack, Trello, Plane |
| **Documentation** | Notion, Confluence, Google Docs |

MCP servers are configured automatically based on your tool selections, with guided API key setup.

## Developer Roles

ccraft tailors the configuration to how **you** work, not just what your code looks like.

| Role | What Gets Optimized |
|------|-------------------|
| **Web Developer** | Frontend/backend agents, component skills, API rules |
| **Mobile Developer** | Platform-specific agents, build skills, device testing rules |
| **Game Developer** | Engine agents, performance skills, rendering rules |
| **Blockchain Developer** | Smart contract agents, security skills, gas optimization rules |
| **Embedded Developer** | Low-level agents, firmware skills, memory management rules |
| **DevOps** | Infrastructure agents, CI/CD skills, deployment rules |
| **Data Scientist** | ML agents, experiment skills, model evaluation rules |
| **Data Engineer** | Pipeline agents, ETL skills, data quality rules |
| **QA Engineer** | Testing agents, automation skills, coverage rules |
| **Cybersecurity** | Security agents, audit skills, vulnerability rules |
| **Product & Design** | Design system agents, UX skills, spec writing rules |

## Why ccraft?

| | Manual Setup | ccraft |
|---|---|---|
| **Time to configure** | 1-3 hours | 2 minutes |
| **Components selected** | Whatever you remember | Scored from 200+ catalog |
| **Role awareness** | Generic for everyone | Tailored to your role & intents |
| **Stack detection** | You list it yourself | Auto-detected from codebase |
| **MCP setup** | Read docs, copy JSON | Guided setup with key prompts |
| **Stays current** | Manual updates | `ccraft update` detects changes |
| **Architecture-aware** | If you think of it | Auto-detects patterns |

## FAQ

<details>
<summary><strong>Do I need Claude Code installed?</strong></summary>

Yes. ccraft generates configuration files that Claude Code uses. Install Claude Code first: `npm install -g @anthropic-ai/claude-code`
</details>

<details>
<summary><strong>What's the API key for?</strong></summary>

The API key authenticates with the claude-craft scoring server, which runs the component selection algorithm and returns your tailored configuration. It is **not** your Anthropic API key.
</details>

<details>
<summary><strong>Does it overwrite my existing .claude/ config?</strong></summary>

`ccraft install` shows you a confirmation summary before writing any files. The `update` command only adds new components — it won't remove or overwrite existing files.
</details>

<details>
<summary><strong>Can I use it without the interactive prompts?</strong></summary>

Yes. Pass `-y` (or `--yes`) to any command to accept defaults. Combine with `--preset` for fully non-interactive setup:

```bash
ccraft install -y -p nextjs
```
</details>

<details>
<summary><strong>What if my framework isn't supported?</strong></summary>

The scoring engine handles unlisted frameworks gracefully — it still detects your languages, architecture, and complexity. The component selection works at the pattern level, not just the framework level. Run `ccraft update` as support expands.
</details>

<details>
<summary><strong>Is my code sent to the server?</strong></summary>

No. Only the **analysis metadata** is sent (language distribution, framework names, architecture pattern, complexity score). Your source code never leaves your machine.
</details>

## Requirements

- **Node.js** >= 18
- **Claude Code** installed globally
- **API key** from claude-craft (run `ccraft auth`)

## License

[MIT](LICENSE)

---

<div align="center">

**Built for developers who want Claude Code to actually understand their project.**

[Get Started](#getting-started) &bull; [Report a Bug](https://github.com/nicholasgriffintn/claude-craft/issues) &bull; [Website](https://claude-craft.dev)

</div>
