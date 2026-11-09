import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { DailyHealthMetrics, SleepData } from '@health-tracker/shared';
import { upsertHealthMetrics } from './db';

/**
 * Expected incoming payload from Apple Shortcuts or Health Auto Export.
 * Empty strings ("") sent by Shortcuts when health data is empty are treated as undefined.
 */
export interface IngestPayload {
  date?: string;
  steps?: number | string;
  sleepMinutes?: number | string;
  sleep?: Partial<SleepData> | number | string;
  restingHeartRate?: number | string;
  hrv?: number | string;
  weight?: number | string;
  weightLbs?: number | string;
  source?: string;
}

/**
 * Helper to look up a key in a dictionary case-insensitively and whitespace-insensitively.
 * Handles variations like "Respitory rate", "Respiratory Rate ", "Blood Oxygen", "blood_oxygen", etc.
 */
function getFuzzyKey(obj: any, ...targetKeys: string[]): any {
  if (!obj || typeof obj !== 'object') return undefined;
  const normalizedTargets = targetKeys.map((k) => k.toLowerCase().replace(/[\s_-]/g, ''));

  for (const [key, value] of Object.entries(obj)) {
    const cleanKey = key.toLowerCase().replace(/[\s_-]/g, '');
    if (normalizedTargets.includes(cleanKey)) {
      return value;
    }
  }
  return undefined;
}

/**
 * Safely parses a numeric field.
 * Handles strings with unit symbols attached by Apple Shortcuts (e.g. "98%", "14.5 breaths/min", "157.1 lbs").
 * Empty strings, null, and undefined are treated as "not sent" (undefined).
 */
function parseOptionalNumber(val: any): number | undefined {
  if (val === undefined || val === null || val === '') return undefined;
  if (typeof val === 'number') return isNaN(val) ? undefined : val;
  if (Array.isArray(val)) {
    val = val.length > 0 ? val[0] : undefined;
    if (val === undefined || val === null || val === '') return undefined;
  }
  if (typeof val === 'object' && val !== null) {
    val = val.value ?? val.qty ?? val.amount ?? Object.values(val)[0];
  }
  if (typeof val === 'string') {
    const cleaned = val.trim();
    if (!cleaned) return undefined;
    // Extract the numeric portion (strips "%", "breaths/min", "bpm", etc.)
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? undefined : parsed;
  }
  const num = Number(val);
  return isNaN(num) ? undefined : num;
}

/**
 * Normalizes and validates incoming data into our strict DailyHealthMetrics schema.
 * Throws an Error with descriptive text if range validation fails.
 */
export function normalizeIngestPayload(body: any): DailyHealthMetrics {
  // 1. Date resolution (phone sends local wake-up date; defaults to today)
  let dateStr = new Date().toISOString().slice(0, 10);
  if (body?.date) {
    if (typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(body.date)) {
      dateStr = body.date.slice(0, 10);
    } else {
      const parsed = new Date(body.date);
      if (!isNaN(parsed.getTime())) {
        dateStr = parsed.toISOString().slice(0, 10);
      }
    }
  }

  // 2. Range Validation & Empty string defense (Fuzzy, case-insensitive key lookup)
  const steps = parseOptionalNumber(getFuzzyKey(body, 'steps'));
  if (steps !== undefined && steps < 0) {
    throw new Error(`Invalid steps: ${steps}. Steps cannot be negative.`);
  }

  const restingHeartRate = parseOptionalNumber(getFuzzyKey(body, 'rhr', 'restingheartrate'));
  if (restingHeartRate !== undefined && (restingHeartRate <= 0 || restingHeartRate > 250)) {
    throw new Error(`Invalid resting heart rate: ${restingHeartRate}. Must be between 1 and 250 bpm.`);
  }

  const hrv = parseOptionalNumber(getFuzzyKey(body, 'hrv'));
  if (hrv !== undefined && (hrv <= 0 || hrv > 500)) {
    throw new Error(`Invalid HRV: ${hrv}. Must be greater than 0 ms.`);
  }

  // Respiratory rate (e.g. breaths per minute, handles "14.5 breaths/min" or "14.5")
  const respiratoryRate = parseOptionalNumber(getFuzzyKey(body, 'respitoryrate', 'respiratoryrate'));
  if (respiratoryRate !== undefined && (respiratoryRate <= 0 || respiratoryRate > 80)) {
    throw new Error(`Invalid respiratory rate: ${respiratoryRate}. Must be between 1 and 80 breaths/min.`);
  }

  // Blood oxygen (handles "98%", "98", or 0.98 decimal format)
  let bloodOxygen = parseOptionalNumber(getFuzzyKey(body, 'bloodoxygen'));
  if (bloodOxygen !== undefined) {
    if (bloodOxygen > 0 && bloodOxygen <= 1.0) {
      bloodOxygen = Math.round(bloodOxygen * 100 * 10) / 10;
    }
    if (bloodOxygen < 50 || bloodOxygen > 100) {
      throw new Error(`Invalid blood oxygen: ${bloodOxygen}%. Must be between 50% and 100%.`);
    }
  }

  // Weight (explicitly in lbs, handles "157.1 lbs" or 157.1)
  const weightLbs = parseOptionalNumber(getFuzzyKey(body, 'bodyweight', 'weightlbs', 'weight'));
  if (weightLbs !== undefined && (weightLbs < 50 || weightLbs > 600)) {
    throw new Error(`Invalid weight: ${weightLbs} lbs. Must be between 50 and 600 lbs.`);
  }

  // Body fat percentage (handles "15.5%", 15.5, or 0.155 decimal format)
  let bodyFatPct = parseOptionalNumber(getFuzzyKey(body, 'bodyfatpercentage', 'bodyfat', 'bodyfatpct'));
  if (bodyFatPct !== undefined) {
    if (bodyFatPct > 0 && bodyFatPct <= 1.0) {
      bodyFatPct = Math.round(bodyFatPct * 100 * 10) / 10;
    }
    if (bodyFatPct < 2 || bodyFatPct > 70) {
      throw new Error(`Invalid body fat percentage: ${bodyFatPct}%. Must be between 2% and 70%.`);
    }
  }

  // Lean body mass (in lbs, handles "131.6 lbs" or 131.6)
  let leanBodyMassLbs = parseOptionalNumber(getFuzzyKey(body, 'leanbodymass', 'leanbodymasslbs'));
  if (leanBodyMassLbs !== undefined && (leanBodyMassLbs < 40 || leanBodyMassLbs > 500)) {
    throw new Error(`Invalid lean body mass: ${leanBodyMassLbs} lbs.`);
  }
  // If not sent directly by scale, auto-calculate from weight and body fat percentage
  if (leanBodyMassLbs === undefined && weightLbs !== undefined && bodyFatPct !== undefined) {
    leanBodyMassLbs = Math.round(weightLbs * (1 - bodyFatPct / 100) * 10) / 10;
  }

  // Active calories burned (handles "235 kcal" or 235)
  const activeCalories = parseOptionalNumber(getFuzzyKey(body, 'activecalories', 'calories'));
  if (activeCalories !== undefined && activeCalories < 0) {
    throw new Error(`Invalid active calories: ${activeCalories}. Cannot be negative.`);
  }

  // Exercise time (minutes)
  const exerciseMinutes = parseOptionalNumber(getFuzzyKey(body, 'exercisetime', 'exerciseminutes'));
  if (exerciseMinutes !== undefined && exerciseMinutes < 0) {
    throw new Error(`Invalid exercise time: ${exerciseMinutes}. Cannot be negative.`);
  }

  // Stand time: Supports single numbers or Apple Shortcut newline strings (e.g. "0\n12\n...")
  const rawStand = getFuzzyKey(body, 'standtime', 'standhours');
  let standHours: number | undefined = undefined;
  let standHourly: number[] | undefined = undefined;

  if (typeof rawStand === 'string' && rawStand.includes('\n')) {
    standHourly = rawStand
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((n) => Number(n) || 0);

    // Apple Stand ring: each hour with >= 1 min standing counts as a stand hour achieved
    standHours = standHourly.filter((m) => m > 0).length;
  } else if (rawStand !== undefined && rawStand !== null && rawStand !== '') {
    standHours = Number(rawStand) || 0;
  }

  // Flights climbed
  const flightsClimbed = parseOptionalNumber(getFuzzyKey(body, 'flightsclimbed', 'flights'));
  if (flightsClimbed !== undefined && flightsClimbed < 0) {
    throw new Error(`Invalid flights climbed: ${flightsClimbed}. Cannot be negative.`);
  }

  // Walking/running distance in miles
  const distanceMiles = parseOptionalNumber(getFuzzyKey(body, 'miles', 'distancemiles', 'distance'));
  if (distanceMiles !== undefined && distanceMiles < 0) {
    throw new Error(`Invalid distance: ${distanceMiles}. Cannot be negative.`);
  }

  // 3. Sleep resolution: Supports objects, simple numbers, and Apple Shortcut newline strings
  let sleep: SleepData | undefined = undefined;

  // Format A: Shortcut newline-separated strings (sleep: "core\ndeep\n...", time: "22\n45\n...", total: 420)
  const isShortcutNewlineFormat = typeof body?.sleep === 'string' && (body?.time !== undefined || body?.sleep.includes('\n'));

  if (isShortcutNewlineFormat && body?.time !== undefined) {
    const stageLines = String(body.sleep)
      .split('\n')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);

    const timeLines = String(body.time)
      .split('\n')
      .map((t) => Number(t.trim()) || 0);

    let deepMinutes = 0;
    let remMinutes = 0;
    let coreMinutes = 0;
    let awakeMinutes = 0;

    for (let i = 0; i < stageLines.length; i++) {
      const stage = stageLines[i];
      const mins = timeLines[i] ?? 0;

      if (stage.includes('deep')) {
        deepMinutes += mins;
      } else if (stage.includes('rem')) {
        remMinutes += mins;
      } else if (stage.includes('core') || stage.includes('light')) {
        coreMinutes += mins;
      } else if (stage.includes('awake')) {
        awakeMinutes += mins;
      }
    }

    let totalMinutes = parseOptionalNumber(body?.total ?? body?.totalSleep ?? body?.sleepMinutes);
    if (totalMinutes === undefined || totalMinutes <= 0) {
      totalMinutes = deepMinutes + remMinutes + coreMinutes;
    } else if (totalMinutes < 24) {
      // In case Shortcut outputs hours (e.g. 7.5 hours)
      totalMinutes = Math.round(totalMinutes * 60);
    }

    const timeInBedMinutes = totalMinutes + awakeMinutes;

    sleep = {
      totalMinutes,
      timeInBedMinutes,
      deepMinutes,
      remMinutes,
      coreMinutes,
      awakeMinutes,
      efficiencyPercent: timeInBedMinutes > 0 ? Math.round((totalMinutes / timeInBedMinutes) * 100) : 100,
    };
  } else if (typeof body?.sleep === 'object' && body?.sleep !== null) {
    // Format B: Standard SleepData JSON object
    const rawSleep = body.sleep;
    const totalMinutes = parseOptionalNumber(rawSleep.totalMinutes ?? rawSleep.sleepMinutes ?? body?.sleepMinutes) ?? 0;
    const timeInBedMinutes = parseOptionalNumber(rawSleep.timeInBedMinutes) ?? totalMinutes;
    const deepMinutes = parseOptionalNumber(rawSleep.deepMinutes) ?? 0;
    const remMinutes = parseOptionalNumber(rawSleep.remMinutes) ?? 0;
    const coreMinutes = parseOptionalNumber(rawSleep.coreMinutes) ?? 0;
    const awakeMinutes = parseOptionalNumber(rawSleep.awakeMinutes) ?? 0;

    sleep = {
      totalMinutes,
      timeInBedMinutes,
      deepMinutes,
      remMinutes,
      coreMinutes,
      awakeMinutes,
      efficiencyPercent: timeInBedMinutes > 0 ? Math.round((totalMinutes / timeInBedMinutes) * 100) : 100,
      intervals: Array.isArray(rawSleep.intervals) ? rawSleep.intervals : undefined,
    };
  } else if (body?.sleepMinutes !== undefined || (typeof body?.sleep === 'number' || (typeof body?.sleep === 'string' && body.sleep !== ''))) {
    // Format C: Single number sent (simple total minutes)
    const rawMinutes = parseOptionalNumber(body?.sleepMinutes ?? body?.sleep);
    if (rawMinutes !== undefined) {
      if (rawMinutes < 0 || rawMinutes > 1440) {
        throw new Error(`Invalid sleep duration: ${rawMinutes} minutes. Must be between 0 and 1440.`);
      }
      sleep = {
        totalMinutes: rawMinutes,
        timeInBedMinutes: rawMinutes,
        deepMinutes: 0,
        remMinutes: 0,
        coreMinutes: 0,
        awakeMinutes: 0,
        efficiencyPercent: 100,
      };
    }
  }

  // Sleep Start and Sleep End times
  const rawSleepStart = getFuzzyKey(body, 'sleepstart', 'bedtime');
  const sleepStart = typeof rawSleepStart === 'string' && rawSleepStart.trim().length > 0
    ? rawSleepStart.trim()
    : undefined;

  const rawSleepEnd = getFuzzyKey(body, 'sleepend', 'wakeuptime');
  const sleepEnd = typeof rawSleepEnd === 'string' && rawSleepEnd.trim().length > 0
    ? rawSleepEnd.trim()
    : undefined;

  if (!sleep && (sleepStart || sleepEnd)) {
    const totalMinutes = parseOptionalNumber(body?.total ?? body?.totalSleep ?? body?.sleepMinutes) ?? 0;
    sleep = {
      totalMinutes,
      timeInBedMinutes: totalMinutes,
      deepMinutes: 0,
      remMinutes: 0,
      coreMinutes: 0,
      awakeMinutes: 0,
      efficiencyPercent: 100,
      sleepStart,
      sleepEnd,
    };
  } else if (sleep && (sleepStart || sleepEnd)) {
    if (sleepStart) sleep.sleepStart = sleepStart;
    if (sleepEnd) sleep.sleepEnd = sleepEnd;
  }

  // 4. Source tagging (defaults to 'apple-watch')
  const source = (typeof body?.source === 'string' && body.source.trim().length > 0)
    ? body.source.trim()
    : 'apple-watch';

  return {
    date: dateStr,
    steps,
    sleep,
    sleepStart,
    sleepEnd,
    restingHeartRate,
    hrv,
    respiratoryRate,
    bloodOxygen,
    weightLbs,
    bodyFatPct,
    leanBodyMassLbs,
    activeCalories,
    exerciseMinutes,
    standHours,
    standHourly,
    flightsClimbed,
    distanceMiles,
    source,
  };
}

/**
 * Checks whether the incoming payload is from Health Export Kit.
 */
export function isHealthExportKitPayload(body: any): boolean {
  if (!body || typeof body !== 'object') return false;
  if (body?.meta?.app === 'Health Export Kit') return true;
  if (body?.activity?.daily && (body?.sleep?.sessions || body?.additional)) return true;
  return false;
}

/**
 * Parses a Health Export Kit payload into an array of DailyHealthMetrics (one per recorded date).
 */
export function parseHealthExportKit(body: any): DailyHealthMetrics[] {
  const meta = body.meta ?? {};
  const year = meta.rangeStart?.slice(0, 4) || new Date().getFullYear().toString();

  // Gather all unique dates present across activity, body composition, and heart vitals
  const dateSet = new Set<string>();

  body.activity?.daily?.forEach((d: any) => { if (d.date) dateSet.add(d.date); });
  body.additional?.body?.daily?.forEach((d: any) => { if (d.date) dateSet.add(d.date); });
  body.additional?.heart?.daily?.forEach((d: any) => { if (d.date) dateSet.add(d.date); });

  // Map sleep sessions to wake-up dates (e.g. "11-08 07:39:26" -> "2026-11-08")
  const sessions = Array.isArray(body.sleep?.sessions) ? body.sleep.sessions : [];
  const sessionsByDate = new Map<string, any>();

  for (const s of sessions) {
    if (!s.end) continue;
    let sDate = '';
    if (/^\d{4}-\d{2}-\d{2}/.test(s.end)) {
      sDate = s.end.slice(0, 10);
    } else if (/^\d{2}-\d{2}/.test(s.end)) {
      sDate = `${year}-${s.end.slice(0, 5)}`;
    }
    if (sDate) {
      dateSet.add(sDate);
      sessionsByDate.set(sDate, s);
    }
  }

  const results: DailyHealthMetrics[] = [];

  for (const date of Array.from(dateSet).sort()) {
    const act = body.activity?.daily?.find((d: any) => d.date === date);
    const bodyComp = body.additional?.body?.daily?.find((d: any) => d.date === date)?.values;
    const heart = body.additional?.heart?.daily?.find((d: any) => d.date === date)?.values;
    const sleepSession = sessionsByDate.get(date);

    // Activity metrics
    const steps = act?.steps !== undefined ? Number(act.steps) : undefined;
    const activeCalories = act?.activeEnergyKcal !== undefined ? Math.round(Number(act.activeEnergyKcal)) : undefined;
    const exerciseMinutes = act?.exerciseMinutes !== undefined ? Math.round(Number(act.exerciseMinutes)) : undefined;
    const flightsClimbed = act?.flightsClimbed !== undefined ? Math.round(Number(act.flightsClimbed)) : undefined;
    const distanceMiles = act?.distanceKm !== undefined ? Math.round(Number(act.distanceKm) * 0.621371 * 100) / 100 : undefined;

    // Body composition (Health Export Kit provides kg -> convert to lbs)
    const weightLbs = bodyComp?.bodyMass ? Math.round(Number(bodyComp.bodyMass) * 2.20462262 * 10) / 10 : undefined;
    const bodyFatPct = bodyComp?.bodyFat !== undefined ? Number(bodyComp.bodyFat) : undefined;
    const leanBodyMassLbs = bodyComp?.leanMass ? Math.round(Number(bodyComp.leanMass) * 2.20462262 * 10) / 10 : undefined;

    // Vitals
    let restingHeartRate = heart?.restingHR !== undefined ? Math.round(Number(heart.restingHR)) : undefined;
    let hrv = heart?.hrvAll !== undefined ? Math.round(Number(heart.hrvAll)) : undefined;
    let bloodOxygen = heart?.spo2All !== undefined ? Math.round(Number(heart.spo2All)) : undefined;
    let respiratoryRate = sleepSession?.vitals?.respiratoryRate?.avg !== undefined 
      ? Math.round(Number(sleepSession.vitals.respiratoryRate.avg) * 10) / 10 
      : undefined;

    // Fallbacks from sleep session vitals if daily vitals weren't present
    if (restingHeartRate === undefined && sleepSession?.vitals?.heartRate?.avg !== undefined) {
      restingHeartRate = Math.round(Number(sleepSession.vitals.heartRate.avg));
    }
    if (hrv === undefined && sleepSession?.vitals?.hrvSDNN?.avg !== undefined) {
      hrv = Math.round(Number(sleepSession.vitals.hrvSDNN.avg));
    }
    if (bloodOxygen === undefined && sleepSession?.vitals?.oxygenSaturation?.avg !== undefined) {
      bloodOxygen = Math.round(Number(sleepSession.vitals.oxygenSaturation.avg));
    }

    // Sleep breakdown & interval timeline for the interactive hypnogram
    let sleep: SleepData | undefined = undefined;
    if (sleepSession) {
      const totalMinutes = Math.round((sleepSession.asleepSec ?? 0) / 60);
      const timeInBedMinutes = Math.round((sleepSession.durationSec ?? 0) / 60);
      const deepMinutes = sleepSession.stageTotalsSec?.asleepDeep ? Math.round(sleepSession.stageTotalsSec.asleepDeep / 60) : 0;
      const remMinutes = sleepSession.stageTotalsSec?.asleepREM ? Math.round(sleepSession.stageTotalsSec.asleepREM / 60) : 0;
      const coreMinutes = sleepSession.stageTotalsSec?.asleepCore ? Math.round(sleepSession.stageTotalsSec.asleepCore / 60) : 0;
      const awakeMinutes = sleepSession.awakeSec ? Math.round(sleepSession.awakeSec / 60) : 0;
      const efficiencyPercent = sleepSession.sleepEfficiencyPct ? Math.round(sleepSession.sleepEfficiencyPct) : 100;

      const intervals = Array.isArray(sleepSession.stages) ? sleepSession.stages.map((s: any) => ({
        stage: s.stage === 'asleepCore' ? 'core' :
               s.stage === 'asleepDeep' ? 'deep' :
               s.stage === 'asleepREM' ? 'rem' : 'awake',
        startTime: s.start,
        endTime: s.end,
        durationMinutes: Math.round((s.durationSec ?? 0) / 60)
      })) : undefined;

      sleep = {
        totalMinutes,
        timeInBedMinutes,
        deepMinutes,
        remMinutes,
        coreMinutes,
        awakeMinutes,
        efficiencyPercent,
        sleepStart: sleepSession.start,
        sleepEnd: sleepSession.end,
        intervals
      };
    }

    // Only save if there is actual recorded data for this day
    const hasData = steps !== undefined || sleep !== undefined || restingHeartRate !== undefined || weightLbs !== undefined || activeCalories !== undefined;

    if (hasData) {
      results.push({
        date,
        steps,
        sleep,
        sleepStart: sleepSession?.start,
        sleepEnd: sleepSession?.end,
        restingHeartRate,
        hrv,
        respiratoryRate,
        bloodOxygen,
        weightLbs,
        bodyFatPct,
        leanBodyMassLbs,
        activeCalories,
        exerciseMinutes,
        flightsClimbed,
        distanceMiles,
        source: 'health-export-kit'
      });
    }
  }

  return results;
}

/**
 * Fastify route plugin registering the health ingest endpoints with Bearer token authentication.
 */
export async function ingestRoutes(app: FastifyInstance): Promise<void> {
  const EXPECTED_TOKEN = process.env.INGEST_TOKEN || 'health-tracker-secret-key';

  // Authentication hook for all ingest endpoints
  const authenticate = (request: FastifyRequest, reply: FastifyReply): boolean => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      reply.status(401).send({
        success: false,
        error: 'Unauthorized: Missing or malformed Authorization header. Expected "Bearer <token>".',
      });
      return false;
    }

    const token = authHeader.slice(7).trim();
    if (token !== EXPECTED_TOKEN) {
      reply.status(401).send({
        success: false,
        error: 'Unauthorized: Invalid bearer token.',
      });
      return false;
    }

    return true;
  };

  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!authenticate(request, reply)) return;

    if (!request.body) {
      return reply.status(400).send({
        success: false,
        error: 'Missing JSON request body with health metrics.',
      });
    }

    try {
      if (isHealthExportKitPayload(request.body)) {
        const metricsList = parseHealthExportKit(request.body);
        if (metricsList.length === 0) {
          return reply.status(400).send({
            success: false,
            error: 'No valid daily health metrics found in Health Export Kit payload.',
          });
        }

        for (const m of metricsList) {
          upsertHealthMetrics(m);
        }

        return reply.status(200).send({
          success: true,
          message: `Health Export Kit metrics saved for ${metricsList.map((m) => m.date).join(', ')}`,
          count: metricsList.length,
          data: metricsList,
        });
      }

      const normalized = normalizeIngestPayload(request.body);
      upsertHealthMetrics(normalized);

      return reply.status(200).send({
        success: true,
        message: `Health metrics saved for ${normalized.date}`,
        data: normalized,
      });
    } catch (error: any) {
      return reply.status(400).send({
        success: false,
        error: 'Validation failed',
        details: error?.message,
      });
    }
  };

  // Register endpoints
  app.post('/api/ingest/health', handler);
  app.post('/ingest/health', handler);

  // Diagnostic GET route (public status info)
  const getHandler = async () => ({
    status: 'ready',
    authRequired: 'Bearer <INGEST_TOKEN>',
    acceptedFields: [
      'date (YYYY-MM-DD)',
      'steps / Steps (number)',
      'sleep / sleepMinutes / time + total (Apple Watch stages)',
      'sleepStart / sleep start (timestamp or time)',
      'sleepEnd / sleep end (timestamp or time)',
      'restingHeartRate / RHR (bpm)',
      'hrv / HRV (ms)',
      'respiratoryRate / Respitory rate (breaths/min)',
      'bloodOxygen / Blood Oxygen (% or decimal)',
      'weight / weightLbs / Body Weight (lbs)',
      'bodyFatPct / Body Fat percentage (% or decimal)',
      'leanBodyMassLbs / Lean Body Mass (lbs)',
      'activeCalories / Active Calories (kcal)',
      'exerciseMinutes / Exercise time (minutes)',
      'standHours / Stand time (hours)',
      'flightsClimbed / Flights climbed (count)',
      'distanceMiles / miles (miles)',
      'source (default: "apple-watch")'
    ]
  });

  app.get('/api/ingest/health', getHandler);
  app.get('/ingest/health', getHandler);
}
