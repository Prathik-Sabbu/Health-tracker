import type {
    DailyHealthMetrics,
    SleepData,
    ReadinessResult,
    ReadinessStatus,
    Profile,
    Proposal,
    AdvisoryContext,
    Component
} from './types.js';

export interface HealthBaseline {
    medianHrv?: number;
    hrvHistory: number[];
    isHrvCalibrated: boolean;
    medianRhr?: number;
    rhrHistory: number[];
    isRhrCalibrated: boolean;
    averageSleepMinutes?: number;
    chronicAvgSteps?: number;
    daysCount: number;
}

/**
 * Calculates the median of a list of numbers.
 */
export const median = (xs: number[]): number => {
    if (xs.length === 0) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * 100 when within half a spread of normal, falling to 0 at 2.5 spreads below it.
 * Uses Median Absolute Deviation (MAD * 1.4826) as a robust dispersion metric.
 */
export function robustScore(value: number, history: number[], higherIsBetter: boolean, minSpread: number): number {
    if (history.length === 0) return 50;
    const med = median(history);
    const spread = Math.max(1.4826 * median(history.map(v => Math.abs(v - med))), minSpread);
    const z = ((value - med) / spread) * (higherIsBetter ? 1 : -1);
    return Math.round(Math.max(0, Math.min(100, (100 * (z + 2.5)) / 2)));
}

/**
 * Calculates rolling personal baselines from past health history (28-day window).
 * Assumes history is sorted oldest-first and excludes today.
 * Requires at least 7 recorded days for HRV or RHR to be considered calibrated.
 */
export function calculateBaseline(history: DailyHealthMetrics[]): HealthBaseline {
    // 28-day chronic window (4 weeks)
    const recentHistory = history.slice(-28);

    // HRV (asleep-only readings)
    const hrvHistory = recentHistory
        .map(entry => entry.hrv)
        .filter((hrv): hrv is number => typeof hrv === 'number' && hrv > 0);
    const isHrvCalibrated = hrvHistory.length >= 7;
    const medianHrv = isHrvCalibrated ? median(hrvHistory) : undefined;

    // Resting Heart Rate (bpm)
    const rhrHistory = recentHistory
        .map(entry => entry.restingHeartRate)
        .filter((rhr): rhr is number => typeof rhr === 'number' && rhr > 0);
    const isRhrCalibrated = rhrHistory.length >= 7;
    const medianRhr = isRhrCalibrated ? median(rhrHistory) : undefined;

    // Sleep duration
    const validSleep = recentHistory
        .map(entry => entry.sleep?.totalMinutes)
        .filter((mins): mins is number => typeof mins === 'number' && mins > 0);
    const averageSleepMinutes = validSleep.length > 0
        ? Math.round(validSleep.reduce((sum, val) => sum + val, 0) / validSleep.length)
        : undefined;

    // Chronic steps (walking / movement)
    const validSteps = recentHistory
        .map(entry => entry.steps)
        .filter((steps): steps is number => typeof steps === 'number' && steps > 0);
    const chronicAvgSteps = validSteps.length > 0
        ? Math.round(validSteps.reduce((sum, val) => sum + val, 0) / validSteps.length)
        : undefined;

    return {
        medianHrv,
        hrvHistory,
        isHrvCalibrated,
        medianRhr,
        rhrHistory,
        isRhrCalibrated,
        averageSleepMinutes,
        chronicAvgSteps,
        daysCount: recentHistory.length
    };
}

/**
 * Calculates 0-100 sleep score.
 * Uses a steep curve below 6 hours (360 mins) so quality and efficiency padding
 * cannot artificially mask severe duration sleep deprivation.
 * Returns undefined if no sleep data was recorded.
 */
export function calculateSleepScore(sleep?: SleepData, targetMinutes = 480): number | undefined {
    if (!sleep || !sleep.totalMinutes || sleep.totalMinutes <= 0) {
        return undefined;
    }

    // 1. Duration score: steep drop below 6 hours
    let durationScore: number;
    if (sleep.totalMinutes >= targetMinutes) {
        durationScore = 100;
    } else if (sleep.totalMinutes >= 360) {
        // 6 to 8 hours: 65 to 100
        durationScore = 65 + ((sleep.totalMinutes - 360) / (targetMinutes - 360)) * 35;
    } else {
        // Below 6 hours: scales down steeply from 65 to 0
        durationScore = Math.max(0, (sleep.totalMinutes / 360) * 65);
    }

    // 2. Restorative stages: Deep + REM (target >= 35%)
    const restorativeMinutes = (sleep.deepMinutes ?? 0) + (sleep.remMinutes ?? 0);
    const restorativePct = (restorativeMinutes / sleep.totalMinutes) * 100;
    const qualityScore = Math.min(100, (restorativePct / 35) * 100);

    // 3. Sleep efficiency (percentage)
    const efficiencyScore = sleep.efficiencyPercent ?? 85;

    // Weighting: 70% duration, 15% restorative stages, 15% continuity
    let totalSleepScore =
        (durationScore * 0.70) +
        (qualityScore * 0.15) +
        (efficiencyScore * 0.15);

    // Hard ceiling for sleep under 5.5 hours (330 mins) to prevent quality padding
    if (sleep.totalMinutes < 330) {
        const ceiling = Math.round((sleep.totalMinutes / 330) * 65);
        totalSleepScore = Math.min(totalSleepScore, ceiling);
    }

    return Math.round(Math.max(0, Math.min(100, totalSleepScore)));
}

/**
 * Calculates 0-100 Activity/Training Load score based on Acute (last 1-3 days) vs Chronic (28-day) workload.
 * Evaluates yesterday's accumulated fatigue rather than today's morning step count.
 * Returns undefined if chronic baseline steps are not established.
 */
export function calculateLoadScore(history: DailyHealthMetrics[]): number | undefined {
    if (!history || history.length === 0) return undefined;

    const chronicHistory = history.slice(-28);
    const validChronicSteps = chronicHistory
        .map(h => h.steps)
        .filter((s): s is number => typeof s === 'number' && s > 0);

    if (validChronicSteps.length === 0) return undefined;
    const chronicAvgSteps = validChronicSteps.reduce((a, b) => a + b, 0) / validChronicSteps.length;

    // Acute load: look at yesterday / last 3 days in history
    const acuteHistory = history.slice(-3);
    const validAcuteSteps = acuteHistory
        .map(h => h.steps)
        .filter((s): s is number => typeof s === 'number' && s > 0);

    if (validAcuteSteps.length === 0) return undefined;
    const acuteAvgSteps = validAcuteSteps.reduce((a, b) => a + b, 0) / validAcuteSteps.length;

    const ratio = acuteAvgSteps / chronicAvgSteps;

    // Normal acute:chronic workload ratio (<= 1.2x of chronic volume = 100)
    if (ratio <= 1.2) {
        return 100;
    }

    // Penalize volume spikes (> 1.2x baseline)
    const penalty = (ratio - 1.2) * 50;
    return Math.round(Math.max(0, Math.min(100, 100 - penalty)));
}

const LOW_CUTOFF = 60;
const roundTo = (n: number, step: number) => Math.round(n / step) * step;

/**
 * Identifies the primary drag on readiness by weighted shortfall: (100 - score) * weight.
 */
export function mainDriver(components: Component[]): Component['key'] | null {
    let best: Component['key'] | null = null;
    let bestLoss = 0;
    for (const c of components) {
        const loss = (100 - c.score) * c.weight; // weighted shortfall
        if (loss > bestLoss) {
            best = c.key;
            bestLoss = loss;
        }
    }
    return best;
}

/**
 * Builds actionable, structured proposals when readiness drops below LOW_CUTOFF.
 */
export function buildProposals(score: number, components: Component[], ctx: AdvisoryContext): Proposal[] {
    if (score >= LOW_CUTOFF) return [];
    const proposals: Proposal[] = [];
    const driver = mainDriver(components);
    const severity = Math.min(1, (LOW_CUTOFF - score) / 30); // score <= 30 is full severity

    if (driver === 'sleep') {
        proposals.push({
            id: 'sleep',
            kind: 'sleep',
            reason: 'Sleep is the main drag on readiness. An earlier bedtime helps more than moving less.'
        });
    } else if (ctx.hourOfDay < 18) {
        const room = Math.max(0, ctx.stepGoal - ctx.stepFloor);
        const cut = Math.min(room, roundTo(ctx.stepGoal * 0.3 * severity, 500));
        if (cut >= 500) {
            proposals.push({
                id: 'steps',
                kind: 'steps',
                delta: -cut,
                reason: `${driver} is the main driver of a low score (${score}).`
            });
            if (ctx.calorieStrategy === 'hold-cut') {
                const lostBurn = roundTo(cut * ctx.kcalPerStep, 25);
                const trim = Math.min(lostBurn, Math.max(0, ctx.calorieTarget - ctx.calorieFloor));
                if (trim >= 50) {
                    proposals.push({
                        id: 'calories',
                        kind: 'calories',
                        delta: -trim,
                        reason: `${cut} fewer steps burns about ${lostBurn} kcal less. This keeps today's deficit.`
                    });
                }
            }
        }
    }

    if (ctx.lowDaysInRow >= 3) {
        proposals.push({
            id: 'streak',
            kind: 'note',
            reason: 'Third low day in a row. Tell the chat how you feel so it can adjust the plan.'
        });
    }

    return proposals;
}

/**
 * Calculates daily training and recovery readiness using robust statistics against personal baselines.
 * Returns status: 'calibrating' with score: undefined until at least 7 days of HRV or RHR are recorded.
 */
export function calculateReadiness(
    today: DailyHealthMetrics,
    history: DailyHealthMetrics[],
    profile?: Profile,
    advisoryContext?: Partial<AdvisoryContext>
): ReadinessResult {
    // 1. Calculate 28-day baseline (assumes history is sorted oldest-first and excludes today)
    const baseline = calculateBaseline(history);

    // 2. Calibration guard: require at least 7 days of HRV or RHR
    if (!baseline.isHrvCalibrated && !baseline.isRhrCalibrated) {
        const targetSleepMinutes = profile?.sleepTargetHours ? profile.sleepTargetHours * 60 : 480;
        const sleepScore = calculateSleepScore(today.sleep, targetSleepMinutes);
        const daysCollected = Math.max(baseline.hrvHistory.length, baseline.rhrHistory.length);

        return {
            status: 'calibrating',
            score: undefined,
            sleepScore,
            hrvScore: undefined,
            rhrScore: undefined,
            loadScore: undefined,
            proposals: [],
            suggestedStepReduction: undefined,
            suggestedCalorieAdjustment: undefined,
            advisoryNote: `Baseline calibrating (${daysCollected}/7 days recorded). Full readiness score unlocks after 7 days of data.`
        };
    }

    // 3. Compute component scores with robustScore
    const targetSleepMinutes = profile?.sleepTargetHours ? profile.sleepTargetHours * 60 : 480;
    const sleepScore = calculateSleepScore(today.sleep, targetSleepMinutes);

    const hrvScore = (today.hrv !== undefined && baseline.isHrvCalibrated)
        ? robustScore(today.hrv, baseline.hrvHistory, true, 5)
        : undefined;

    const rhrScore = (today.restingHeartRate !== undefined && baseline.isRhrCalibrated)
        ? robustScore(today.restingHeartRate, baseline.rhrHistory, false, 1.5)
        : undefined;

    const loadScore = calculateLoadScore(history);

    // 4. Dynamic weighted average across present components
    const components: Component[] = [];
    if (sleepScore !== undefined) components.push({ key: 'sleep', score: sleepScore, weight: 0.35 });
    if (hrvScore !== undefined) components.push({ key: 'hrv', score: hrvScore, weight: 0.30 });
    if (rhrScore !== undefined) components.push({ key: 'rhr', score: rhrScore, weight: 0.20 });
    if (loadScore !== undefined) components.push({ key: 'load', score: loadScore, weight: 0.15 });

    let totalWeightedScore = 0;
    let totalWeight = 0;
    for (const c of components) {
        totalWeightedScore += c.score * c.weight;
        totalWeight += c.weight;
    }

    const score = totalWeight > 0 ? Math.round(totalWeightedScore / totalWeight) : undefined;

    // 5. Status determination
    let status: ReadinessStatus = 'optimal';
    if (score === undefined) {
        status = 'calibrating';
    } else if (score < 60) {
        status = 'low';
    } else if (score < 80) {
        status = 'moderate';
    }

    // 6. Advisory proposals
    const defaultContext: AdvisoryContext = {
        stepGoal: profile?.stepTarget ?? 10000,
        stepFloor: 6000,
        kcalPerStep: 0.045,
        calorieTarget: profile?.calorieTarget ?? 2100,
        calorieFloor: 1600,
        hourOfDay: new Date().getHours(),
        lowDaysInRow: 1,
        calorieStrategy: 'hold-cut'
    };
    const ctx: AdvisoryContext = { ...defaultContext, ...advisoryContext };

    const proposals = score !== undefined ? buildProposals(score, components, ctx) : [];

    const stepProposal = proposals.find(p => p.kind === 'steps');
    const calorieProposal = proposals.find(p => p.kind === 'calories');
    const suggestedStepReduction = stepProposal?.delta ? Math.abs(stepProposal.delta) : undefined;
    const suggestedCalorieAdjustment = calorieProposal?.delta ?? undefined;

    let advisoryNote = 'Recovery is optimal. Ready for scheduled training.';
    if (status === 'calibrating') {
        advisoryNote = 'Baseline calibrating. Full readiness score unlocks after 7 days of data.';
    } else if (status === 'low') {
        advisoryNote = proposals.length > 0
            ? proposals.map(p => p.reason).join(' ')
            : `Readiness is low (${score}/100) driven by ${mainDriver(components) || 'fatigue'}. Prioritize recovery today.`;
    } else if (status === 'moderate') {
        advisoryNote = 'Readiness is moderate. Proceed with planned training, but monitor intensity and listen to your body.';
    }

    return {
        score,
        status,
        sleepScore,
        rhrScore,
        hrvScore,
        loadScore,
        proposals,
        suggestedStepReduction,
        suggestedCalorieAdjustment,
        advisoryNote
    };
}
