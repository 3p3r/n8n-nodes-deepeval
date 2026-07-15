export const PYTHON_BRIDGE = `
import importlib
import json
import os

os.environ.setdefault("DEEPEVAL_TELEMETRY_OPT_OUT", "1")
os.environ.setdefault("DEEPEVAL_DISABLE_DOTENV", "1")
os.environ.setdefault("DEEPEVAL_DISABLE_TIMEOUTS", "1")

from deepeval.models import DeepEvalBaseLLM
from deepeval.test_case import (
    ConversationalTestCase,
    LLMTestCase,
    MultiTurnParams,
    SingleTurnParams,
    ToolCall,
    ToolCallParams,
    Turn,
)


class N8nJudgeModel(DeepEvalBaseLLM):
    def load_model(self, *args, **kwargs):
        return self

    def get_model_name(self, *args, **kwargs):
        return "n8n connected language model"

    def generate(self, prompt, schema=None, *args, **kwargs):
        raise RuntimeError("n8n language models are asynchronous")

    def _salvage_json_text(self, text):
        import re

        score = re.search(r'"score"s*:s*([-+]?[0-9]*.?[0-9]+)', text)
        if score is None:
            return None
        reason = re.search(r'"reason"s*:s*"(.*?)"s*[,}]', text, re.DOTALL)
        payload = {"score": float(score.group(1)), "reason": ""}
        if reason is not None:
            payload["reason"] = reason.group(1).replace("\\n", " ").replace("\\r", " ")
        return payload

    def _repair_invalid_escapes(self, blob):
        out = []
        in_string = False
        escape = False
        for char in blob:
            if escape:
                if char in ('"', '\\\\', '/', 'b', 'f', 'n', 'r', 't', 'u'):
                    out.append('\\\\')
                    out.append(char)
                else:
                    out.append('\\\\\\\\')
                    out.append(char)
                escape = False
                continue
            if char == "\\\\" and in_string:
                escape = True
                continue
            if char == '"':
                in_string = not in_string
                out.append(char)
                continue
            out.append(char)
        return "".join(out)

    def _load_json_text(self, text):
        from deepeval.metrics.utils import trimAndLoadJson

        try:
            return trimAndLoadJson(text)
        except ValueError:
            start = text.find("{")
            end = text.rfind("}") + 1
            blob = text[start:end]
            fixed = []
            in_string = False
            escape = False
            for char in blob:
                if escape:
                    fixed.append(char)
                    escape = False
                    continue
                if char == "\\\\" and in_string:
                    fixed.append(char)
                    escape = True
                    continue
                if char == '"':
                    in_string = not in_string
                    fixed.append(char)
                    continue
                if in_string and char == "\\n":
                    fixed.append("\\\\n")
                    continue
                if in_string and char == "\\r":
                    fixed.append("\\\\r")
                    continue
                if not in_string and ord(char) < 32 and char not in "\\n\\r\\t":
                    continue
                fixed.append(char)
            repaired = "".join(fixed)
            try:
                return json.loads(repaired)
            except json.JSONDecodeError:
                try:
                    return json.loads(self._repair_invalid_escapes(repaired))
                except json.JSONDecodeError:
                    salvaged = self._salvage_json_text(text)
                    if salvaged is None:
                        raise
                    return salvaged

    async def a_generate(self, prompt, schema=None, *args, **kwargs):
        schema_json = None
        if schema is not None and hasattr(schema, "model_json_schema"):
            schema_json = json.dumps(schema.model_json_schema())
        text = str(await globals()["__deepeval_judge"](str(prompt), schema_json))
        if schema is not None and hasattr(schema, "model_validate"):
            return schema.model_validate(self._load_json_text(text))
        return text


def _tool_call(value):
    if isinstance(value, ToolCall):
        return value
    value = value or {}
    return ToolCall(
        name=str(value.get("name", "")),
        description=value.get("description"),
        reasoning=value.get("reasoning"),
        input_parameters=value.get("inputParameters") or value.get("input_parameters"),
        output=value.get("output"),
    )


def _turn(value):
    return Turn(
        role=value["role"],
        content=str(value.get("content", "")),
        retrieval_context=value.get("retrievalContext"),
        tools_called=[_tool_call(item) for item in value.get("toolsCalled", [])] or None,
        metadata=value.get("metadata"),
    )


def _single_params(values):
    return [SingleTurnParams[str(value).upper()] for value in values]


def _multi_params(values):
    return [MultiTurnParams[str(value).upper()] for value in values]


def _prepare_config(metric_id, config, requires_model):
    config = dict(config)
    config.pop("async_mode", None)
    if metric_id != "toolPermission":
        config["async_mode"] = True

    if requires_model:
        config["model"] = N8nJudgeModel()

    if "evaluation_params" in config:
        if metric_id == "toolCorrectness":
            config["evaluation_params"] = [
                ToolCallParams[str(value).upper()] for value in config["evaluation_params"]
            ]
        elif metric_id in ("conversationalGEval",):
            config["evaluation_params"] = _multi_params(config["evaluation_params"])
        else:
            config["evaluation_params"] = _single_params(config["evaluation_params"])

    if "rubric" in config and config["rubric"]:
        from deepeval.metrics.g_eval.utils import Rubric
        config["rubric"] = [
            Rubric(
                score_range=tuple(item.get("scoreRange") or item.get("score_range")),
                expected_outcome=item.get("expectedOutcome") or item.get("expected_outcome"),
            )
            for item in config["rubric"]
        ]

    for key in ("available_tools",):
        if key in config and config[key]:
            config[key] = [_tool_call(item) for item in config[key]]

    if metric_id in ("dag", "conversationalDAG") and "dag" in config:
        from deepeval.metrics import DeepAcyclicGraph
        config["dag"] = DeepAcyclicGraph.from_dict(
            config["dag"], multiturn=metric_id == "conversationalDAG"
        )

    return {key: value for key, value in config.items() if value is not None}


def _build_test_case(request):
    value = request["testCase"]
    if value.get("turns") is not None:
        return ConversationalTestCase(
            turns=[_turn(item) for item in value["turns"]],
            scenario=value.get("scenario"),
            context=value.get("context"),
            expected_outcome=value.get("expectedOutcome"),
            chatbot_role=value.get("chatbotRole"),
            metadata=value.get("metadata"),
        )

    test_case = LLMTestCase(
        input=str(value.get("input") or ""),
        actual_output=value.get("actualOutput"),
        expected_output=value.get("expectedOutput"),
        context=value.get("context"),
        retrieval_context=value.get("retrievalContext"),
        tools_called=[_tool_call(item) for item in value.get("toolsCalled", [])] or None,
        expected_tools=[_tool_call(item) for item in value.get("expectedTools", [])] or None,
        metadata=value.get("metadata"),
    )
    if value.get("trace") is not None:
        test_case._trace_dict = value["trace"]
    return test_case


def reset_deepeval_session():
  import sys

  for name in list(globals().keys()):
    if name.startswith("__deepeval_"):
      globals().pop(name, None)

  try:
    from deepeval.tracing import tracing

    manager = getattr(tracing, "trace_manager", None)
    if manager is not None:
      for attr in ("active_traces", "active_spans", "traces"):
        value = getattr(manager, attr, None)
        if hasattr(value, "clear"):
          value.clear()
      for attr in ("eval_session", "current_trace", "current_span"):
        if hasattr(manager, attr):
          try:
            setattr(manager, attr, None)
          except Exception:
            pass
  except Exception:
    pass

  for module_name in ("deepeval.tracing.tracing", "deepeval.tracing.context"):
    module = sys.modules.get(module_name)
    if module is None:
      continue
    for attr in (
      "current_span_context",
      "current_trace_context",
      "CURRENT_GOLDEN",
      "current_llm_context",
      "current_agent_context",
    ):
      context_var = getattr(module, attr, None)
      if context_var is not None and hasattr(context_var, "set"):
        try:
          context_var.set(None)
        except Exception:
          pass


async def run_deepeval_request(request_json):
    request = json.loads(request_json)
    module = importlib.import_module(request["pythonImport"])
    metric_class = getattr(module, request["pythonClass"])
    config = _prepare_config(
        request["metricId"], request.get("config", {}), request.get("requiresModel", False)
    )
    metric = metric_class(**config)
    test_case = _build_test_case(request)

    try:
        await metric.a_measure(
            test_case,
            _show_indicator=False,
            _log_metric_to_confident=False,
        )
    except TypeError:
        await metric.a_measure(test_case, _show_indicator=False)

    score = float(metric.score)
    reason = getattr(metric, "reason", None)
    success = bool(metric.is_successful())
    return json.dumps(
        {
            "metric": str(metric.__name__),
            "score": score,
            "reason": None if reason is None else str(reason),
            "success": success,
        }
    )
`;
