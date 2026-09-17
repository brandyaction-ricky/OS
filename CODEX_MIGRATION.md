# Codex Migration Guide

## Goal

Move BrandyAction OS development from conversation-driven changes to repository-context-driven Codex development.

## Current State

The project previously used direct development and deployment iterations.

## Target State

- GitHub as code source of truth
- Documented project context
- Controlled branch strategy
- DEV validation before production

## Recommended Branch Model

main = Production
develop = Development
feature/* = Individual work

## Migration Steps

1. Analyze current repository
2. Document architecture
3. Separate development and production environments
4. Establish deployment flow
5. Continue feature development through Codex

## First Codex Actions

- Review repository structure
- Review environment configuration
- Identify current deployment setup
- Create implementation inventory
- Report migration risks
