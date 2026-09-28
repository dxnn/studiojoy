#!/bin/sh
# Keep the local copies in ./games in step with the ones the studio is serving.
#
# Each game is its own git repository (spec.md §5) and the server's copy is the
# one people are actually editing, so this points every local copy at it as a
# remote called `server` and moves them only in ways that cannot lose anything.
#
#   deploy/sync-games.sh user@host link     # re-point every remote here, clone what is missing
#   deploy/sync-games.sh user@host pull     # link new ones, fast-forward the rest; refuses if diverged
#   deploy/sync-games.sh user@host status   # what each one is, and nothing else
#   deploy/sync-games.sh user@host push     # send local commits back
#
# GAMES_PATH overrides where the games live on the server; the default matches
# the layout in this runbook.
#
# ⚠️ `push` needs one thing on the server, once for the whole server rather
# than once per game, because a game repo there is a working tree and git
# refuses to push into the branch one has checked out. A conditional include
# reaches every game, including the ones the studio has not made yet:
#
#   git config --global \
#     "includeIf.gitdir:/home/ubuntu/apps/studio-data/games/.path" \
#     /home/ubuntu/.gitconfig-games
#   git config --file /home/ubuntu/.gitconfig-games \
#     receive.denyCurrentBranch updateInstead
#
# That path is the games directory as `readlink -f` prints it, trailing slash
# included; both matter, and deploy/README.md says why. Setting it per repo
# works and is the trap — it comes apart on the next game somebody makes.
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

# The server's own working trees, in one call rather than one per game.
#
# ⚠️ A dirty tree over there is what refuses a push, and nothing here could see
# it before: this script only ever reported the *local* copy's uncommitted
# count. A helper's turn whose commit failed leaves files in the server's tree
# that no later save, turn or sweep picks up, because every commit the studio
# makes is scoped to its own paths (spec/ §5) — so it sits there silently until
# somebody happens to push.
remote_dirty=""
if [ "$what" = "status" ] || [ "$what" = "push" ]; then
  if [ "$far" = 1 ]; then
    remote_dirty=$(ssh "$host" "cd $base 2>/dev/null || exit 0; for d in */; do n=\$(git -C \"\$d\" status --porcelain 2>/dev/null | wc -l | tr -d ' '); [ \"\$n\" = 0 ] || echo \"\${d%/} \$n\"; done" 2>/dev/null || true)
  else
    remote_dirty=$(cd "$base" && for d in */; do n=$(git -C "$d" status --porcelain 2>/dev/null | wc -l | tr -d ' '); [ "$n" = 0 ] || echo "${d%/} $n"; done)
  fi
fi

# How many files the server's copy of one game has uncommitted; 0 when clean.
remote_dirty_for() {
  printf '%s\n' "$remote_dirty" | awk -v s="$1" '$1 == s { print $2; hit = 1 } END { if (!hit) print 0 }'
}

for slug in $remote_games; do
  dir="games/$slug"
  if [ "$far" = 1 ]; then url="$host:$base/$slug"; else url="$base/$slug"; fi

  if [ ! -d "$dir/.git" ]; then
    if [ "$what" = "link" ] || [ "$what" = "pull" ]; then
      # -o server so a cloned game and a linked one answer to the same name.
      # Reported rather than fatal, like a refused push: one entry over there
      # that is not a repo must not stop the sweep over the rest.
      if git clone -q -o server "$url" "$dir"; then
        echo "$slug: cloned"
      else
        echo "$slug: ! could not clone the server copy"
      fi
    else
      echo "$slug: no local copy — run pull first"
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
    if [ "$what" != "pull" ]; then
      echo "$slug: not linked yet — run pull first"
      continue
    fi
    git -C "$dir" remote add server "$url"
    echo "$slug: linked"
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
      far_dirty=$(remote_dirty_for "$slug")
      if [ "$far_dirty" = "0" ]; then
        echo "$slug: $behind behind, $ahead ahead, $dirty uncommitted"
      else
        echo "$slug: $behind behind, $ahead ahead, $dirty uncommitted, ! $far_dirty uncommitted on the server"
      fi
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
      elif [ "$(remote_dirty_for "$slug")" != "0" ]; then
        # Said before the attempt rather than after: updateInstead's refusal
        # names neither the files nor which side they are on.
        echo "$slug: ! the server's copy has $(remote_dirty_for "$slug") uncommitted file(s) — commit those there first"
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
