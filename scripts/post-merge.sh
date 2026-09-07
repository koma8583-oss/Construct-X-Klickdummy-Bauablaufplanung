#!/bin/bash
set -e
pnpm install --frozen-lockfile
scripts/setup-shared-database.sh
pnpm -w run typecheck:libs
