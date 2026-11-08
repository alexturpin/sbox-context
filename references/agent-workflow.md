# Running coding agents on an s&box project

Read this when several agent runs (workers, a reviewer, an orchestrator) share one s&box
editor, or when you are setting that up. A single interactive session needs only
`project-practices.md`. Start a project's worker instructions from
`assets/worker-preamble.md`.

## Roles and routing

- **Planner.** It owns the instructions, briefs and a lessons file. It is the only role that
  edits them. Other runs put what they learn in their report as "Lesson: …", and the planner
  folds it in. Without one owner, agents rewrite each other's rules.
- **Orchestrator.** It dispatches subtasks, commits from the diff, and decides technical forks
  on its own when the goals stay fixed, no taste or player-facing choice is involved, and the
  choice can be reversed. It records each decision. Taste questions go to the user, once.
- **Reviewer.** It reads measurements, not summaries. Agent prose can contradict the agent's
  own JSON. It reviews policy choices that were baked into checks as policy.
- **Workers.** Route by the kind of work and by budget, and review the routing as models
  change. Visual, spatial and set-dressing work went to the model with the stronger spatial
  judgement: another model's 3D results needed heavy correction. Tooling, engine code,
  performance and validation went to the model with the larger budget. When one model's limit
  is used up, the other may take its work, unless that work is waiting on the stronger model's
  specialty.
- **Supervisor.** A heartbeat process, not an agent. It restarts a wedged editor, frees a
  stuck lock and kills hung runs between tasks.

## Writing a subtask

Each subtask carries:
- the deliverable;
- the exact files it may edit;
- its lock holder name;
- whether Play is allowed;
- the scoped verification commands;
- the measurements to report;
- its scratch folder.

Write concrete paths, not placeholders. Read the tools a brief names, and every tooling diff,
before you write later tasks: a tooling change can alter a contract that later tasks rely on.

## Lanes and limits

- **One editor task at a time** across the project. Offline tasks run alongside it.
- **Offline code lane.** Run C# work in a separate clone with no editor, so it can go ahead
  while the editor is busy. Allow at most two offline-compiled changes to wait for one
  in-editor check. Give lanes kept waiting a maximum wait for the editor.
- **A fix round is one check,** and it starts with the in-editor compile. A compile failure is
  that round's result.
- **Try before you build tooling.** If an operation is cheap to fail and easy to observe, try
  it once with a stop condition. Allow at most two prerequisite tasks before the real one.
- **A stopped run counts as run.** A run that dies or is killed is cleaned up: stop Play, read
  the console, release the lock, and void any bake or export in flight. It is then dispatched
  again as a takeover. Don't dispatch the same work a third time after it caused two recoveries.
- **A run that posted its report but hasn't exited** after a while (30 minutes worked) is hung.
  Kill it and its children, then clean up.
- **A question left in a report is not asked yet.** Raise it in the same pass. A "stays off
  until X passes" condition needs an owner to switch it back on.

## Git and evidence

- **Agents don't change git state.** No commit, stage, stash, checkout or reset. Say so plainly
  in their instructions: one agent committed on its own until its instructions said otherwise.
- **The diff is the truth, not the report.** Workers misstate what they touched. Stage files by
  name; never `git add -A` while a run is live.
- **Keep committed evidence small:** the scripts that produced the results, the images the
  report shows, and compact summaries. Raw dumps stay in gitignored scratch folders, and the
  report names their paths.
- **Evidence checkers compare and print only.** Pin the tool copy or commit that ran, not the
  repo's HEAD.

## Engine updates

Follow `project-practices.md` section 8. The planner writes the notes file, and the orchestrator
schedules the regression pass in one editor slot.
