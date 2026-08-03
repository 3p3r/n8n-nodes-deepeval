import { PassThrough } from 'node:stream';
import archiver from 'archiver';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { AbcReport } from '../shared/types';

function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escapeCsv = (value: unknown): string => {
    const text = value === null || value === undefined ? '' : String(value);
    if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
    return text;
  };
  return [
    keys.join(','),
    ...rows.map((row) => keys.map((key) => escapeCsv(row[key])).join(',')),
  ].join('\n');
}

export async function buildReportPdf(report: AbcReport): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([612, 792]);
  let y = 750;
  const left = 50;
  const width = 512;
  const lineHeight = 12;

  const ensureSpace = (needed: number) => {
    if (y - needed < 40) {
      page = doc.addPage([612, 792]);
      y = 750;
    }
  };

  const write = (text: string, options?: { size?: number; bold?: boolean }) => {
    const size = options?.size ?? 10;
    const used = options?.bold ? bold : font;
    const words = text.split(/\s+/);
    let line = '';
    for (const word of words) {
      const next = line.length === 0 ? word : `${line} ${word}`;
      if (used.widthOfTextAtSize(next, size) > width) {
        ensureSpace(lineHeight + 2);
        page.drawText(line, { x: left, y, size, font: used, color: rgb(0.1, 0.1, 0.1) });
        y -= lineHeight + 2;
        line = word;
      } else {
        line = next;
      }
    }
    if (line.length > 0) {
      ensureSpace(lineHeight + 2);
      page.drawText(line, { x: left, y, size, font: used, color: rgb(0.1, 0.1, 0.1) });
      y -= lineHeight + 2;
    }
  };

  write('DeepEval ABC Report', { size: 18, bold: true });
  y -= 6;
  write(`Workflow: ${report.workflowName} (${report.workflowId})`);
  write(`Generated: ${report.generatedAt}`);
  write(
    `Overall ABC score: ${report.overallScore === null ? 'n/a (answer manual items)' : `${report.overallScore.toFixed(1)}%`}`,
  );
  y -= 8;

  for (const pillar of [
    report.pillars.taskValidity,
    report.pillars.outcomeValidity,
    report.pillars.benchmarkReporting,
  ]) {
    write(`${pillar.title}: ${pillar.score === null ? 'n/a' : `${pillar.score.toFixed(1)}%`}`, {
      size: 13,
      bold: true,
    });
    for (const item of pillar.items) {
      write(`[${item.status}] ${item.id} ${item.title} (${item.source}) — ${item.evidence}`);
    }
    y -= 6;
  }

  write('DeepEval metric summary', { size: 13, bold: true });
  for (const metric of report.deepeval.metrics) {
    write(
      `${metric.name}: mean=${metric.meanScore.toFixed(3)} passRate=${(metric.passRate * 100).toFixed(1)}% fails=${metric.failCount}`,
    );
  }

  if (report.deepeval.topFailures.length > 0) {
    y -= 6;
    write('Top failures', { size: 13, bold: true });
    for (const failure of report.deepeval.topFailures.slice(0, 15)) {
      write(`${failure.runId} / ${failure.metric}: ${failure.score} — ${failure.reason ?? ''}`);
    }
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

export async function buildArtifactZip(input: {
  report: AbcReport;
  sourceRows: Record<string, unknown>[];
  aggregateRows: Record<string, unknown>[];
  pdf: Buffer;
}): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    archive.on('error', reject);
    archive.pipe(stream);

    archive.append(JSON.stringify(input.sourceRows, null, 2), { name: 'input.json' });
    archive.append(rowsToCsv(input.sourceRows), { name: 'input.csv' });
    archive.append(JSON.stringify(input.aggregateRows, null, 2), { name: 'output.json' });
    archive.append(rowsToCsv(input.aggregateRows), { name: 'output.csv' });
    archive.append(JSON.stringify(input.report, null, 2), { name: 'report.json' });
    archive.append(input.pdf, { name: 'report.pdf' });
    void archive.finalize();
  });
}
