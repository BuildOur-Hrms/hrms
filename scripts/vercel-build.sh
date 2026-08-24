#!/bin/sh
#
# The production build, with the schema brought up to date first.
#
# Vercel runs this in place of `build` when it exists, which is what keeps
# `npm run build` — used by CI and by the browser suite — free of anything
# that touches a database.
#
# Migrating before the build, rather than after, is deliberate: Vercel does
# not move traffic to a deployment whose build failed, so a migration that
# cannot be applied leaves the previous deployment serving instead of putting
# new code in front of a schema that cannot answer it. Every migration in this
# repository is additive, so the window where the schema is ahead of the code
# is harmless.
set -e

if [ "$VERCEL_ENV" = "production" ]; then
  # Migrations need DDL, so this is the owner's connection, never the app's.
  # Refused loudly rather than falling back to DATABASE_URL, which would try
  # to run DDL as app_user and fail halfway through.
  if [ -z "$DIRECT_DATABASE_URL" ]; then
    echo "DIRECT_DATABASE_URL is not set. Set it in the Vercel project to the"
    echo "owner's connection string — migrations cannot run as the"
    echo "application role."
    exit 1
  fi

  # What it may NOT be is a transaction-mode pooler. Those hand out a
  # different backend per statement, so the advisory lock `migrate` takes to
  # stop two deploys migrating at once is released the moment it is taken.
  # Session mode (5432) keeps one backend for the connection and is fine —
  # which matters on Supabase, where the truly direct endpoint answers on
  # IPv6 only and a Vercel builder cannot reach it at all.
  case "$DIRECT_DATABASE_URL" in
    *:6543/*|*:6543)
      echo "DIRECT_DATABASE_URL points at port 6543 — the transaction-mode"
      echo "pooler. Migrations need session mode: same host, port 5432."
      exit 1
      ;;
  esac

  echo "Applying pending migrations…"
  npx prisma migrate deploy
else
  # Previews share the production database. They read the schema; they do not
  # get to change it.
  echo "Not a production deployment — leaving the schema alone."
fi

npx prisma generate
npx next build
