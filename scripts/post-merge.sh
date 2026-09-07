#!/bin/bash
set -e
pnpm install --frozen-lockfile
bash scripts/setup-shared-database.sh
pnpm -w run typecheck:libs
