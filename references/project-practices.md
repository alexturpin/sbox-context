# Working practices for s&box projects with coding agents

Practices learned on a long s&box project driven by Claude Code and Codex agents against a live
editor. Use them as defaults when you set up a new project or when your project's own
instructions don't cover a point. Your project's own rules always take priority. Facts about the
engine were observed on builds from autumn 2026, so check any that matter against the installed
XML docs and the current engine-update notes.

## Contents

1. References and engine facts
2. Editor access by agents
3. C# and hot reload
4. Play mode and verification
5. Scene Compile and performance
6. Exports and networking
7. Windows scripting
8. Engine updates

## 1. References and engine facts

- Use references in this order: the installed XML docs (`Sandbox.Engine.xml`, `Sandbox.Tools.xml`),
  then `sbox-cli --skill` notes, then docs and API snapshots, then public source. The XML docs
  don't mark static against instance, and a member missing from them may still exist: check the
  installed assembly before you conclude.
- The engine's own `sbox-cli` skill prefers editor tools and `save_scene`. If your scenes or
  prefabs are generated from data or files, answer the editor's install prompt with "Don't ask
  again". Read its notes as reference only.
- Disabled components and objects drop out of default lookups (scene type index, default
  `GetComponent`, scene queries). Keep references, or enumerate inactive objects explicitly.
- In editor context, traces need `Editor.SceneEditorSession.Active.Scene`; `Game.ActiveScene` is
  empty there.
- `run_csharp` wraps a method body. Use arrays, anonymous types and fully qualified generics, and
  guard snippets with `!Game.IsPlaying`. It compiles inside the measured process, so keep it out
  of timing windows.
- A private async engine call can block synchronously before its first `await`, and `Task.Run`
  doesn't help. Read the installed IL before designing around it.
- The s&box news changelog renders only in a browser. Plain HTTP and RSS fetches miss it.

## 2. Editor access by agents

- **One editor task at a time.** Only one agent drives a shared editor at once; offline work runs
  alongside. Use `scripts/editor-lock.js` (holder name, re-entrant, stale after 15 minutes,
  released only by its holder), and refresh it during long work. A stale timestamp or a
  finished helper doesn't give you authority to take over a live lock.
- **Script the editor through one shared client.** Use `scripts/editor.js` or an equivalent
  that keeps one `sbox-cli --connect` child per process. That is about ten times faster per call
  than spawning sbox-cli each time. Headless agent runs may refuse mutating MCP tools through the
  client's own MCP entry, and a helper one agent wrote can refuse in another agent's session.
- **Check identity before mutating.** `editor_status` must name the intended project and
  scene. On a fresh launch, MCP answers before the scene and compile are ready: wait for the
  active scene path, `LastCompileSucceeded` and `!IsCompiling`.
- **Keep project rules in `sbox-editor.json`.** For example `{"deny": ["save_scene"],
  "requireLock": true}`. The client enforces it, including inside `call_tool` and `call_tools`.
- **Agents don't save scenes or relaunch the editor.** Recovery (restart, discard-reload)
  belongs to a supervisor between runs. A worker can't restart the editor from inside its own
  run.
- **Batch editor needs.** Author offline, then do every editor step in one lock session. With
  several agents, waiting for the lock dominated wall time. Poll a busy lock every ten seconds or
  so; slow polls lose races.
- **Run scene helpers one at a time,** even under one lock, and wait for each to exit.
- **Budget editor calls by their logging cost:** a listing that computes in milliseconds can
  log for seconds.
- **Restart a long-running editor before heavy work** such as bakes and exports. Its memory
  grows over a session.
- **The console buffer is small and shared,** and keeps old hotload failures. Read it from a
  cursor (`read_console` takes `limit`, `minimumLevel`, `filter`, `since`), collect filtered
  lines during the run, or read `logs/sbox-dev.log`. A capped page doesn't prove a severity is
  absent.
- **`SceneHasUnsavedChanges` misleads.** It can read true right after `open_scene`, after a
  reload with no edits, and after `play_stop`. A discard-reload clears it. Temporary cameras
  for stopped-mode shots dirty the scene, so end with a discard-reload.
- **Wait before reloading.** Reopening a scene quickly can leave prefabs as empty stubs. Writing
  a prefab hot-reloads it at once, so take before-views first.
- **Captures:** the editor can start with a tiny viewport, so maximise it or force a resolution,
  and read `Screen.Size` before the first capture. Match aspect ratios for before/after pairs.
  `CameraComponent.RenderToBitmap` plus `Bitmap.ToPng()` works for review captures.

## 3. C# and hot reload

- Don't edit C# while Play or a queued validation runs. Queued lambdas fail to remap.
- Static fields, convar values and ConVar defaults survive hot reload: a changed default reads
  as the old value until restart. Set convars explicitly in every check.
- Write whole files, helpers before their callers, and cross-file edits in one pass. Note the
  console cursor first so half-edit errors can be told apart from real ones.
- A clean compile doesn't prove the runtime access whitelist (`System.IO`, some `GC` members).
  `Sandbox.AccessControl.VerifyAssembly` run offline catches these.
- Hotloaded resource or schema changes can leave stale cached instances. Gate on typed values
  read live, not on compile success.
- "Clean" means zero warnings and errors in `compile_status` for every compiler.
- **Offline gate:** compile with Roslyn against the installed engine DLLs, with and without
  `STANDALONE`, and add pure-logic tests. The editor stage then only has to prove rendering,
  input, resource compile and export inclusion. Offline compiles don't prove hot reload, the
  whitelist or networking, so limit how many offline-only changes wait for one in-editor check
  (two worked well).
- `[AssetType]` is the supported GameResource registration. Live GameResource edits survive
  Play stop, so reset them before any later save.

## 4. Play mode and verification

- Keep test evidence out of shipped game code. Verification belongs in reports, tests and
  review. Don't make the game refuse content until it can prove its own checks.
- `play_start` returns before lobby creation, which can take a long time. Poll against one
  absolute deadline, record loading, lobby, network and player readiness separately, and always
  stop Play in `finally`.
- `editor_status` "stopped" and `instance_status` can disagree. Require an explicit play state.
- Play captures the cursor only when the viewport has focus. A focused `TextEntry` swallows
  keyboard presses.
- Use an exact next-fixed-tick observer. `Task.Delay` continuations can skip physics ticks.
- **Traces prove clearance, not walkability.** Only the physical player proves a route.
- **A verify task runs its whole list and reports every failure.** It stops early only when the
  rest can't be measured. Stopping at the first failure doubles fix rounds.
- **Keep evidence kinds apart.** A compile result, load result, console delta, RPC reply,
  window responsiveness and presented frames each prove only themselves. An answering MCP is not
  a responsive window.
- **A latched failure stays failed.** Later readiness or a clean cleanup never turns it green.
- **Preflight before a scarce Play attempt:** compile the check against the current schema,
  round-trip the observation types, and confirm the real interaction can be dispatched.
- Before turning a dev switch off to narrow a run (lobby, player), check what the code does
  without it.
- **Capture player-visible changes in a cold exported build,** not only in editor Play.
- **Unreachable by design: stop.** If code has a condition nothing in the shipped game can meet,
  raise it rather than building around it.
- The editor validates; the user signs off. Name the visual, input and gameplay checks only a
  person can make.

## 5. Scene Compile and performance

- The editor viewport doesn't use the Scene Compile bake; Play does, when the scene has no
  unsaved changes. Serialise every scene and prefab writer against the bake, discard-reload, then
  rebake. A runtime fix counts as repaired only after the rebake.
- The engine doesn't prune old bake generations, and lobby hosting walks the mounted files.
  Leftovers slow startup and bloat exports, so prune them outside the engine.
- Scene Compile can strip static objects and break prefab links. Offline prefab audits don't
  prove runtime behaviour.
- Read performance through the `perf_*` MCP tools rather than screenshots. `FrameStats` refreshes
  about once a second, and a null `perf_gpu` is a finding, not a pass.
- Report performance only after a rebake, with CPU, GPU and memory separately, and give a
  feature's cost as a comparison. The first Play after an editor start pays cache costs.
- Every engine update moves fps baselines, so rebaseline on the new build.

## 6. Exports and networking

- Exclude dev tooling with `Application.IsEditor && !Application.IsStandalone` and the
  `STANDALONE` symbol. Read launch settings through ConVars, not `System.Environment`.
- An export blocks the editor throughout. Hold the lock and poll the export's output, not the
  console.
- Interest culling doesn't stop the initial network spawn broadcast, and RPC filters don't
  filter it. Check initial create, late-join snapshot and deltas separately.
- Run a short two-instance check as soon as synced state exists. Treat the first scripted
  joins as needing a person present.

## 7. Windows scripting

- Windows PowerShell 5.1 strips double quotes from JSON in native arguments. Pass JSON through
  a file (`editor.js tool @args.json`) or call from Node or Python with an argument array.
  `Set-Content -Encoding utf8` adds a BOM.
- Shell heredocs mangle backslashes and quotes, and some writers emit CRLF. Write files with
  file tools, and check `git ls-files --eol` on fresh clones.
- The editor pipe is reachable only from the interactive desktop session, not over SSH. Child
  processes started over SSH die with the session, so start long jobs through a scheduled task.
- Offline harnesses can exit 0 after a compile failure. Read the result files.

## 8. Engine updates

Keep one notes file per engine update (for example `specs/engine-updates/<version>.md`):

1. Read the news post and changelog. Check every Removed and Changed item against your code,
   tools and scripts first; that is where breakage shows up.
2. Make the project build on both engines (reflection, transport switches) and push before
   updating. Steam doesn't update a running editor.
3. Refresh references through staging with `sbox-context.js sync`, never while another agent
   reads them.
4. After the update, run `editor_status`, `compile_status` for every compiler and the console at
   Warn. Then do a regression pass: rebake, rerun physics and movement checks against the last
   accepted results, set a new performance baseline, export and smoke-test.
5. Decide and report engineering fixes. Send gameplay consequences to the user as a question
   with a recommendation.
