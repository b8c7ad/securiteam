# Volc Agent Launchpad

Volc Agent Launchpad is a web application for creating and working with AI agents in isolated workspaces. It uses the Codex CLI and/or Volcengine Ark to support coding tasks, conversations, and multi-stage workflows.

## Features

- Create, configure, start, stop, and archive AI agents.
- Give each agent its own workspace, instructions, Codex session, and conversation history.
- Send messages and track runs, status, errors, and token usage.
- Build multi-agent workflows with planning, development, testing, review, verification, approval, and repair stages.
- Continue completed workflows through additional iterations.
- Authenticate users with registration, login, password changes, and account sessions.
- Keep agents, workflows, history, settings, usage, and workspaces isolated between users.
- Customize theme and font preferences, including dark, sepia, forest, ocean, serif, and accessibility-oriented options.
- Run locally or use containerized Codex runtimes.

## Stack

- React and Vite frontend
- Fastify and TypeScript server
- JSON file persistence
- Codex CLI and Volcengine Ark integrations

## Development

Install dependencies and start the frontend and server together:

```bash
npm install
npm run dev
```

Useful commands:

```bash
npm run typecheck
npm test
npm run build
```

Configuration is supplied through environment variables. See the deployment files and `apps/server/src/config.ts` for available options.

> This README is an initial draft and can be expanded with setup details, screenshots, deployment instructions, and API documentation.
