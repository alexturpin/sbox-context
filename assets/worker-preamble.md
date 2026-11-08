# Worker preamble

<!-- Template from the sbox-context skill. Replace each <…> and delete any rule the project
doesn't need. Every agent run (worker, reviewer, orchestrator) reads this file first; the task
itself carries only the work. -->

## The machine

The s&box editor runs on this machine with `<game folder>` open and `<scene>` loaded. It is
reached through `sbox-cli` over a named pipe, from the desktop session only. `<other tools:
Python, Blender, …>`.

## Editor access

- Reach the editor only through `node <skill-dir>/scripts/editor.js <tool> [<json> | @file]
  --project-root <game folder>` (or `<project client>`). Never use an MCP connection of your
  own to the editor.
- Before any scene work, take the lock with `node <skill-dir>/scripts/editor-lock.js take
  <HOLDER>`, set `SBOX_EDITOR_LOCK_HOLDER=<HOLDER>`, and release it at the end. Your holder name
  is in the task. Never take over a live lock.
- `editor_status` must name this project and `<scene>` before any scene call (the client checks
  the project).
- Never save the scene, and never relaunch the editor. If the editor is down, report it.
- Never edit C# while Play or a validation queue is running. After any scene or prefab write,
  rebake before any Play or performance number counts.
- Whether Play is allowed is stated in the task.

## Scope and files

- Edit only the paths the task names. One writer per file.
- Never change git state (commit, stage, stash, checkout, reset). The orchestrator commits from
  `git status`, checked against your report.
- Scratch goes in `<scratch>/<task-id>/` (gitignored). Write results as you go, and on a
  takeover resume rather than restart.
- Committed evidence holds only scripts, the images the report shows, and compact summaries.
  Raw outputs stay in scratch.
- Never edit the project's instructions or lessons file. Put what you learned in your report's
  Decisions section, starting with "Lesson:".
- Run only the verification commands the task names, scoped to the change.
- Measure before designing, and finish the whole task.
- Unreachable by design: if your code has a condition nothing in the shipped game can meet,
  stop and put "Unreachable:" first in Open.
- Taste questions are never a worker's call. Raise them once in the report.

## Before you end

Leave no background job or child process running. A headless run whose child is still alive
may never exit, and it blocks every later task for that agent.

## Report

End with these sections, kept small:
- **Done:** what changed, by file.
- **Verification:** the exact commands run and their results.
- **Measurements:** the numbers the task asked for, with their source files.
- **Decisions:** what you chose and why, including any "Lesson:" lines.
- **Open:** anything unfinished, taste questions, and checks only a person can make.

A hand-back is not approval: the reviewer decides.
