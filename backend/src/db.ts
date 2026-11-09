import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import type { DailyHealthMetrics } from '@health-tracker/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '../data/health.db');

export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDb(): void {
    db.exec(`
        -- 1. single user profile
        CREATE TABLE IF NOT EXISTS profile (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            name TEXT NOT NULL DEFAULT 'PRATHIK',
            start_weight REAL NOT NULL DEFAULT 160,
            target_weight REAL NOT NULL DEFAULT 150.0,
            current_weight REAL NOT NULL DEFAULT 160.0,
            calorie_target INTEGER NOT NULL DEFAULT 2100,
            step_target INTEGER NOT NULL DEFAULT 10000,
            cut_start_date TEXT,
            cut_target_date TEXT,
            mode TEXT NOT NULL DEFAULT 'cut',
            squat_pr REAL NOT NULL DEFAULT 0,
            bench_pr REAL NOT NULL DEFAULT 0,
            deadlift_pr REAL NOT NULL DEFAULT 0,
            dietary_preferences TEXT DEFAULT '[]',
            allergies TEXT DEFAULT '[]'
        );

        -- 2. Daily Health Metrics (Apple Watch + Scale)
        CREATE TABLE IF NOT EXISTS health_metrics (
            date TEXT PRIMARY KEY,
            steps INTEGER,
            sleep_minutes REAL,
            sleep_data TEXT,              -- JSON string storing Deep, REM, Core, and intervals
            sleep_start TEXT,
            sleep_end TEXT,
            resting_heart_rate REAL,
            hrv REAL,
            respiratory_rate REAL,
            blood_oxygen REAL,
            weight_lbs REAL,
            body_fat_pct REAL,
            lean_body_mass_lbs REAL,
            active_calories REAL,
            exercise_minutes INTEGER,
            stand_hours INTEGER,
            stand_hourly TEXT,
            flights_climbed INTEGER,
            distance_miles REAL,
            source TEXT DEFAULT 'apple-watch',
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        -- 3. Seed default profile row if it doesn't exist yet
        INSERT OR IGNORE INTO profile (id, name, start_weight, target_weight, current_weight, calorie_target, step_target, mode)
        VALUES (1, 'Prathik', 160.0, 150.0, 160.0, 2100, 10000, 'cut');
    `);

    // Safe column migrations if table already existed
    try { db.exec(`ALTER TABLE health_metrics ADD COLUMN source TEXT DEFAULT 'apple-watch';`); } catch {}
    try { db.exec(`ALTER TABLE health_metrics ADD COLUMN weight_lbs REAL;`); } catch {}
    try { db.exec(`ALTER TABLE health_metrics ADD COLUMN respiratory_rate REAL;`); } catch {}
    try { db.exec(`ALTER TABLE health_metrics ADD COLUMN blood_oxygen REAL;`); } catch {}
    try { db.exec(`ALTER TABLE health_metrics ADD COLUMN body_fat_pct REAL;`); } catch {}
    try { db.exec(`ALTER TABLE health_metrics ADD COLUMN lean_body_mass_lbs REAL;`); } catch {}
    try { db.exec(`ALTER TABLE health_metrics ADD COLUMN active_calories REAL;`); } catch {}
    try { db.exec(`ALTER TABLE health_metrics ADD COLUMN exercise_minutes INTEGER;`); } catch {}
    try { db.exec(`ALTER TABLE health_metrics ADD COLUMN stand_hours INTEGER;`); } catch {}
    try { db.exec(`ALTER TABLE health_metrics ADD COLUMN stand_hourly TEXT;`); } catch {}
    try { db.exec(`ALTER TABLE health_metrics ADD COLUMN sleep_start TEXT;`); } catch {}
    try { db.exec(`ALTER TABLE health_metrics ADD COLUMN sleep_end TEXT;`); } catch {}
    try { db.exec(`ALTER TABLE health_metrics ADD COLUMN flights_climbed INTEGER;`); } catch {}
    try { db.exec(`ALTER TABLE health_metrics ADD COLUMN distance_miles REAL;`); } catch {}
}

initDb();

export function upsertHealthMetrics(metrics: DailyHealthMetrics): void {
    const stmt = db.prepare(`
    INSERT INTO health_metrics (
      date, 
      steps, 
      sleep_minutes, 
      sleep_data, 
      sleep_start,
      sleep_end,
      resting_heart_rate, 
      hrv, 
      respiratory_rate,
      blood_oxygen,
      weight_lbs, 
      body_fat_pct,
      lean_body_mass_lbs,
      active_calories,
      exercise_minutes,
      stand_hours,
      stand_hourly,
      flights_climbed,
      distance_miles,
      source,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(date) DO UPDATE SET
      steps = COALESCE(excluded.steps, health_metrics.steps),
      sleep_minutes = COALESCE(excluded.sleep_minutes, health_metrics.sleep_minutes),
      sleep_data = COALESCE(excluded.sleep_data, health_metrics.sleep_data),
      sleep_start = COALESCE(excluded.sleep_start, health_metrics.sleep_start),
      sleep_end = COALESCE(excluded.sleep_end, health_metrics.sleep_end),
      resting_heart_rate = COALESCE(excluded.resting_heart_rate, health_metrics.resting_heart_rate),
      hrv = COALESCE(excluded.hrv, health_metrics.hrv),
      respiratory_rate = COALESCE(excluded.respiratory_rate, health_metrics.respiratory_rate),
      blood_oxygen = COALESCE(excluded.blood_oxygen, health_metrics.blood_oxygen),
      weight_lbs = COALESCE(excluded.weight_lbs, health_metrics.weight_lbs),
      body_fat_pct = COALESCE(excluded.body_fat_pct, health_metrics.body_fat_pct),
      lean_body_mass_lbs = COALESCE(excluded.lean_body_mass_lbs, health_metrics.lean_body_mass_lbs),
      active_calories = COALESCE(excluded.active_calories, health_metrics.active_calories),
      exercise_minutes = COALESCE(excluded.exercise_minutes, health_metrics.exercise_minutes),
      stand_hours = COALESCE(excluded.stand_hours, health_metrics.stand_hours),
      stand_hourly = COALESCE(excluded.stand_hourly, health_metrics.stand_hourly),
      flights_climbed = COALESCE(excluded.flights_climbed, health_metrics.flights_climbed),
      distance_miles = COALESCE(excluded.distance_miles, health_metrics.distance_miles),
      source = COALESCE(excluded.source, health_metrics.source),
      updated_at = CURRENT_TIMESTAMP
  `);

    stmt.run(
        metrics.date,
        metrics.steps ?? null,
        metrics.sleep?.totalMinutes ?? null,
        metrics.sleep ? JSON.stringify(metrics.sleep) : null,
        metrics.sleepStart ?? metrics.sleep?.sleepStart ?? null,
        metrics.sleepEnd ?? metrics.sleep?.sleepEnd ?? null,
        metrics.restingHeartRate ?? null,
        metrics.hrv ?? null,
        metrics.respiratoryRate ?? null,
        metrics.bloodOxygen ?? null,
        metrics.weightLbs ?? null,
        metrics.bodyFatPct ?? null,
        metrics.leanBodyMassLbs ?? null,
        metrics.activeCalories ?? null,
        metrics.exerciseMinutes ?? null,
        metrics.standHours ?? null,
        metrics.standHourly ? JSON.stringify(metrics.standHourly) : null,
        metrics.flightsClimbed ?? null,
        metrics.distanceMiles ?? null,
        metrics.source ?? 'apple-watch'
    );
}

// Helper to transform SQLite row into DailyHealthMetrics
function rowToMetric(row: any): DailyHealthMetrics {
    return {
        date: row.date,
        steps: row.steps ?? undefined,
        sleep: row.sleep_data
            ? JSON.parse(row.sleep_data)
            : row.sleep_minutes !== null && row.sleep_minutes !== undefined
              ? {
                  totalMinutes: row.sleep_minutes,
                  timeInBedMinutes: row.sleep_minutes,
                  deepMinutes: 0,
                  remMinutes: 0,
                  coreMinutes: 0,
                  awakeMinutes: 0,
                  sleepStart: row.sleep_start ?? undefined,
                  sleepEnd: row.sleep_end ?? undefined,
                }
              : undefined,
        sleepStart: row.sleep_start ?? (row.sleep_data ? JSON.parse(row.sleep_data).sleepStart : undefined),
        sleepEnd: row.sleep_end ?? (row.sleep_data ? JSON.parse(row.sleep_data).sleepEnd : undefined),
        restingHeartRate: row.resting_heart_rate ?? undefined,
        hrv: row.hrv ?? undefined,
        respiratoryRate: row.respiratory_rate ?? undefined,
        bloodOxygen: row.blood_oxygen ?? undefined,
        weightLbs: row.weight_lbs ?? undefined,
        bodyFatPct: row.body_fat_pct ?? undefined,
        leanBodyMassLbs: row.lean_body_mass_lbs ?? undefined,
        activeCalories: row.active_calories ?? undefined,
        exerciseMinutes: row.exercise_minutes ?? undefined,
        standHours: row.stand_hours ?? undefined,
        standHourly: row.stand_hourly ? JSON.parse(row.stand_hourly) : undefined,
        flightsClimbed: row.flights_climbed ?? undefined,
        distanceMiles: row.distance_miles ?? undefined,
        source: row.source ?? 'apple-watch',
    };
}

export function getHealthMetrics(date: string): DailyHealthMetrics | null {
    const row = db.prepare('SELECT * FROM health_metrics WHERE date = ?').get(date);
    if (!row) return null;
    return rowToMetric(row);
}

export function getHealthMetricsRange(startDate: string, endDate: string): DailyHealthMetrics[] {
    const rows = db.prepare(`
    SELECT * FROM health_metrics 
    WHERE date >= ? AND date <= ? 
    ORDER BY date ASC
  `).all(startDate, endDate);

    return rows.map(rowToMetric);
}