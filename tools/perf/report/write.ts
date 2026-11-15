import type { AbRow, Row, RunResult } from './compare';
import { differingConditions } from './compare';

/*
 * A run as a reader takes it in: the machine and the versions first, since a
 * number means nothing without them, then a table per scenario.
 */

/** `<date>-<short commit>-<label>`, the name a run's two files share. */
export function reportName(finishedAt: string, commit: string, label: string): string {
  return `${finishedAt.slice(0, 10)}-${commit}-${label}`;
}

function shown(value: number | null, unit: string): string {
  if (value === null || Number.isNaN(value)) return '—';
  if (unit === 'B') return `${Math.round(value).toLocaleString('en-US')}`;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function percent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)} %`;
}

function header(result: RunResult, title: string): string[] {
  const conditions = result.conditions;
  return [
    `# ${title}`,
    '',
    `- **Machine**: ${conditions.machine}, ${conditions.os}`,
    `- **Versions**: Node ${conditions.node}, Electron ${conditions.electron} (Chromium ${conditions.chromium}), Chrome ${conditions.chrome}, three ${conditions.three}`,
    `- **Commit**: \`${conditions.commit}\`${conditions.trackedChanges ? ', with tracked changes' : ''}`,
    '- **Build**: the production build, run unpackaged (`npm run build`, then the Electron binary on `apps/desktop`)',
    `- **Conditions**: ${conditions.power}${conditions.lowPowerMode ? ', Low Power Mode on' : ''}, load ${conditions.loadAverage.join(' / ')}`,
    `- **Ran**: ${result.startedAt} → ${result.finishedAt}`,
    '',
  ];
}

function windowLine(window: Readonly<Record<string, number>> | null): string[] {
  if (window === null) return [];
  return [`Window: ${Object.entries(window).map(([key, value]) => `${key} ${value}`).join(', ')}`, ''];
}

/** A run's report: every metric with its previous value, its change and its verdict. */
export function runMarkdown(result: RunResult, rows: readonly Row[], previous: RunResult | null): string {
  const lines = header(result, `Performance run — ${result.label}`);
  if (previous === null) lines.push('No previous run to compare with: this run is the first.', '');
  else {
    const differing = differingConditions(result.conditions, previous.conditions);
    lines.push(
      `Compared with \`${previous.conditions.commit}\` (${previous.label}, ${previous.finishedAt}).` +
        (differing.length > 0 ? ` Not comparable on timings and memory: ${differing.join(', ')} differ.` : ''),
      '',
    );
  }
  for (const [scenario, scenarioResult] of Object.entries(result.scenarios)) {
    lines.push(`## ${scenario}`, '', ...windowLine(scenarioResult.window));
    lines.push('| Metric | Value | Unit | Kind | Previous | Δ | Verdict | Noise |', '|---|---|---|---|---|---|---|---|');
    for (const row of rows.filter((candidate) => candidate.scenario === scenario)) {
      lines.push(
        `| ${row.metric} | ${shown(row.value, row.unit)} | ${row.unit} | ${row.kind} | ${shown(row.previous, row.unit)} | ${percent(row.delta)} | ${row.verdict} | ${percent(row.noise)} |`,
      );
    }
    if (scenarioResult.notes.length > 0) lines.push('', ...scenarioResult.notes.map((note) => `- ${note}`));
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

/** An A/B's report: each tree's median over the pairs, the change and the verdict. */
export function abMarkdown(result: RunResult, against: string, rows: readonly AbRow[]): string {
  const lines = header(result, `Performance A/B — ${result.conditions.commit} against ${against}`);
  lines.push(
    'Each tree measured with its own harness and its own projects, one launch at a time, alternating. A breach',
    'that holds on the paired medians is *confirmed*. Against the run\'s own commit, Δ is each metric\'s noise.',
    '',
  );
  for (const scenario of new Set(rows.map((row) => row.scenario))) {
    lines.push(`## ${scenario}`, '', '| Metric | This tree | Other tree | Unit | Kind | Δ | Verdict |', '|---|---|---|---|---|---|---|');
    for (const row of rows.filter((candidate) => candidate.scenario === scenario)) {
      lines.push(
        `| ${row.metric} | ${shown(row.ours, row.unit)} | ${shown(row.theirs, row.unit)} | ${row.unit} | ${row.kind} | ${percent(row.delta)} | ${row.verdict} |`,
      );
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
