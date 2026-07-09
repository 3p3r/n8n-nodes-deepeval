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
      - [All-Purpose Metrics](#all-purpose-metrics)
        - [G-Eval](#g-eval)
        - [DAG](#dag)
      - [Agentic Metrics](#agentic-metrics)
        - [Task Completion](#task-completion)
        - [Task Correctness](#task-correctness)
        - [Goal Accuracy](#goal-accuracy)
        - [Step Efficiency](#step-efficiency)
        - [Plan Adherence](#plan-adherence)
        - [Plan Quality](#plan-quality)
        - [Tool Use](#tool-use)
        - [Argument Correctness](#argument-correctness)
      - [Multi-Turn Metrics](#multi-turn-metrics)
        - [Knowledge Retention](#knowledge-retention)
        - [Conversation Completeness](#conversation-completeness)
        - [Turn Relevancy](#turn-relevancy)
        - [Turn Faithfulness](#turn-faithfulness)
        - [Role Adherence](#role-adherence)
      - [Other Metrics](#other-metrics)
        - [Hallucination](#hallucination)
        - [Summarization](#summarization)
        - [Bias](#bias)
        - [Toxicity](#toxicity)
        - [JSON Correctness](#json-correctness)
        - [Prompt Alignment](#prompt-alignment)
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

Currently, *All-Purpose Metrics*, *Agentic Metrics*, *Multi-Turn Metrics*, and *Other Metrics* documented in the [DeepEval documentation](https://github.com/confident-ai/deepeval/blob/main/README.md#-metrics-and-features) are available as N8N nodes. Each node corresponds to a specific evaluation metric or feature, allowing you to easily incorporate them into your workflows.

### DeepEval Trigger
### DeepEval Metrics
#### All-Purpose Metrics
##### G-Eval
##### DAG
#### Agentic Metrics
##### Task Completion
##### Task Correctness
##### Goal Accuracy
##### Step Efficiency
##### Plan Adherence
##### Plan Quality
##### Tool Use
##### Argument Correctness
#### Multi-Turn Metrics
These nodes require the N8N chat trigger node to be present in the workflow. They are designed to evaluate multi-turn interactions, providing insights into the performance of models in conversational contexts.
##### Knowledge Retention
##### Conversation Completeness
##### Turn Relevancy
##### Turn Faithfulness
##### Role Adherence
#### Other Metrics
##### Hallucination
##### Summarization
##### Bias
##### Toxicity
##### JSON Correctness
##### Prompt Alignment
### DeepEval Aggregate

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
