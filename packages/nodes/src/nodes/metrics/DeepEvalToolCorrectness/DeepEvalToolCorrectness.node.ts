import { createMetricNode } from '../../../shared/create-metric-node.js';
import { getMetricDefinition } from '../../../shared/metric-definitions.js';

const MetricNode = createMetricNode(getMetricDefinition('toolCorrectness'));

export class DeepEvalToolCorrectness extends MetricNode {}
