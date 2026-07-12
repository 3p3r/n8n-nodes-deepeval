import { createMetricNode } from '../../../shared/create-metric-node.js';
import { getMetricDefinition } from '../../../shared/metric-definitions.js';

const MetricNode = createMetricNode(getMetricDefinition('conversationCompleteness'));

export class DeepEvalConversationCompleteness extends MetricNode {}
