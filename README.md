# n8n-nodes-deepeval

n8n community evaluation node powered by the deepeval framework.

- [n8n-nodes-deepeval](#n8n-nodes-deepeval)
  - [Synopsis](#synopsis)
  - [Architecture](#architecture)
    - [Required N8N Nodes](#required-n8n-nodes)
    - [Optional Dashboard](#optional-dashboard)
  - [Available Nodes](#available-nodes)
    - [DeepEval Trigger](#deepeval-trigger)
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
  - [Sources and Sinks](#sources-and-sinks)
    - [Available Data Sources](#available-data-sources)
      - [Data Tables](#data-tables)
      - [Google Sheets](#google-sheets)
      - [Excel Sheets](#excel-sheets)
    - [Available Data Sinks](#available-data-sinks)
      - [Data Tables](#data-tables-1)
      - [Google Sheets](#google-sheets-1)
      - [Excel Sheets](#excel-sheets-1)

## Synopsis

This is a collection of [N8N](https://github.com/n8n-io/n8n) nodes, designed to deeply integrate [DeepEval](https://github.com/confident-ai/deepeval) into its workflows.

## Architecture

DeepEval in this project is executed inline and through [Pyodide](https://github.com/pyodide/pyodide). At a high level, there are two moving parts to this project:

### Required N8N Nodes

Offered as N8N community nodes, these are the core components that allow you to integrate DeepEval into your N8N workflows. They are designed to be flexible and easy to use, enabling you to evaluate various data types and models directly within your N8N environment.

### Optional Dashboard

Offered as N8N hooks for both the frontend and backend, this dashboard provides a user-friendly interface for managing and visualizing your DeepEval benchmarks. It allows you to monitor the performance of your models, view evaluation results, and configure evaluation parameters without needing to dive into the underlying code.

All nodes optionally communicate with the backend hook to record their workflow and evaluation results, which can then be visualized in the dashboard. The dashboard injects itself into the N8N frontend, providing a seamless experience for users who want to manage their DeepEval evaluations in a more interactive way.

Individual views for evaluation results are inferred from sources and sinks and are visualized via Refine's [Inferencer](https://refine.dev/core/docs/packages/inferencer) package. Evaluations for the dashboard are recorded automatically and do not require any additional configuration. The aggregate node can be used to combine multiple evaluation results into a single view, providing a comprehensive overview of your model's performance across different metrics and data sources.

## Available Nodes

Metric nodes mirror the [DeepEval Eval Metrics](https://deepeval.com/docs/metrics-introduction) sidebar: **Custom**, **Agentic**, **Multi-Turn**, **Safety**, **Others**, and **Community** (MCP, Images, and RAG are not included). Each metric node wires into n8n in one ergonomic way: **Chat Trigger** for conversations, **AI Agent** for agent runs, or item fields (`input`, `actualOutput`, …) for evaluation data. LLM-judge metrics also accept a **Language Model** connection — the same n8n AI model sub-nodes used by AI Agent (OpenAI, Anthropic, and so on). Remaining DeepEval constructor options (`threshold`, `criteria`, allowlists, and so on) appear as **Config** on the node UI.

### DeepEval Trigger

Starts an evaluation workflow and supplies the run context for downstream metric nodes.

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
chatTrigger ───────┐
aiLanguageModel ───┼── [ Conversational G-Eval ] ──┬── score
                   │                               ├── reason
                   │                               └── success
```

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
chatTrigger ───────┐
aiLanguageModel ───┼── [ Conversational DAG ] ───┬── score
                   │                             ├── reason
                   │                             └── success
```

#### Agentic

Agentic metrics evaluate LLM agent execution. Wire the **AI Agent** node as input; the metric derives trace, tool calls, and outputs from the agent run.

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
aiAgent ───────────┐
aiLanguageModel ───┼── [ Task Completion ] ───┬── score
                   │                          ├── reason
                   │                          └── success
```

##### [Step Efficiency](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28agentic%29/metrics-step-efficiency.mdx)

Measures how efficiently the agent completed the task, penalizing unnecessary steps, retries, and detours in the trace.

**Config**

- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
aiAgent ───────────┐
aiLanguageModel ───┼── [ Step Efficiency ] ───┬── score
                   │                          ├── reason
                   │                          └── success
```

##### [Argument Correctness](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28agentic%29/metrics-argument-correctness.mdx)

Checks whether each tool call received correct arguments for the user request (referenceless LLM judge).

**Config**

- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
aiAgent ───────────┐
aiLanguageModel ───┼── [ Argument Correctness ] ───┬── score
                   │                               ├── reason
                   │                               └── success
```

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
aiAgent ───────────┐
expectedTools ─────┤
aiLanguageModel ───┼── [ Tool Correctness ] ──┬── score
                   │                          ├── reason
                   │                          └── success
```

##### [Plan Adherence](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28agentic%29/metrics-plan-adherence.mdx)

Scores how closely the agent's execution followed the plan inferred from its reasoning in the trace.

**Config**

- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
aiAgent ───────────┐
aiLanguageModel ───┼── [ Plan Adherence ] ──┬── score
                   │                        ├── reason
                   │                        └── success
```

##### [Plan Quality](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28agentic%29/metrics-plan-quality.mdx)

Scores the quality of the plan itself (task vs. plan alignment), independent of whether execution stuck to it.

**Config**

- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
aiAgent ───────────┐
aiLanguageModel ───┼── [ Plan Quality ] ──┬── score
                   │                      ├── reason
                   │                      └── success
```

#### Multi-Turn

Multi-turn metrics evaluate chatbots over a full conversation. Wire the **Chat Trigger** node as input; metrics map its session to DeepEval `turns`. **Goal Accuracy** and **Tool Use** also require the **AI Agent** node for agent tool and planning context.

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
chatTrigger ───────┐
aiLanguageModel ───┼── [ Turn Relevancy ] ──┬── score
                   │                        ├── reason
                   │                        └── success
```

##### [Role Adherence](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28multi-turn%29/metrics-role-adherence.mdx)

Measures whether the assistant stayed in character across every turn against a defined persona.

**Config**

- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
chatTrigger ───────┐
chatbotRole ───────┤
aiLanguageModel ───┼── [ Role Adherence ] ──┬── score
                   │                        ├── reason
                   │                        └── success
```

##### [Knowledge Retention](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28multi-turn%29/metrics-knowledge-retention.mdx)

Detects when the bot forgets facts the user already provided earlier in the conversation.

**Config**

- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
chatTrigger ───────┐
aiLanguageModel ───┼── [ Knowledge Retention ] ───┬── score
                   │                              ├── reason
                   │                              └── success
```

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
chatTrigger ───────┐
aiLanguageModel ───┼── [ Conversation Completeness ] ──┬── score
                   │                                   ├── reason
                   │                                   └── success
```

##### [Goal Accuracy](https://github.com/confident-ai/deepeval/blob/main/docs/content/docs/%28multi-turn%29/metrics-goal-accuracy.mdx)

Evaluates whether the agent reached the user's goal and how well its plan and steps supported that outcome.

**Config**

- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `1`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

```text
chatTrigger ───────┐
aiAgent ───────────┤
aiLanguageModel ───┼── [ Goal Accuracy ] ──┬── score
                   │                       ├── reason
                   │                       └── success
```

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
chatTrigger ───────┐
aiAgent ───────────┤
aiLanguageModel ───┼── [ Tool Use ] ──┬── score
                   │                  ├── reason
                   │                  └── success
```

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
chatTrigger ───────┐
aiLanguageModel ───┼── [ Topic Adherence ] ──┬── score
                   │                         ├── reason
                   │                         └── success
```

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
chatTrigger ───────┐
aiLanguageModel ───┼── [ Turn Faithfulness ] ──┬── score
                   │                           ├── reason
                   │                           └── success
```

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
chatTrigger ───────┐
expectedOutcome ───┤
aiLanguageModel ───┼── [ Turn Contextual Precision ] ──┬── score
                   │                                   ├── reason
                   │                                   └── success
```

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
chatTrigger ───────┐
expectedOutcome ───┤
aiLanguageModel ───┼── [ Turn Contextual Recall ] ──┬── score
                   │                                ├── reason
                   │                                └── success
```

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
chatTrigger ───────┐
aiLanguageModel ───┼── [ Turn Contextual Relevancy ] ──┬── score
                   │                                   ├── reason
                   │                                   └── success
```

#### Safety

Safety metrics flag harmful or policy-violating outputs. Wire `input` and `actualOutput` from any upstream node (typically an LLM or AI Agent).

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

Binary check for a single-turn output breaking the assigned role or persona (breaking character, policy violations, and so on).

**Config**

- `role` (required) — expected persona (e.g. `helpful assistant`)
- `threshold` — pass cutoff; `success` when `score >= threshold` (default `0.5`)
- `includeReason` — whether to generate a human-readable `reason` (default `true`)
- `strictMode` — binary 1/0 scoring; forces threshold to `0`
- `asyncMode` — run internal LLM calls concurrently (default `true`)
- `verboseMode` — print intermediate steps to console

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

Community metrics live in `deepeval.metrics.community` and are contributed extensions with a faster iteration cycle.

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
aiAgent ──┼── [ Agent Loop Detection ] ──┬── score
          │                              ├── reason
          │                              └── success
```

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
aiAgent ──┼── [ Tool Permission ] ──┬── score
          │                         ├── reason
          │                         └── success
```

### DeepEval Aggregate

Combines multiple metric results from a workflow into a single aggregated view for reporting and dashboard visualization.

## Sources and Sinks

The primary way to read ground truth data and write evaluation results is through the builtin [N8N Data Tables](https://docs.n8n.io/build/work-with-data/data-tables) feature. Alternatively, additional sinks and sources can be added through the N8N node system, allowing for greater flexibility in how you manage your data.

### Available Data Sources

#### Data Tables
#### Google Sheets
#### Excel Sheets

### Available Data Sinks

#### Data Tables
#### Google Sheets
#### Excel Sheets
