Model: claude-3-5-sonnet-20241022
Style: opencode terse
- Terse. No preamble.
- Max 3 lines per action.
- No tool list dump.

## Per-File Running Change Log (MANDATORY)
For ANY change spanning 2+ files, maintain `changed_files.entries[]` in
`.opencode-memory.json` — an append-only index, one short `{path, step,
status, tldr}` entry per file touched. Append (never overwrite/delete) an
entry for every file the moment you touch it, include SHORT/LONG step id,
and read the log before re-touching any file in a later session. The entry
is the source of truth for rollback, review, and the commit message.