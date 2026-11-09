import { getHealthMetricsRange } from '../backend/src/db.js';
import { calculateReadiness } from '../shared/src/readiness.js';

const rows = getHealthMetricsRange('2020-01-01', '2030-01-01');

if (rows.length === 0) {
    console.log('\n No health records found in database.\n');
    process.exit(0);
}

console.log('\n HEALTH METRICS LOG (' + rows.length + ' entries)\n');

// 1. Clean Summary Table (fits standard terminal width nicely)
const summaryTable = rows.map(r => {
    const sleepHrs = (r.sleep?.totalMinutes && r.sleep.totalMinutes > 0)
        ? `${Math.floor(r.sleep.totalMinutes / 60)}h ${r.sleep.totalMinutes % 60}m`
        : '-';

    return {
        'Date': r.date,
        'Steps': r.steps?.toLocaleString() ?? '-',
        'Sleep': sleepHrs,
        'Sleep Times': (r.sleepStart && r.sleepEnd) ? `${r.sleepStart.split(', ')[1] || r.sleepStart} → ${r.sleepEnd.split(', ')[1] || r.sleepEnd}` : '-',
        'RHR': r.restingHeartRate ? `${r.restingHeartRate} bpm` : '-',
        'HRV': r.hrv ? `${r.hrv} ms` : '-',
        'SpO2': r.bloodOxygen ? `${r.bloodOxygen}%` : '-',
        'Weight': r.weightLbs ? `${r.weightLbs} lbs` : '-',
        'Body Fat': r.bodyFatPct ? `${r.bodyFatPct}%` : '-',
        'Active Cal': r.activeCalories ? `${Math.round(r.activeCalories)} kcal` : '-'
    };
});

console.table(summaryTable);

// 2. Detailed view of the latest entry
const latest = rows[rows.length - 1];
console.log(`\n LATEST RECORD BREAKDOWN (${latest.date})`);
console.log('─'.repeat(50));
console.log(`Sleep:        ${latest.sleep?.totalMinutes ? Math.floor(latest.sleep.totalMinutes / 60) + 'h ' + (latest.sleep.totalMinutes % 60) + 'm' : 'N/A'}`);
if (latest.sleep) {
    console.log(`   ├─ Deep:      ${latest.sleep.deepMinutes ?? 0}m`);
    console.log(`   ├─ REM:       ${latest.sleep.remMinutes ?? 0}m`);
    console.log(`   ├─ Core:      ${latest.sleep.coreMinutes ?? 0}m`);
    console.log(`   ├─ Awake:     ${latest.sleep.awakeMinutes ?? 0}m`);
    console.log(`   └─ Efficiency:${latest.sleep.efficiencyPercent ?? 0}%`);
}
console.log(`Vitals:       RHR: ${latest.restingHeartRate ?? '-'} bpm | HRV: ${latest.hrv ?? '-'} ms | SpO2: ${latest.bloodOxygen ?? '-'}% | Resp: ${latest.respiratoryRate ?? '-'} br/m`);
console.log(`Activity:     Steps: ${latest.steps?.toLocaleString() ?? '-'} | Miles: ${latest.distanceMiles ?? '-'} | Active: ${latest.activeCalories ?? '-'} kcal | Exercise: ${latest.exerciseMinutes ?? '-'}m`);
console.log(`Body:         Weight: ${latest.weightLbs ?? '-'} lbs | Body Fat: ${latest.bodyFatPct ?? '-'}% | Lean Mass: ${latest.leanBodyMassLbs ?? '-'} lbs`);

// 3. Readiness Score for the latest day
const history = rows.slice(0, rows.length - 1);
const readiness = calculateReadiness(latest, history);
console.log('─'.repeat(50));
console.log(`🎯 Readiness:    ${readiness.score}/100 (${readiness.status.toUpperCase()})`);
console.log(`   ├─ Sleep:     ${readiness.sleepScore}/100`);
console.log(`   ├─ HRV:       ${readiness.hrvScore}/100`);
console.log(`   ├─ RHR:       ${readiness.rhrScore}/100`);
console.log(`   ├─ Load:      ${readiness.loadScore}/100`);
console.log(`   └─ Note:      ${readiness.advisoryNote}`);
console.log('─'.repeat(50) + '\n');
