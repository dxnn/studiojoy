## 1. Goals

A small private studio where a few trusted people and DeepSeek-backed agents
build browser games together. Each **game project** is a chat thread plus a
versioned working tree of files. Agents see the project's files, can be handed
specific ones as context, and edit them with tools. Every edit is a git commit.
Finished games are publicly playable; everything else requires a login.

Modelled on `new-y` (chat + agents + SSE streaming + injectable collaborators),
with three structural departures: files are a mutable working tree rather than
immutable blobs, human membership is implicit rather than per-conversation, and
the LLM is DeepSeek rather than Anthropic.
