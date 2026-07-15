const RANGES: Array<[number, number]> = [[0,59],[0,23],[1,31],[1,12],[0,6]];

function parseField(field: string, min: number, max: number, normalize7 = false): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`invalid cron step: ${part}`);
    let lo = min, hi = max;
    if (rangePart !== '*' && rangePart !== '') {
      const [a, b] = rangePart!.split('-');
      lo = Number(a); hi = b !== undefined ? Number(b) : lo;
      if (normalize7) { if (lo === 7) lo = 0; if (hi === 7) hi = 0; }
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi)
        throw new Error(`invalid cron range: ${part}`);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

interface CronFields { minute: Set<number>; hour: Set<number>; dom: Set<number>; month: Set<number>; dow: Set<number>; }

export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron must have 5 fields, got: ${expr}`);
  return {
    minute: parseField(parts[0]!, ...RANGES[0]!),
    hour: parseField(parts[1]!, ...RANGES[1]!),
    dom: parseField(parts[2]!, ...RANGES[2]!),
    month: parseField(parts[3]!, ...RANGES[3]!),
    dow: parseField(parts[4]!, RANGES[4]![0], 7 as never, true) as Set<number>,
  };
}

export function nextCronRun(expr: string, after: Date): Date {
  const f = parseCron(expr);
  const t = new Date(after.getTime());
  t.setUTCSeconds(0, 0);
  t.setUTCMinutes(t.getUTCMinutes() + 1);
  const cap = after.getTime() + 4 * 366 * 24 * 3600 * 1000;
  const domRestricted = f.dom.size < 31, dowRestricted = f.dow.size < 7;
  while (t.getTime() <= cap) {
    const monthOk = f.month.has(t.getUTCMonth() + 1);
    if (!monthOk) { t.setUTCMonth(t.getUTCMonth() + 1, 1); t.setUTCHours(0,0,0,0); continue; }
    const domOk = f.dom.has(t.getUTCDate()), dowOk = f.dow.has(t.getUTCDay());
    const dayOk = domRestricted && dowRestricted ? (domOk || dowOk) : (domOk && dowOk);
    if (!dayOk) { t.setUTCDate(t.getUTCDate() + 1); t.setUTCHours(0,0,0,0); continue; }
    if (!f.hour.has(t.getUTCHours())) { t.setUTCHours(t.getUTCHours() + 1, 0, 0, 0); continue; }
    if (!f.minute.has(t.getUTCMinutes())) { t.setUTCMinutes(t.getUTCMinutes() + 1, 0, 0); continue; }
    return t;
  }
  throw new Error(`no cron match within 4 years for: ${expr}`);
}

export interface ScheduleSpec { cron?: string; intervalSeconds?: number; calendars?: Array<{ hour?: number; minute?: number; dayOfWeek?: number }>; }

export function nextRunFromSpec(spec: ScheduleSpec | null | undefined, after: Date): Date | null {
  if (!spec) return null;
  try {
    if (spec.cron) return nextCronRun(spec.cron, after);
    if (spec.intervalSeconds && spec.intervalSeconds >= 60) return new Date(after.getTime() + spec.intervalSeconds * 1000);
    if (spec.calendars?.length) {
      let best: Date | null = null;
      for (const c of spec.calendars) {
        const next = nextCronRun(`${c.minute ?? 0} ${c.hour ?? 0} * * ${c.dayOfWeek ?? '*'}`, after);
        if (!best || next < best) best = next;
      }
      return best;
    }
  } catch { return null; }
  return null;
}
