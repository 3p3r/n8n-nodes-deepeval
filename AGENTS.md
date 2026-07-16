# Agent guide

Instructions for AI agents and contributors working in this repository.

## Repository layout

| Path | Purpose |
| --- | --- |
| `tooling/generate.ts` | Source of truth for metric definitions; generates node TS/JSON, example workflows, and E2E tests |
| `tooling/vendor.ts` | Downloads and patches DeepEval + Pyodide; builds vendored wheels |
| `tooling/ensure-llamafile.ts` | Downloads pinned llamafile + APE loader for local E2E inference |
| `packages/runtime/` | Pyodide runtime that executes DeepEval in-process |
| `packages/nodes/` | n8n community nodes (built to `packages/nodes/dist`) |
| `packages/nodes/examples/` | Importable example workflow JSON per node (`{id}.workflow.json`) |
| `e2e/` | Real-n8n E2E suite (`global-setup.ts`, `harness.ts`, `generated/*.e2e.test.ts`) |
| `docs/` | README example-workflow screenshots (`{id}.example.png`) — **checked in** |
| `README.md` | User-facing node catalog and config reference |

## Development workflow

Requires **Node.js 20+** (CI uses **Node 24** so `isolated-vm` compiles). Use **npm only** (not yarn/pnpm for installs).

```sh
npm ci
npm run build
npm run typecheck
npm run lint
npm test          # unit tests
npm run test:e2e  # real n8n + llamafile (slow; ~tens of minutes in CI)
npm run check     # typecheck + lint + unit tests
```

### Build pipeline

- `npm run generate` — runs `tooling/generate.ts`, then formats generated files under `packages/nodes/examples`, `packages/nodes/src/nodes`, and `e2e/generated`.
- `npm run build` — `generate` then `moon run runtime:build nodes:build`.
- First Moon build triggers `root:vendor` automatically: downloads pinned **DeepEval 4.0.7** and **Pyodide 0.27.7**, applies compatibility patches, verifies checksums, and builds local wheels. Generated assets live under gitignored paths (`vendor/`, `packages/runtime/assets/`, etc.) but are included in the published npm package. Run `npm run vendor` only when explicitly refreshing vendored assets.

### Code generation

Most nodes, example workflows, and E2E test stubs are **generated**. Edit metric definitions in `tooling/generate.ts`, then run `npm run generate` (or `npm run build`). Do not hand-edit files under `e2e/generated/` or generated node sources unless you are also updating the generator.

### Architecture (implementation)

DeepEval runs inline through a vendored [Pyodide](https://github.com/pyodide/pyodide) runtime:

- A warmed **Pyodide pool** per Node process (default size 4 via `DEEPEVAL_PYODIDE_POOL_SIZE`, clamped 1–16). Each slot is an independent WASM interpreter; metric evals acquire a free slot and release it after mandatory session reset.
- Optional per-metric **Clean Session** recreates the borrowed slot’s VM after evaluation for stronger isolation.
- n8n queue workers are separate processes — each worker gets its own pool.
- Plan worker memory and throughput around pool init cost and ~poolSize × Pyodide RAM per worker.

Shared E2E boot logic lives in `e2e/n8n-session.ts` (`startN8nSession`). Workflow placeholder replacement and node-type remapping live in `e2e/workflow-prep.ts` (`prepareWorkflow`). The Vitest harness in `e2e/harness.ts` imports both.

### E2E testing

E2E spins a **real** npm-installed n8n process with `N8N_CUSTOM_EXTENSIONS` pointing at `packages/nodes/dist`:

1. `npm run ensure-llamafile` — downloads `Ministral-3-3B-Instruct-2512-Q4_K_M.llamafile` and the Cosmopolitan APE loader into gitignored `.llamafile/`.
2. `e2e/global-setup.ts` starts llamafile (OpenAI-compatible API) and n8n, sets up owner account, OpenAI credential, Data Tables, and loads live `/types/nodes.json` for DeepEval node type remapping.
3. Each test in `e2e/generated/` imports the matching `packages/nodes/examples/{id}.workflow.json`, prepares it, POSTs to `/rest/workflows`, runs the workflow, and asserts output.

Tests use only the local llamafile model with `sk-no-key-required`. There is no remote inference fallback.

CI (`.github/workflows/ci.yml`): Ubuntu, Node 24, npm 11.13.0, Python 3.12 + setuptools for node-gyp, then `npm ci`, `npm run ensure-llamafile`, `npm run check`, `npm run test:e2e`.

## README screenshots (`docs/`)

The README embeds **38** example-workflow screenshots — **36** under **Available Nodes** (one per node) plus **2** kitchen-sink workflows before that section. Filenames are `docs/{id}.example.png` where `{id}` matches `packages/nodes/examples/{id}.workflow.json`.

### When to update

Re-capture screenshots whenever any of these change:

- An example workflow's canvas layout (nodes, connections, positions visible after Tidy Up)
- Node display names or icons that appear on the canvas
- The number of nodes (add/remove via `tooling/generate.ts` — also update README sections and screenshot set)

Do **not** let README ASCII wiring diagrams creep back in; use images only.

### Capture process (one-shot, no checked-in tooling)

Screenshot capture is intentionally **not** committed as repo scripts. Re-run ad hoc when needed. The flow mirrors E2E setup:

1. **Build** — `npm run build && npm run ensure-llamafile`
2. **Boot one clean session** — same as E2E: temp `N8N_USER_FOLDER`, llamafile on a free port, n8n with `N8N_CUSTOM_EXTENSIONS=packages/nodes/dist`, owner setup, OpenAI credential → local llamafile base URL, source/results Data Tables. Reuse `startN8nSession()` from `e2e/n8n-session.ts`.
3. **Import each example** — for each `packages/nodes/examples/{id}.workflow.json`, run through `prepareWorkflow()` from `e2e/workflow-prep.ts`, then `POST /rest/workflows`. Keep n8n running for all imports (one session, not per-file restarts). Include kitchen-sink workflows when refreshing those screenshots.
4. **Screenshot each workflow** — open `http://127.0.0.1:{port}/workflow/{workflowId}`, click **Tidy Up** (bottom-left canvas control), save full canvas viewport as `docs/{id}.example.png`.
   - **WSL note:** Cursor's embedded browser often cannot reach WSL `127.0.0.1`. Use Playwright/Chromium **on WSL** with auth from the E2E session cookie or `/rest/login` (`e2e@example.com` / `DeepEval-E2E-Password1` from `e2e/n8n-session.ts`).
5. **Update README** — after each node's **Config** bullet list, ensure `![{displayName} example workflow](docs/{id}.example.png)`. Remove any ` ```text ` wiring blocks. README section order for images:

   `kitchenSinkNonConversational`, `kitchenSinkConversational` (README **Kitchen-sink examples** section, before Available Nodes)

   Per-node order under Available Nodes:

   `deepEvalTrigger`, `gEval`, `dag`, `conversationalGEval`, `conversationalDAG`, `taskCompletion`, `stepEfficiency`, `argumentCorrectness`, `toolCorrectness`, `planAdherence`, `planQuality`, `turnRelevancy`, `roleAdherence`, `knowledgeRetention`, `conversationCompleteness`, `goalAccuracy`, `toolUse`, `topicAdherence`, `turnFaithfulness`, `turnContextualPrecision`, `turnContextualRecall`, `turnContextualRelevancy`, `bias`, `toxicity`, `nonAdvice`, `misuse`, `piiLeakage`, `roleViolation`, `summarization`, `promptAlignment`, `hallucination`, `citationFaithfulness`, `agentLoopDetection`, `toolPermission`, `deepEvalAggregate`, `deepEvalConsistency`

   Typical wiring under Aggregate has prose only (no screenshots).

6. **Tear down** — SIGTERM llamafile and n8n; delete temp user folder.

Verify: `docs/` contains exactly 38 `*.example.png` files; README has no ` ```text ` blocks under Available Nodes.

## Conventions for agents

- Minimize scope; match existing patterns in `tooling/generate.ts` and generated nodes.
- Run `npm run generate` after changing metric definitions.
- **Before finishing any task**, run lint and format so the tree is clean:

  ```sh
  npm run format
  npm run lint
  npm run typecheck
  ```

  Fix any issues they report. Do not leave formatting or lint violations for a follow-up.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages (e.g. `feat:`, `fix:`, `docs:`, `ci:`, `refactor:`, `chore:`). Keep the subject line imperative and under ~72 characters; add a body when the why is not obvious.
- Do not commit `.capture-session.json`, `.llamafile/`, or vendored build artifacts.
- Commit `docs/*.example.png` when screenshots are refreshed.
