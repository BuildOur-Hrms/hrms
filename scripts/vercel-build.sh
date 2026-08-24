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
  # Migrations need DDL, and a pooled endpoint cannot hold the advisory lock
  # `migrate` takes — so this is the owner's direct connection, never the
  # app's. Refused loudly rather than falling back to DATABASE_URL, which
  # would try to run DDL as app_user and fail halfway through.
  if [ -z "$DIRECT_DATABASE_URL" ]; then
    echo "DIRECT_DATABASE_URL is not set. Set it in the Vercel project to the"
    echo "owner's direct (non-pooled) connection string — migrations cannot"
    echo "run as the application role."
    exit 1
  fi

  echo "Applying pending migrations…"
  npx prisma migrate deploy
else
  # Previews share the production database. They read the schema; they do not
  # get to change it.
  echo "Not a production deployment — leaving the schema alone."
fi

npx prisma generate
npx next build
