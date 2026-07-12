import { createMetricNode } from '../../../shared/create-metric-node.js';
import { getMetricDefinition } from '../../../shared/metric-definitions.js';

const MetricNode = createMetricNode(getMetricDefinition('roleAdherence'));

export class DeepEvalRoleAdherence extends MetricNode {}
