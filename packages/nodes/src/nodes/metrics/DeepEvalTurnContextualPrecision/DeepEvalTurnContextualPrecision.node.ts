import { createMetricNode } from '../../../shared/create-metric-node.js';
import { getMetricDefinition } from '../../../shared/metric-definitions.js';

const MetricNode = createMetricNode(getMetricDefinition('turnContextualPrecision'));

export class DeepEvalTurnContextualPrecision extends MetricNode {}
