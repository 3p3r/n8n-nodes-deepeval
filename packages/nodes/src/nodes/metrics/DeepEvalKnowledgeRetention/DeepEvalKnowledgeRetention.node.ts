import { createMetricNode } from '../../../shared/create-metric-node.js';
import { getMetricDefinition } from '../../../shared/metric-definitions.js';

const MetricNode = createMetricNode(getMetricDefinition('knowledgeRetention'));

export class DeepEvalKnowledgeRetention extends MetricNode {}
