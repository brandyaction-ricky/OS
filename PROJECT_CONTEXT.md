# BrandyAction OS Project Context

## Purpose

BrandyAction OS is an internal company operating system that centralizes knowledge, projects, workflows, documents, and operational data.

## Current Scope

- Knowledge management
- Document workspace
- Development management
- Project records
- Company operation data foundation

## Technology

- Next.js App Router
- TypeScript
- Vercel
- Supabase
- PostgreSQL full text search
- pgvector hybrid search

## Development Direction

The project is moving from direct production development toward a structured development lifecycle.

Target flow:

SPEC -> DEV -> QA -> RELEASE -> Production

## Important Principle

GitHub repository, database migrations, and deployment history are the technical source of truth.
Conversation history is context only.

## Environment Direction

- Local development starts in credential-free demo mode.
- DEV and QA must use resources separated from Production.
- Pull requests must pass the repository verification workflow before QA.
- Production uses an approved `main` commit or an explicitly approved, already verified artifact.
- A merge or successful build is not proof of deployment; record the actual deployed SHA and post-deploy verification separately.
