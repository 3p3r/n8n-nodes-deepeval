# n8n-nodes-deepeval

n8n community nodes powered by DeepEval: 33 metric nodes, DeepEval Trigger, and DeepEval
Aggregate.

- [n8n-nodes-deepeval](#n8n-nodes-deepeval)
  - [Synopsis](#synopsis)
  - [Architecture](#architecture)
    - [Required N8N Nodes](#required-n8n-nodes)
    - [Optional Dashboard](#optional-dashboard)
  - [Available Nodes](#available-nodes)
    - [n8n → DeepEval field mapping](#n8n--deepeval-field-mapping)
    - [DeepEval Trigger](#deepeval-trigger)
      - [Sources](#sources)
    - [DeepEval Metrics](#deepeval-metrics)
      - [Custom](#custom)
        - [G-Eval](#g-eval)
        - [DAG](#dag)
        - [Conversational G-Eval](#conversational-g-eval)
        - [Conversational DAG](#conversational-dag)
      - [Agentic](#agentic)
        - [Task Completion](#task-completion)
        - [Step Efficiency](#step-efficiency)
        - [Argument Correctness](#argument-correctness)
        - [Tool Correctness](#tool-correctness)
        - [Plan Adherence](#plan-adherence)
        - [Plan Quality](#plan-quality)
      - [Multi-Turn](#multi-turn)
        - [Turn Relevancy](#turn-relevancy)
        - [Role Adherence](#role-adherence)
        - [Knowledge Retention](#knowledge-retention)
        - [Conversation Completeness](#conversation-completeness)
        - [Goal Accuracy](#goal-accuracy)
        - [Tool Use](#tool-use)
        - [Topic Adherence](#topic-adherence)
        - [Turn Faithfulness](#turn-faithfulness)
        - [Turn Contextual Precision](#turn-contextual-precision)
        - [Turn Contextual Recall](#turn-contextual-recall)
        - [Turn Contextual Relevancy](#turn-contextual-relevancy)
      - [Safety](#safety)
        - [Bias](#bias)
        - [Toxicity](#toxicity)
        - [Non-Advice](#non-advice)
        - [Misuse](#misuse)
        - [PII Leakage](#pii-leakage)
        - [Role Violation](#role-violation)
      - [Others](#others)
        - [Summarization](#summarization)
        - [Prompt Alignment](#prompt-alignment)
        - [Hallucination](#hallucination)
      - [Community](#community)
        - [Citation Faithfulness](#citation-faithfulness)
        - [Agent Loop Detection](#agent-loop-detection)
        - [Tool Permission](#tool-permission)
    - [DeepEval Aggregate](#deepeval-aggregate)
      - [Sinks](#sinks)
      - [Typical wiring](#typical-wiring)

## Synopsis

This package integrates [DeepEval](https://github.com/confident-ai/deepeval) into n8n 2.x.
It requires Node.js 20 or newer. All 35 nodes are listed under n8n's `AI, LLM & Voice`
category and are searchable with the `DeepEval Benchmarking` alias.

The current package intentionally contains only the n8n nodes. The dashboard, dashboard
hooks, Google Sheets adapters, and Microsoft Excel adapters are deferred.

### Install and build

Install the published community package in n8n:

```sh
npm install n8n-nodes-deepeval
```

For repository development, use npm only:

```sh
npm ci
npm run build
npm run typecheck
npm run lint
npm test
```

The first Moon build runs `root:vendor` automatically. It downloads pinned DeepEval
4.0.7 and Pyodide 0.27.7 sources, applies the compatibility patches, verifies checksums,
and builds local wheels. These generated assets are gitignored but included in the
published package, so installed nodes do not download Python packages at runtime. Run
`npm run vendor` directly only when explicitly refreshing the generated assets.

Importable examples for every concrete node are in `packages/nodes/examples`. The
end-to-end suite imports and executes those workflows through a real npm-installed n8n
process.

Live examples default to the OpenAI-compatible endpoint
`http://deezr:4000/v1`, discover its model with `GET /models`, and use `local` as the API
key. Override these in tests with `DEEPEVAL_INFERENCE_BASE_URL`,
`DEEPEVAL_INFERENCE_MODEL`, and `OPENAI_API_KEY`.

## Architecture

DeepEval executes inline through the vendored
[Pyodide](https://github.com/pyodide/pyodide) runtime. Package loading starts one
module-scoped initialization promise. Evaluations in a process reuse that warmed VM and
are serialized through one queue. n8n queue workers are separate processes, so each
worker gets one independent warmed runtime.

Pyodide and the Python wheel set are included in the package for offline execution.
Initialization is memory-intensive, and evaluations are intentionally serialized because
the Python VM is not re-entrant. Plan worker memory and throughput around this constraint.

### Required N8N Nodes

Offered as N8N community nodes, these are the core components that allow you to integrate DeepEval into your N8N workflows. They are designed to be flexible and easy to use, enabling you to evaluate various data types and models directly within your N8N environment.

### Optional Dashboard

The dashboard is not included in this implementation. No frontend injection, hooks,
parallel database, or transparent recording behavior is installed.

## Available Nodes

Metric nodes cover the [DeepEval Eval Metrics](https://deepeval.com/docs/metrics-introduction) catalog, grouped as **Custom**, **Agentic**, **Multi-Turn**, **Safety**, **Others**, and **Community** (MCP, Images, and RAG are not included).

Wiring follows normal n8n data flow:

- **Main connection** — evaluation data arrives as item fields from upstream nodes. Connect **AI Agent** (or any node that produced the run) on main for agentic metrics; enable **Return Intermediate Steps** so `output` and `intermediateSteps` are available. Single-turn metrics use fields such as `input`, `actualOutput`, `context`, and `retrievalContext`. See [n8n → DeepEval field mapping](#n8n--deepeval-field-mapping) for how these map into DeepEval test cases and traces.
- **Language Model sub-node** — LLM-judge metrics accept an `aiLanguageModel` connection (the same OpenAI, Anthropic, and related sub-nodes used by AI Agent). AI Agent and Chat Trigger are **not** sub-nodes; only the judge model uses that port.
- **Memory sub-node** — conversational and turn-based metrics **require** `aiMemory` (Simple Memory, Postgres Chat Memory, and related memory sub-nodes). Connect the **same Memory** used by AI Agent; the metric reads chat history and builds DeepEval `turns` internally.

Remaining DeepEval constructor options (`threshold`, `criteria`, allowlists, and so on) appear as **Config** on the node UI. Every metric node emits the same output shape: `score`, `reason`, `success`. Most metrics pass when `score >= threshold`; lower-is-better safety metrics (Bias, Toxicity, Hallucination, Misuse) pass when `score <= threshold` — each metric section documents its direction.

### n8n → DeepEval field mapping

Metric nodes accept n8n item fields on the **main** connection and/or special sub-node connections, then map them internally before calling DeepEval. Canvas wiring: main data in for agentic and single-turn metrics; **Memory** sub-node (required) for conversational metrics; **Language Model** sub-node for LLM judges.

| Source | DeepEval field | Notes |
| --- | --- | --- |
| `output` (main) | `actual_output` | AI Agent final response |
| `input` (main) | `input` | User prompt or golden input |
| `actualOutput` (main) | `actual_output` | Explicit field name when set upstream |
| `intermediateSteps` (main) | `tools_called`, synthetic trace | AI Agent with **Return Intermediate Steps** enabled |
| `expectedTools` (main) | `expected_tools` | Trigger column mapping or upstream field |
| `aiMemory` (sub-node) | `turns` (`ConversationalTestCase`) | **Required** for conversational / turn-based metrics; built by memory adapter |
| `context`, `retrievalContext` (main) | `context`, `retrieval_context` | Grounding / RAG metrics |

**Conversational metrics** — Conversational G-Eval, Conversational DAG, and all Multi-Turn metrics read conversation history **only** from the `aiMemory` sub-node. Connect the same Memory instance your AI Agent uses. No `turns` field on main.

**Trace-dependent metrics** — Task Completion, Step Efficiency, Plan Adherence, Plan Quality, and Agent Loop Detection analyze an agent execution trace in DeepEval (normally from `@observe` tracing). In n8n, the metric builds a **synthetic trace** from `intermediateSteps` when native tracing is unavailable. If intermediate steps are missing when required, the metric errors with a clear message.

**Goal Accuracy and Tool Use** — `turns` come from Memory. Connect **AI Agent** on main (with **Return Intermediate Steps**) to enrich relevant turns with `tools_called` from `intermediateSteps`.

**Deterministic agent metrics** — Argument Correctness, Tool Correctness, and Tool Permission map `intermediateSteps` → `tools_called` directly (plus `input` and `expected_tools` where applicable).

### DeepEval Trigger

Starts an evaluation run from rows supplied by n8n's official Data Table node. It emits
one mapped item and evaluation context per row. It does not score and does not own
Language Model or metric configuration.

n8n 2.x restricts the internal Data Table proxy to built-in node types. The example
therefore uses the supported composition `Data Table (Get rows) → DeepEval Trigger`
instead of bypassing that access control.

**Config**

- `runName` — human label for the evaluation run
- `dataTableId` — source table identity recorded in `evalContext`
- `columnMapping` — map source columns → DeepEval fields (`input`, `expectedOutput`, `context`, `retrievalContext`, `expectedTools`, and so on)
- `limitRows` — whether to cap how many rows are processed
- `maxRows` — maximum rows when `limitRows` is enabled
- `filters` — optional column=value filters on the dataset

```text
[ Data Table: Get rows ] ──► [ DeepEval Trigger ] ──┬── input / expectedOutput / …
                                                    ├── evalContext (runId, runName, isEvalRun, rowId)
                                                    └── one item per dataset row
```

#### Sources

This pass supports n8n
[Data Tables](https://docs.n8n.io/build/work-with-data/data-tables) only. Google Sheets
and Excel sources are deferred.

### DeepEval Metrics

#### Custom

Custom metrics let you define evaluation criteria with natural language (G-Eval) or deterministic decision trees (DAG).

##### [G-Eval](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28custom%29/metrics-llm-evals.mdx)

Uses LLM-as-a-judge with chain-of-thought to score an output against any criteria you define (correctness, tone, safety, and so on).

**Config**

- `name` (required) — metric display name
- `criteria` — natural-language evaluation rubric (required unless `evaluationSteps` is set; mutually exclusive with `evaluationSteps`)
- `evaluationSteps` — fixed chain-of-thought steps; skips auto-generation from `criteria` (mutually exclusive with `criteria`)
- `evaluationParams` (required at run) — which test-case fields the judge may use (`INPUT`, `ACTUAL_OUTPUT`, `EXPECTED_OUTPUT`, `CONTEXT`, and so on)
- `rubric` — score bands (`scoreRange` 0–10, `expectedOutcome`) to confine LLM scoring
- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
input ─────────────┐
actualOutput ──────┼── [ G-Eval ] ──┬── score
aiLanguageModel ───┘                ├── reason
                                    └── success
```

##### [DAG](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28custom%29/metrics-dag.mdx)

Runs a deep acyclic graph of LLM-powered decision nodes for deterministic, rule-based scoring when G-Eval is too subjective.

**Config**

- `name` (required) — metric display name
- `dag` (required) — decision graph built from Task, Binary/Non-Binary Judgement, and Verdict nodes
- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — log each node verdict

```text
input ─────────────┐
actualOutput ──────┼── [ DAG ] ───┬── score
aiLanguageModel ───┘              ├── reason
                                  └── success
```

##### [Conversational G-Eval](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28custom%29/metrics-conversational-g-eval.mdx)

G-Eval adapted for full conversations: scores the entire dialogue against custom criteria with prior context in mind.

**Config**

- `name` (required) — metric display name
- `criteria` — conversation-level rubric (required unless `evaluationSteps` is set; mutually exclusive with `evaluationSteps`)
- `evaluationSteps` — fixed chain-of-thought steps (mutually exclusive with `criteria`)
- `evaluationParams` — turn fields to evaluate (defaults include `CONTENT`)
- `rubric` — score bands to confine LLM scoring
- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
aiMemory ────────────┐
aiLanguageModel ─────┼── [ Conversational G-Eval ] ──┬── score
                     │                               ├── reason
                     │                               └── success
```

Connect the same Memory as AI Agent.

##### [Conversational DAG](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28custom%29/metrics-conversational-dag.mdx)

DAG adapted for multi-turn evaluation: deterministic decision trees over conversation windows.

**Config**

- `name` (required) — metric display name
- `dag` (required) — conversational decision graph (supports `turnWindow` on nodes)
- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — log each node verdict

```text
aiMemory ────────────┐
aiLanguageModel ─────┼── [ Conversational DAG ] ──┬── score
                     │                            ├── reason
                     │                            └── success
```

Connect the same Memory as AI Agent.

#### Agentic

Agentic metrics evaluate LLM agent execution. Connect **AI Agent** (or an equivalent upstream node) on the **main** connection; enable **Return Intermediate Steps**. The metric maps n8n fields to DeepEval test cases and traces (see [n8n → DeepEval field mapping](#n8n--deepeval-field-mapping)). Attach a **Language Model** sub-node when the metric needs an LLM judge.

##### [Task Completion](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28agentic%29/metrics-task-completion.mdx)

Judges whether the agent accomplished the task by aligning the extracted outcome with the inferred (or configured) goal.

**Config**

- `task` — explicit goal; if omitted, inferred from the agent trace
- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
input ─────────────┐
output ────────────┤
intermediateSteps ─┼── [ Task Completion ] ───┬── score
aiLanguageModel ───┘                          ├── reason
                                              └── success
```

Connect **AI Agent** on main (with **Return Intermediate Steps**). Maps to DeepEval `input`, `actual_output`, and a synthetic trace from `intermediateSteps`. DeepEval infers `task` from the trace when not set in Config.

##### [Step Efficiency](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28agentic%29/metrics-step-efficiency.mdx)

Measures how efficiently the agent completed the task, penalizing unnecessary steps, retries, and detours in the trace.

**Config**

- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
input ─────────────┐
output ────────────┤
intermediateSteps ─┼── [ Step Efficiency ] ───┬── score
aiLanguageModel ───┘                          ├── reason
                                              └── success
```

Trace-only in DeepEval. Requires synthetic trace from `intermediateSteps`; fails clearly if intermediate steps are absent.

##### [Argument Correctness](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28agentic%29/metrics-argument-correctness.mdx)

Checks whether each tool call received correct arguments for the user request (referenceless LLM judge).

**Config**

- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
input ─────────────┐
output ────────────┤
intermediateSteps ─┼── [ Argument Correctness ] ───┬── score
aiLanguageModel ───┘                               ├── reason
                                                   └── success
```

Maps `input` → DeepEval `input`, `output` → `actual_output`, `intermediateSteps` → `tools_called`.

##### [Tool Correctness](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28agentic%29/metrics-tool-correctness.mdx)

Compares tools the agent called against expected tools (selection, order, and optionally inputs/outputs).

**Config**

- `availableTools` — tools the agent could use; enables LLM tool-selection optimality sub-score
- `evaluationParams` — strictness for matching (`INPUT_PARAMETERS`, `OUTPUT`; names always matched)
- `shouldExactMatch` — `toolsCalled` must exactly match `expectedTools` (name + optional input/output)
- `shouldConsiderOrdering` — LCS-based order-aware matching (ignored if `shouldExactMatch` is `true`)
- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
input ─────────────┐
output ────────────┤
intermediateSteps ─┤
expectedTools ─────┼── [ Tool Correctness ] ──┬── score
aiLanguageModel ───┘                          ├── reason
                                              └── success
```

Maps `input`, `intermediateSteps` → `tools_called`, and `expectedTools` → `expected_tools`. `expectedTools` may come from the Trigger column mapping or another upstream field.

##### [Plan Adherence](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28agentic%29/metrics-plan-adherence.mdx)

Scores how closely the agent's execution followed the plan inferred from its reasoning in the trace.

**Config**

- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
input ─────────────┐
output ────────────┤
intermediateSteps ─┼── [ Plan Adherence ] ──┬── score
aiLanguageModel ───┘                        ├── reason
                                            └── success
```

Trace-only. Synthetic trace from `intermediateSteps`. When DeepEval finds no plan in the trace, score defaults to `1`.

##### [Plan Quality](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28agentic%29/metrics-plan-quality.mdx)

Scores the quality of the plan itself (task vs. plan alignment), independent of whether execution stuck to it.

**Config**

- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
input ─────────────┐
output ────────────┤
intermediateSteps ─┼── [ Plan Quality ] ──┬── score
aiLanguageModel ───┘                      ├── reason
                                          └── success
```

Trace-only. Synthetic trace from `intermediateSteps`. When DeepEval finds no plan in the trace, score defaults to `1`.

#### Multi-Turn

Multi-turn metrics evaluate chatbots over a full conversation. Each metric **requires** an `aiMemory` sub-node — connect the **same Memory** used by AI Agent. **Goal Accuracy** and **Tool Use** also connect **AI Agent** on main (with **Return Intermediate Steps**) to enrich turns with tool-call data from `intermediateSteps`.

##### [Turn Relevancy](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28multi-turn%29/metrics-turn-relevancy.mdx)

Checks that each assistant reply stays relevant given prior turns in a sliding window.

**Config**

- `windowSize` — sliding-window size in unit interactions (default `10`)
- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
aiMemory ────────────┐
aiLanguageModel ─────┼── [ Turn Relevancy ] ──┬── score
                     │                        ├── reason
                     │                        └── success
```

Connect the same Memory as AI Agent.

##### [Role Adherence](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28multi-turn%29/metrics-role-adherence.mdx)

Measures whether the assistant stayed in character across every turn against a defined persona.

**Config**

- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
aiMemory ────────────┐
aiLanguageModel ─────┼── [ Role Adherence ] ──┬── score
                     │                        ├── reason
                     │                        └── success
```

Connect the same Memory as AI Agent.

`chatbotRole` is set in Config or supplied as an item field.

##### [Knowledge Retention](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28multi-turn%29/metrics-knowledge-retention.mdx)

Detects when the bot forgets facts the user already provided earlier in the conversation.

**Config**

- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
aiMemory ────────────┐
aiLanguageModel ─────┼── [ Knowledge Retention ] ──┬── score
                     │                             ├── reason
                     │                             └── success
```

Connect the same Memory as AI Agent.

##### [Conversation Completeness](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28multi-turn%29/metrics-conversation-completeness.mdx)

Checks whether all user intentions raised in the dialogue were satisfied by the assistant.

**Config**

- `windowSize` — intent-window size (default `3`)
- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
aiMemory ────────────┐
aiLanguageModel ─────┼── [ Conversation Completeness ] ──┬── score
                     │                                   ├── reason
                     │                                   └── success
```

Connect the same Memory as AI Agent.

##### [Goal Accuracy](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28multi-turn%29/metrics-goal-accuracy.mdx)

Evaluates whether the agent reached the user's goal and how well its plan and steps supported that outcome.

**Config**

- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
aiMemory ────────────┐
aiLanguageModel ─────┼── [ Goal Accuracy ] ──┬── score
                     │                       ├── reason
                     │                       └── success
```

Connect the same Memory as AI Agent.

Also connect **AI Agent** on main (with **Return Intermediate Steps**) to enrich turns with `tools_called` from `intermediateSteps`.

##### [Tool Use](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28multi-turn%29/metrics-tool-use.mdx)

Scores tool selection and argument correctness per interaction against available tools.

**Config**

- `availableTools` (required) — tool catalog for selection and argument judging per interaction
- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
aiMemory ────────────┐
aiLanguageModel ─────┼── [ Tool Use ] ──┬── score
                     │                  ├── reason
                     │                  └── success
```

Connect the same Memory as AI Agent.

Also connect **AI Agent** on main (with **Return Intermediate Steps**) to enrich turns with `tools_called` from `intermediateSteps`. `availableTools` is required in Config.

##### [Topic Adherence](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28multi-turn%29/metrics-topic-adherence.mdx)

Penalizes answers to off-topic questions and rewards correct refusals when a question is outside allowed topics.

**Config**

- `relevantTopics` (required) — allowed topic list for TP/TN/FP/FN classification
- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
aiMemory ────────────┐
aiLanguageModel ─────┼── [ Topic Adherence ] ──┬── score
                     │                         ├── reason
                     │                         └── success
```

Connect the same Memory as AI Agent.

##### [Turn Faithfulness](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28multi-turn%29/metrics-turn-faithfulness.mdx)

Verifies assistant claims are grounded in `retrievalContext` attached to turns (RAG chatbots).

**Config**

- `windowSize` — sliding window over turns (default `10`)
- `truthsExtractionLimit` — cap truths extracted from `retrievalContext` per window
- `penalizeAmbiguousClaims` — penalize `idk` verdicts on claims (default `false`)
- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
aiMemory ────────────┐
aiLanguageModel ─────┼── [ Turn Faithfulness ] ──┬── score
                     │                           ├── reason
                     │                           └── success
```

Connect the same Memory as AI Agent.

Per-turn `retrievalContext` may be set in Config or supplied on turns built from Memory.

##### [Turn Contextual Precision](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28multi-turn%29/metrics-turn-contextual-precision.mdx)

Measures whether relevant retrieval nodes are ranked above irrelevant ones per turn against an expected outcome.

**Config**

- `windowSize` — sliding window over turns (default `10`)
- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
aiMemory ────────────┐
aiLanguageModel ─────┼── [ Turn Contextual Precision ] ──┬── score
                     │                                   ├── reason
                     │                                   └── success
```

Connect the same Memory as AI Agent.

`expectedOutcome` is Config or an item field.

##### [Turn Contextual Recall](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28multi-turn%29/metrics-turn-contextual-recall.mdx)

Checks whether retrieved context per turn contains enough information to support the expected outcome.

**Config**

- `windowSize` — sliding window over turns (default `10`)
- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
aiMemory ────────────┐
aiLanguageModel ─────┼── [ Turn Contextual Recall ] ──┬── score
                     │                                ├── reason
                     │                                └── success
```

Connect the same Memory as AI Agent.

`expectedOutcome` is Config or an item field.

##### [Turn Contextual Relevancy](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28multi-turn%29/metrics-turn-contextual-relevancy.mdx)

Measures signal-to-noise in each turn's `retrievalContext` relative to the user's input.

**Config**

- `windowSize` — sliding window over turns (default `10`)
- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
aiMemory ────────────┐
aiLanguageModel ─────┼── [ Turn Contextual Relevancy ] ──┬── score
                     │                                   ├── reason
                     │                                   └── success
```

Connect the same Memory as AI Agent.

#### Safety

Safety metrics flag harmful or policy-violating outputs. Supply `input` and `actualOutput` on the **main** connection from any upstream node (typically an LLM or AI Agent).

##### [Bias](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28safety%29/metrics-bias.mdx)

Detects gender, racial, political, or geographical bias in opinions expressed in the output. Lower scores are safer; `success` when `score <= threshold`.

**Config**

- `threshold` — pass cutoff; `success` when `score <= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `0`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
input ─────────────┐
actualOutput ──────┼── [ Bias ] ──┬── score
aiLanguageModel ───┘              ├── reason
                                  └── success
```

##### [Toxicity](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28safety%29/metrics-toxicity.mdx)

Flags toxic opinions (attacks, mockery, hate, threats). Lower scores are safer; `success` when `score <= threshold`.

**Config**

- `threshold` — pass cutoff; `success` when `score <= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `0`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
input ─────────────┐
actualOutput ──────┼── [ Toxicity ] ──┬── score
aiLanguageModel ───┘                  ├── reason
                                      └── success
```

##### [Non-Advice](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28safety%29/metrics-non-advice.mdx)

Detects inappropriate professional advice (financial, medical, legal, and so on) that should be deferred to licensed experts.

**Config**

- `adviceTypes` (required) — prohibited advice categories (e.g. `financial`, `medical`, `legal`)
- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
input ─────────────┐
actualOutput ──────┼── [ Non-Advice ] ──┬── score
aiLanguageModel ───┘                    ├── reason
                                        └── success
```

##### [Misuse](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28safety%29/metrics-misuse.mdx)

Flags when a domain-specific bot answers off-topic or general-knowledge requests outside its scope.

**Config**

- `domain` (required) — bot's allowed domain (e.g. `financial`)
- `threshold` — pass cutoff; `success` when `score <= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `0`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
input ─────────────┐
actualOutput ──────┼── [ Misuse ] ──┬── score
aiLanguageModel ───┘                ├── reason
                                    └── success
```

##### [PII Leakage](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28safety%29/metrics-pii-leakage.mdx)

Detects personally identifiable information exposed in the output (names, financial, medical, government IDs, and so on).

**Config**

- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
input ─────────────┐
actualOutput ──────┼── [ PII Leakage ] ──┬── score
aiLanguageModel ───┘                     ├── reason
                                         └── success
```

##### [Role Violation](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28safety%29/metrics-role-violation.mdx)

Binary check for a single-turn output breaking the assigned role or persona (breaking character, policy violations, and so on). Score is higher-is-safer: `1.0` when no violation, `0.0` when any violation is detected.

**Config**

- `role` (required) — expected persona (e.g. `helpful assistant`)
- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1` (pass only on a perfect `1.0` score)
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

Upstream DeepEval docs describe `strictMode` inconsistently (Bias-style “0 for perfection” vs higher-is-safer FAQ). This node follows higher-is-safer semantics and pins `strictMode` to threshold `1` accordingly.

```text
input ─────────────┐
actualOutput ──────┼── [ Role Violation ] ──┬── score
aiLanguageModel ───┘                        ├── reason
                                            └── success
```

#### Others

General-purpose metrics for summarization, prompt compliance, and factual grounding.

##### [Summarization](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28metrics-others%29/metrics-summarization.mdx)

Scores whether a summary is factually aligned with the source and covers required details (alignment + coverage).

**Config**

- `n` — number of auto-generated assessment questions when `assessmentQuestions` is not set (default `5`)
- `assessmentQuestions` — custom coverage questions; skips auto-generation
- `truthsExtractionLimit` — cap source truths for alignment check
- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
input ─────────────┐
actualOutput ──────┼── [ Summarization ] ──┬── score
aiLanguageModel ───┘                       ├── reason
                                           └── success
```

##### [Prompt Alignment](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28metrics-others%29/metrics-prompt-alignment.mdx)

Checks whether the output follows each instruction listed in your prompt template.

**Config**

- `promptInstructions` (required) — instructions from the prompt template to check compliance against
- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
input ─────────────┐
actualOutput ──────┼── [ Prompt Alignment ] ──┬── score
aiLanguageModel ───┘                          ├── reason
                                              └── success
```

##### [Hallucination](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28metrics-others%29/metrics-hallucination.mdx)

Measures contradictions between the output and ground-truth `context`. Lower scores are better; `success` when `score <= threshold`.

**Config**

- `threshold` — pass cutoff; `success` when `score <= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `0`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
input ─────────────┐
actualOutput ──────┤
context ───────────┼── [ Hallucination ] ──┬── score
aiLanguageModel ───┘                       ├── reason
                                           └── success
```

#### Community

Community metrics are contributed DeepEval extensions. **Citation Faithfulness** imports from `deepeval.metrics.community`. **Agent Loop Detection** and **Tool Permission** are grouped here for product navigation; with the pinned runtime ([deep-eval-web](https://github.com/3p3r/deep-eval-web) / deepeval `v4.0.7`), import paths may be `deepeval.metrics.community` or `deepeval.metrics` depending on the wheel build — the node resolves the correct class at runtime.

##### [Citation Faithfulness](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28community%29/metrics-citation-faithfulness.mdx)

Stricter than Faithfulness: every `[N]` citation in the output must point to the passage that actually supports that claim.

**Config**

- `threshold` — pass cutoff; `success` when `score >= threshold` (default `1.0`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
input ─────────────┐
actualOutput ──────┤
retrievalContext ──┼── [ Citation Faithfulness ] ───┬── score
aiLanguageModel ───┘                                ├── reason
                                                    └── success
```

##### [Agent Loop Detection](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28community%29/metrics-agent-loop-detection.mdx)

Deterministic detection of infinite loops in an agent trace (tool repetition, reasoning stagnation, call-graph cycles). No LLM required.

**Config**

- `repetitionThreshold` — identical tool-call count before repetition penalty (default `3`)
- `similarityThreshold` — reasoning stagnation similarity cutoff (default `0.85`)
- `checkToolRepetition` — enable tool-repetition sub-signal (default `true`)
- `checkReasoningStagnation` — enable reasoning stagnation check (default `true`)
- `checkCallGraphCycles` — enable call-graph cycle detection (default `true`)
- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `verboseMode` — print intermediate steps to console

```text
input ─────────────┐
output ────────────┤
intermediateSteps ─┼──► [ Agent Loop Detection ] ──┬── score
                   │                               ├── reason
                   │                               └── success
```

Trace-only and deterministic. Maps `intermediateSteps` to a synthetic DeepEval trace. No Language Model sub-node. Fails clearly if intermediate steps are missing.

##### [Tool Permission](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28community%29/metrics-tool-permission.mdx)

Enforces least privilege: flags any tool call outside an allowlist or on a denylist. Deterministic; no LLM required.

**Config**

- `allowedTools` — allowlist (least privilege); at least one of `allowedTools` or `deniedTools` is required
- `deniedTools` — denylist (deny wins over allow)
- `threshold` — pass cutoff; `success` when `score >= threshold` (default `1.0`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `verboseMode` — print intermediate steps to console

```text
input ─────────────┐
intermediateSteps ─┼──► [ Tool Permission ] ──┬── score
                   │                          ├── reason
                   │                          └── success
```

Maps `intermediateSteps` → DeepEval `tools_called`. No Language Model sub-node. No `asyncMode` (deterministic, synchronous in DeepEval).

### DeepEval Aggregate

Fan-in transformer for an evaluation branch. It collects normalized metric results,
computes the overall score and success state, and prepares a row for n8n's official Data
Table node. The importable example persists that row with
`DeepEval Aggregate → Data Table (Insert)`.

**Config**

- `dataTableId` — sink table identity included in the output
- `writeMode` — intended downstream persistence mode
- output column names for run ID, score, success, and serialized metrics
- `metrics` — which incoming metric nodes to include (`allConnected` or explicit list)
- `passRule` — overall `success` rule (`allPass`, `anyFail`, and so on)

```text
metricA {score,reason,success} ──┐
metricB {score,reason,success} ──┼── [ DeepEval Aggregate ] ──► [ Data Table: Insert ]
metricN {score,reason,success} ──┘             │
                                               ├── overall score / success
                                               └── per-metric fields
```

#### Sinks

This pass supports n8n Data Tables only, through the built-in Data Table node connected
after Aggregate. Google Sheets and Excel sinks are deferred.

#### Typical wiring

**Batch eval** (dataset-driven):

```text
[Data Table: Get] ──► [DeepEval Trigger] ──┐
                                           ├──► [merge] ──► [AI Agent] ──► branch on isEvalRun
[Chat / Webhook] ──────────────────────────┘                                 │
                                                                             ├─ prod → downstream
                                                                             └─ eval → [metric…] ──► [Aggregate] ──► [Data Table: Insert]
```

**Live chat eval** (conversational metrics — Memory required):

```text
[Chat Trigger] ──main──► [AI Agent] ──main──► [conversational metric…] ──► [DeepEval Aggregate] ──► sink

[Simple Memory] ──ai_memory──► [AI Agent]
              └─ai_memory──► [conversational metric…]

[Judge Language Model] ──aiLanguageModel──► [conversational metric…]
```

Connect the **same Memory** sub-node to AI Agent and to each conversational / turn-based metric. Enable **Return Intermediate Steps** on AI Agent when using Goal Accuracy, Tool Use, or other metrics that enrich turns from `intermediateSteps`.
