import type { DailyHealthMetrics, SleepData, ReadinessResult, ReadinessStatus, Profile } from './types.js';

export interface HealthBaseline {
    averageHrv?: number;
    isHrvCalibrated: boolean;
    averageRhr?: number;
    isRhrCalibrated: boolean;
    averageSleepMinutes?: number;
    averageSteps?: number;
    averageExerciseMinutes?: number;
    daysCount: number;
}

/**
 * Calculates a rolling personal baseline from past health history (capped to last 30 days).
 * HRV and Resting Heart Rate require at least 7 recorded days to be considered calibrated.
 */
export function calculateBaseline(history: DailyHealthMetrics[]): HealthBaseline {
    // 1. Cap to at most the last 30 days
    const recentHistory = history.slice(-30);

    // 2. HRV (Heart Rate Variability in ms)
    const validHrvs = recentHistory
        .map(entry => entry.hrv)
        .filter((hrv): hrv is number => typeof hrv === 'number' && hrv > 0);
    const isHrvCalibrated = validHrvs.length >= 7;
    const averageHrv = validHrvs.length > 0
        ? Math.round(validHrvs.reduce((sum, val) => sum + val, 0) / validHrvs.length)
        : undefined;

    // 3. Resting Heart Rate (bpm)
    const validRhr = recentHistory
        .map(entry => entry.restingHeartRate)
        .filter((rhr): rhr is number => typeof rhr === 'number' && rhr > 0);
    const isRhrCalibrated = validRhr.length >= 7;
    const averageRhr = validRhr.length > 0
        ? Math.round(validRhr.reduce((sum, val) => sum + val, 0) / validRhr.length)
        : undefined;

    // 4. Sleep duration (total asleep minutes)
    const validSleep = recentHistory
        .map(entry => entry.sleep?.totalMinutes)
        .filter((mins): mins is number => typeof mins === 'number' && mins > 0);
    const averageSleepMinutes = validSleep.length > 0
        ? Math.round(validSleep.reduce((sum, val) => sum + val, 0) / validSleep.length)
        : undefined;

    // 5. Steps (daily movement volume)
    const validSteps = recentHistory
        .map(entry => entry.steps)
        .filter((steps): steps is number => typeof steps === 'number' && steps > 0);
    const averageSteps = validSteps.length > 0
        ? Math.round(validSteps.reduce((sum, val) => sum + val, 0) / validSteps.length)
        : undefined;

    // 6. Exercise minutes (lifting / workouts - 0 is a valid rest day)
    const validExercise = recentHistory
        .map(entry => entry.exerciseMinutes)
        .filter((mins): mins is number => typeof mins === 'number' && mins >= 0);
    const averageExerciseMinutes = validExercise.length > 0
        ? Math.round(validExercise.reduce((sum, val) => sum + val, 0) / validExercise.length)
        : undefined;

    return {
        averageHrv,
        isHrvCalibrated,
        averageRhr,
        isRhrCalibrated,
        averageSleepMinutes,
        averageSteps,
        averageExerciseMinutes,
        daysCount: recentHistory.length
    };
}

/**
 * Calculates 0-100 sleep score based on duration vs target (60%), restorative stages (25%), and efficiency (15%).
 */
export function calculateSleepScore(sleep?: SleepData, targetMinutes = 480): number {
    if (!sleep || !sleep.totalMinutes || sleep.totalMinutes <= 0) {
        return -1;
    }

    const durationScore = Math.min(100, (sleep.totalMinutes / targetMinutes) * 100);

    const restorativeMinutes = (sleep.deepMinutes ?? 0) + (sleep.remMinutes ?? 0);
    const restorativePct = (restorativeMinutes / sleep.totalMinutes) * 100;
    const qualityScore = Math.min(100, (restorativePct / 35) * 100);

    const efficiencyScore = sleep.efficiencyPercent ?? 85;

    const totalSleepScore =
        (durationScore * 0.60) +
        (qualityScore * 0.25) +
        (efficiencyScore * 0.15);

    return Math.round(Math.max(0, Math.min(100, totalSleepScore)));
}

/**
 * Calculates 0-100 HRV score. Higher HRV relative to baseline indicates parasympathetic recovery.
 * Returns -1 if uncalibrated (< 7 days) or missing.
 */
export function calculateHrvScore(todayHrv?: number, baselineHrv?: number, isCalibrated = false): number {
    if (!todayHrv || !baselineHrv || !isCalibrated || baselineHrv <= 0) {
        return -1;
    }

    const hrvRatio = (todayHrv / baselineHrv) * 100;
    return Math.round(Math.max(0, Math.min(100, hrvRatio)));
}

/**
 * Calculates 0-100 Resting Heart Rate score. Lower or baseline RHR indicates good recovery.
 * Elevated RHR indicates cardiovascular strain, dehydration, or systemic fatigue.
 * Returns -1 if uncalibrated (< 7 days) or missing.
 */
export function calculateRhrScore(todayRhr?: number, baselineRhr?: number, isCalibrated = false): number {
    if (!todayRhr || !baselineRhr || !isCalibrated || baselineRhr <= 0) {
        return -1;
    }

    // Difference from baseline (positive means elevated heart rate)
    const diff = todayRhr - baselineRhr;

    // At or below baseline = 100 (well-rested)
    if (diff <= 0) {
        return 100;
    }

    // 5 points penalty for every 1 bpm elevated above baseline
    const score = 100 - (diff * 5);
    return Math.round(Math.max(0, Math.min(100, score)));
}

/**
 * Calculates 0-100 Activity/Training Load score based on Acute vs Chronic workload.
 * Returns -1 if baseline steps are not established.
 */
export function calculateLoadScore(
    todaySteps?: number,
    baselineSteps?: number,
    todayExercise?: number,
    baselineExercise?: number
): number {
    if (!baselineSteps || baselineSteps <= 0) {
        return -1;
    }

    const steps = todaySteps ?? 0;
    const stepRatio = steps / baselineSteps;

    // If exercise minutes are tracked, incorporate them into acute load
    let exerciseRatio = 1.0;
    if (baselineExercise && baselineExercise > 0 && todayExercise !== undefined) {
        exerciseRatio = todayExercise / baselineExercise;
    }

    // Combined acute load: 70% steps, 30% exercise minutes
    const combinedRatio = (stepRatio * 0.7) + (exerciseRatio * 0.3);

    // Normal training load: <= 1.2x of normal chronic volume = 100
    if (combinedRatio <= 1.2) {
        return 100;
    }

    // Penalize sharp acute volume spikes (> 1.2x of baseline)
    const penalty = (combinedRatio - 1.2) * 50;
    const score = 100 - penalty;
    return Math.round(Math.max(40, Math.min(100, score)));
}

/**
 * Calculates daily training and recovery readiness (0-100) using a dynamic weighted composite
 * of sleep, autonomic recovery (HRV), cardiac strain (RHR), and acute load.
 */
export function calculateReadiness(
    today: DailyHealthMetrics,
    history: DailyHealthMetrics[],
    profile?: Profile
): ReadinessResult {
    // 1. Calculate 30-day baseline
    const baseline = calculateBaseline(history);

    // 2. Compute individual sub-scores (-1 indicates metric is uncalibrated or missing)
    const targetSleepMinutes = profile?.sleepTargetHours ? profile.sleepTargetHours * 60 : 480;
    const sleepScore = calculateSleepScore(today.sleep, targetSleepMinutes);
    const hrvScore = calculateHrvScore(today.hrv, baseline.averageHrv, baseline.isHrvCalibrated);
    const rhrScore = calculateRhrScore(today.restingHeartRate, baseline.averageRhr, baseline.isRhrCalibrated);
    const loadScore = calculateLoadScore(
        today.steps,
        baseline.averageSteps,
        today.exerciseMinutes,
        baseline.averageExerciseMinutes
    );

    // 3. Dynamic weighted average (re-distributes weights if some metrics are not yet calibrated)
    let totalWeightedScore = 0;
    let totalWeight = 0;

    if (sleepScore >= 0) {
        totalWeightedScore += sleepScore * 0.35;
        totalWeight += 0.35;
    }

    if (hrvScore >= 0) {
        totalWeightedScore += hrvScore * 0.30;
        totalWeight += 0.30;
    }

    if (rhrScore >= 0) {
        totalWeightedScore += rhrScore * 0.20;
        totalWeight += 0.20;
    }

    if (loadScore >= 0) {
        totalWeightedScore += loadScore * 0.15;
        totalWeight += 0.15;
    }

    const compositeScore = totalWeight > 0
        ? Math.round(totalWeightedScore / totalWeight)
        : (sleepScore >= 0 ? sleepScore : 75);
    const score = Math.max(0, Math.min(100, compositeScore));

    // 4. Status determination (optimal >= 80, moderate 60-79, low < 60)
    let status: ReadinessStatus = 'optimal';
    if (score < 60) {
        status = 'low';
    } else if (score < 80) {
        status = 'moderate';
    }

    // 5. Advisory proposals
    let suggestedStepReduction: number | undefined = undefined;
    let suggestedCalorieAdjustment: number | undefined = undefined;
    let advisoryNote = 'Recovery is optimal. Ready for scheduled training.';

    if (status === 'low') {
        suggestedStepReduction = 2000;
        suggestedCalorieAdjustment = 150;
        const reasons: string[] = [];
        if (sleepScore >= 0 && sleepScore < 65) reasons.push('short or fragmented sleep');
        if (hrvScore >= 0 && hrvScore < 70) reasons.push('depressed HRV');
        if (rhrScore >= 0 && rhrScore < 70) reasons.push('elevated resting heart rate');
        if (loadScore >= 0 && loadScore < 70) reasons.push('high recent training load');

        advisoryNote = `Readiness is low due to ${reasons.join(', ') || 'accumulated fatigue'}. Suggested: reduce step goal by 2,000 and prioritize recovery today.`;
    } else if (status === 'moderate') {
        advisoryNote = 'Readiness is moderate. Proceed with planned training, but monitor intensity and listen to your body.';
    }

    return {
        score,
        status,
        sleepScore: sleepScore >= 0 ? sleepScore : 70,
        rhrScore: rhrScore >= 0 ? rhrScore : 80,
        hrvScore: hrvScore >= 0 ? hrvScore : 80,
        loadScore: loadScore >= 0 ? loadScore : 85,
        suggestedStepReduction,
        suggestedCalorieAdjustment,
        advisoryNote,
    };
}