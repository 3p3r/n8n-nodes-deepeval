import {
  coefficientOfVariation,
  max,
  mean,
  min,
  standardDeviation,
  variance,
} from 'simple-statistics';

export interface MetricResult {
  metric: string;
  score: number;
  reason: string | null;
  success: boolean;
}

export interface PerMetricStats {
  metric: string;
  runCount: number;
  mean: number;
  std: number;
  variance: number;
  min: number;
  max: number;
  cv: number;
  passRate: number;
  majoritySuccess: boolean;
}

export interface AggregateRun {
  score: number;
  success: boolean;
  metrics: MetricResult[];
  evalContext: Record<string, unknown>;
  json: Record<string, unknown>;
}

export interface CaseConsistency {
  caseId: string;
  runCount: number;
  meanScore: number;
  scoreStd: number;
  scoreCv: number;
  overallConsistency: number;
  perMetric: PerMetricStats[];
  labelDistribution?: Map<string, number>;
  labelEntropy?: number;
  labelNormalizedEntropy?: number;
  majorityLabel?: string | null;
  agreement?: number;
}

export type ConsistencyBasis = 'entropy' | 'cv' | 'agreement';

export function labelDistribution(labels: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const label of labels) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return counts;
}

export function shannonEntropy(counts: number[]): number {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total === 0) {
    return 0;
  }
  let entropy = 0;
  for (const count of counts) {
    if (count === 0) {
      continue;
    }
    const probability = count / total;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

export function normalizedEntropy(counts: number[]): number {
  const distinct = counts.filter((count) => count > 0).length;
  if (distinct <= 1) {
    return 0;
  }
  return shannonEntropy(counts) / Math.log2(distinct);
}

export function agreementRate(labels: string[]): number {
  if (labels.length === 0) {
    return 0;
  }
  const counts = labelDistribution(labels);
  const modalCount = Math.max(...counts.values());
  return modalCount / labels.length;
}

export function majorityLabel(labels: string[]): string | null {
  if (labels.length === 0) {
    return null;
  }
  const counts = labelDistribution(labels);
  let winner: string | null = null;
  let winnerCount = -1;
  for (const [label, count] of counts) {
    if (count > winnerCount) {
      winner = label;
      winnerCount = count;
    }
  }
  return winner;
}

function scoreStats(scores: number[]): {
  meanScore: number;
  scoreStd: number;
  scoreVariance: number;
  scoreCv: number;
} {
  const meanScore = mean(scores);
  const scoreVariance = variance(scores);
  const scoreStd = standardDeviation(scores);
  const scoreCv = meanScore === 0 ? 0 : coefficientOfVariation(scores);
  return { meanScore, scoreStd, scoreVariance, scoreCv };
}

export function aggregatePerMetric(metricRuns: MetricResult[][]): PerMetricStats[] {
  const byMetric = new Map<string, MetricResult[]>();
  for (const run of metricRuns) {
    for (const metric of run) {
      const bucket = byMetric.get(metric.metric) ?? [];
      bucket.push(metric);
      byMetric.set(metric.metric, bucket);
    }
  }

  return [...byMetric.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([metricName, results]) => {
      const scores = results.map((result) => result.score);
      const passCount = results.filter((result) => result.success).length;
      const metricMean = mean(scores);
      const metricVariance = variance(scores);
      const metricStd = standardDeviation(scores);
      const metricCv = metricMean === 0 ? 0 : coefficientOfVariation(scores);
      const passRate = passCount / results.length;
      return {
        metric: metricName,
        runCount: results.length,
        mean: metricMean,
        std: metricStd,
        variance: metricVariance,
        min: min(scores),
        max: max(scores),
        cv: metricCv,
        passRate,
        majoritySuccess: passRate > 0.5,
      };
    });
}

function resolveLabel(json: Record<string, unknown>, labelField: string): string {
  const segments = labelField.split('.');
  let current: unknown = json;
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      throw new Error(`Label field "${labelField}" could not be resolved`);
    }
    current = (current as Record<string, unknown>)[segment];
  }
  if (typeof current !== 'string' && typeof current !== 'number' && typeof current !== 'boolean') {
    throw new Error(`Label field "${labelField}" must resolve to a scalar value`);
  }
  return String(current);
}

function overallConsistencyFromCv(perMetric: PerMetricStats[]): number {
  if (perMetric.length === 0) {
    return 0;
  }
  const meanCv = mean(perMetric.map((stats) => stats.cv));
  return 1 - Math.min(1, meanCv);
}

export function computeCaseConsistency(
  runs: AggregateRun[],
  opts: { labelField: string; consistencyBasis: ConsistencyBasis },
): CaseConsistency {
  if (runs.length === 0) {
    throw new Error('At least one aggregate run is required');
  }

  const firstRun = runs[0];
  if (!firstRun) {
    throw new Error('At least one aggregate run is required');
  }

  const caseId = firstRun.evalContext.caseId;
  if (typeof caseId !== 'string' || caseId.length === 0) {
    throw new Error('evalContext.caseId is required on every aggregate run');
  }
  for (const run of runs) {
    if (run.evalContext.caseId !== caseId) {
      throw new Error('All aggregate runs in a case must share the same evalContext.caseId');
    }
  }

  const scores = runs.map((run) => run.score);
  const { meanScore, scoreStd, scoreCv } = scoreStats(scores);
  const perMetric = aggregatePerMetric(runs.map((run) => run.metrics));

  const result: CaseConsistency = {
    caseId,
    runCount: runs.length,
    meanScore,
    scoreStd,
    scoreCv,
    overallConsistency: 0,
    perMetric,
  };

  if (opts.consistencyBasis === 'cv') {
    result.overallConsistency = overallConsistencyFromCv(perMetric);
    return result;
  }

  if (!opts.labelField) {
    throw new Error(`consistencyBasis "${opts.consistencyBasis}" requires a non-empty labelField`);
  }

  const labels = runs.map((run) => resolveLabel(run.json, opts.labelField));
  const distribution = labelDistribution(labels);
  const counts = [...distribution.values()];
  const labelEntropy = shannonEntropy(counts);
  const labelNormalizedEntropy = normalizedEntropy(counts);
  const agreement = agreementRate(labels);

  result.labelDistribution = distribution;
  result.labelEntropy = labelEntropy;
  result.labelNormalizedEntropy = labelNormalizedEntropy;
  result.majorityLabel = majorityLabel(labels);
  result.agreement = agreement;
  result.overallConsistency =
    opts.consistencyBasis === 'entropy' ? 1 - labelNormalizedEntropy : agreement;

  return result;
}
