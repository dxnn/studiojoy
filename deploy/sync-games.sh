#!/bin/sh
# Keep the local copies in ./games in step with the ones the studio is serving.
#
# Each game is its own git repository (spec.md §5) and the server's copy is the
# one people are actually editing, so this points every local copy at it as a
# remote called `server` and moves them only in ways that cannot lose anything.
#
#   deploy/sync-games.sh user@host link     # add the remote, clone what is missing
#   deploy/sync-games.sh user@host pull     # fast-forward only; refuses if diverged
#   deploy/sync-games.sh user@host status   # what each one is, and nothing else
#   deploy/sync-games.sh user@host push     # send local commits back
#
# GAMES_PATH overrides where the games live on the server; the default matches
# the layout in this runbook.
#
# ⚠️ `push` needs one thing on the server, once per game, because a game repo
# there is a working tree and git refuses to push into the branch one has
# checked out:
#
#   for g in ~/apps/studio-data/games/*/; do
#     git -C "$g" config receive.denyCurrentBranch updateInstead
#   done
#
# `updateInstead` is the point rather than a workaround: it updates the server's
# working tree, which is what the studio reads and the games origin serves, so
# the push *is* the deploy. It refuses if that tree has uncommitted changes,
# which is its own safety.

set -eu

host=${1:-}
what=${2:-status}
base=${GAMES_PATH:-apps/studio-data/games}

if [ -z "$host" ]; then
  echo "usage: deploy/sync-games.sh user@host [link|pull|status|push]" >&2
  exit 1
fi

if [ ! -d games ]; then
  echo "run this from the top of the checkout — there is no ./games here" >&2
  exit 1
fi

# `user@host` reaches a server; anything else is a directory of game repos on
# this machine, which is what makes the whole loop testable without one — and
# a local mirror possible if you ever want one.
case $host in
  *@*|*:*) far=1 ;;
  # Made absolute: a remote's URL is resolved from inside the repo that holds
  # it, so a relative path here would point somewhere under games/ instead.
  *) far=0; base=$(cd "$host" 2>/dev/null && pwd) || { echo "no such directory: $host" >&2; exit 1; } ;;
esac

# The games over there, which is the list that matters: one made on the server
# today has no local copy yet.
if [ "$far" = 1 ]; then
  remote_games=$(ssh "$host" "ls -1 $base" 2>/dev/null || true)
else
  remote_games=$(ls -1 "$base" 2>/dev/null || true)
fi
if [ -z "$remote_games" ]; then
  echo "no games found at $base — is GAMES_PATH right?" >&2
  exit 1
fi

for slug in $remote_games; do
  dir="games/$slug"
  if [ "$far" = 1 ]; then url="$host:$base/$slug"; else url="$base/$slug"; fi

  if [ ! -d "$dir/.git" ]; then
    if [ "$what" = "link" ]; then
      echo "$slug: cloning"
      # -o server so a cloned game and a linked one answer to the same name.
      git clone -q -o server "$url" "$dir"
    else
      echo "$slug: no local copy — run link first"
    fi
    continue
  fi

  if [ "$what" = "link" ]; then
    git -C "$dir" remote remove server 2>/dev/null || true
    git -C "$dir" remote add server "$url"
    git -C "$dir" fetch -q server
    echo "$slug: linked"
    continue
  fi

  if ! git -C "$dir" remote get-url server >/dev/null 2>&1; then
    echo "$slug: not linked yet — run link first"
    continue
  fi
  if ! git -C "$dir" fetch -q server 2>/dev/null; then
    echo "$slug: ! could not reach the server copy"
    continue
  fi

  ahead=$(git -C "$dir" rev-list --count server/main..HEAD)
  behind=$(git -C "$dir" rev-list --count HEAD..server/main)
  dirty=$(git -C "$dir" status --porcelain | wc -l | tr -d ' ')

  case "$what" in
    status)
      echo "$slug: $behind behind, $ahead ahead, $dirty uncommitted"
      ;;
    pull)
      if [ "$behind" = "0" ]; then
        echo "$slug: up to date"
      elif [ "$ahead" != "0" ]; then
        # Both sides moved. Nothing here is going to guess which order the two
        # sets of commits belong in.
        echo "$slug: ! diverged ($behind behind, $ahead ahead) — sort this one by hand"
      else
        git -C "$dir" merge -q --ff-only server/main
        echo "$slug: pulled $behind"
      fi
      ;;
    push)
      if [ "$ahead" = "0" ]; then
        echo "$slug: nothing to send"
      elif [ "$behind" != "0" ]; then
        echo "$slug: ! $behind behind — pull first, and rebase rather than force"
      elif git -C "$dir" push -q server main 2>&1; then
        echo "$slug: pushed $ahead"
      else
        # Reported rather than fatal: one game the server will not take must
        # not stop the sweep over the rest. The usual cause is the missing
        # receive.denyCurrentBranch=updateInstead at the top of this file.
        echo "$slug: ! push refused — see the note about denyCurrentBranch"
      fi
      ;;
    *)
      echo "unknown command: $what" >&2
      exit 1
      ;;
  esac
done
