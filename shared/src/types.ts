// ============================================================================
// 1. Profile & Settings Domain
// ============================================================================

export type GoalMode = 'cut' | 'maintain' | 'bulk';

export interface Profile {
    id: string;
    name: string;

    // Weight & Cut Targets (in lbs)
    startWeight: number;
    targetWeight: number;
    currentWeight: number;
    calorieTarget: number;        // daily kcal
    stepTarget: number;           // daily steps
    sleepTargetHours?: number;    // target sleep hours (default 8)
    cutStartDate: string;         // ISO string: YYYY-MM-DD
    cutTargetDate: string;        // ISO string: YYYY-MM-DD
    mode: GoalMode;

    // Powerlifting 1RMs for %-of-PR calculations (in lbs)
    squatPR: number;
    benchPR: number;
    deadliftPR: number;

    // Dietary preferences and restrictions
    dietaryPreferences: string[]; // e.g. ['hindu', 'vegetarian']
    allergies: string[];          // e.g. ['peanut', 'sesame']
}

// ============================================================================
// 2. Gym & Training Domain (Liftoff & Google Sheets Style Block)
// ============================================================================

export type TrackingType =
    | 'reps'
    | 'reps_weight'
    | 'time'
    | 'time_weight'
    | 'distance'
    | 'height'
    | 'custom';

export type SBDType = 'squat' | 'bench' | 'deadlift';

export type LiftRole = 'primary_sbd' | 'variation' | 'accessory';

export interface Exercise {
    id: string;
    name: string;
    category: string;             // e.g. 'chest', 'legs', 'back', 'explosive'
    trackingType: TrackingType;
    isSBD: boolean;               // True if primary powerlift
    sbdType?: SBDType;            // Maps to squatPR, benchPR, or deadliftPR
    isCustom: boolean;            // Custom user-created vs seeded default
}

// --- The Blueprint: Editable Training Block (Google Sheets Style) ---

export type ProgramPhase = 'volume' | 'cns' | 'taper' | 'test';

export interface PrescribedSet {
    setNumber: number;
    percentOfPR?: number;         // e.g. 0.80 for 80%
    targetReps: number;
    targetWeight?: number;        // auto-calculated: (PR * percentOfPR) rounded to nearest 5 lbs
}

export interface PrescribedLift {
    exerciseId: string;
    exerciseName: string;
    role: LiftRole;               // 'primary_sbd' vs 'variation' (tempo/volume) vs 'accessory'
    sbdType?: SBDType;            // Squat / bench / deadlift mapping if SBD
    notes?: string;               // e.g. "3-sec pause at chest" or "speed focus"
    sets: PrescribedSet[];
}

export interface ProgramDay {
    dayNumber: number;            // 1 through 7
    name: string;                 // e.g. "Day 1: Heavy Squat & Push"
    lifts: PrescribedLift[];
}

export interface ProgramWeek {
    weekNumber: number;           // Week 1, Week 2, etc.
    name: string;                 // e.g. "Volume 1", "CNS", "Taper", "PR Test"
    phase: ProgramPhase;
    days: ProgramDay[];
}

export interface ProgramBlock {
    id: string;
    name: string;                 // e.g. "5-Week Peaking Block"
    totalWeeks: number;           // Flexible: 4, 5, 6, etc.
    currentWeek: number;          // Active week pointer (1-based)
    currentDay: number;           // Active day pointer (1-based)
    weeks: ProgramWeek[];
}

// --- The Execution: Live Workout Logging ---

export interface WorkoutSet {
    id: string;
    setNumber: number;
    role?: LiftRole;              // Keeps competition bench separate from tempo bench
    targetReps: number;
    actualReps?: number;
    targetWeight?: number;        // Auto-filled by program formula (or last week's accessory)
    actualWeight?: number;        // What was actually lifted
    percentOfPR?: number;         // Prescribed % (e.g. 0.825)
    rpe?: number;                 // 1-10 Rate of Perceived Exertion (optional)
    completed: boolean;
    previousResult?: string;      // Auto-filled for accessories (e.g. "70 lbs x 10")
}

export interface WorkoutSession {
    id: string;
    date: string;                 // YYYY-MM-DD
    programBlockId?: string;      // Links to active block
    weekNumber: number;
    dayNumber: number;
    phase: ProgramPhase;
    completed: boolean;
    notes?: string;
}

// ============================================================================
// 3. Diet & Nutrition Domain (MyFitnessPal-Style)
// ============================================================================

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface Micronutrients {
    // Lipids & Minerals
    saturatedFat?: number;        // g
    transFat?: number;            // g
    cholesterol?: number;         // mg
    sodium?: number;              // mg
    potassium?: number;           // mg
    magnesium?: number;           // mg
    zinc?: number;                // mg
    calcium?: number;             // mg
    iron?: number;                // mg

    // Carbohydrate breakdown
    fiber?: number;               // g
    sugar?: number;               // g
    addedSugar?: number;          // g

    // Vitamins
    vitaminA?: number;            // mcg
    vitaminC?: number;            // mg
    vitaminD?: number;            // mcg
    vitaminB6?: number;           // mg
    vitaminB12?: number;          // mcg
    folate?: number;              // mcg

    // Extensible for any additional USDA / Open Food Facts nutrient
    [key: string]: number | undefined;
}

export type FoodSource = 'local' | 'usda' | 'openfoodfacts';

export interface FoodItem {
    id: string;
    name: string;
    servingSize: number;
    servingUnit: string;          // 'g', 'oz', 'ml'
    calories: number;
    protein: number;              // g
    carbs: number;                // g
    fat: number;                  // g
    micros?: Micronutrients;
    ingredients?: string[];       // Used by the deterministic allergy engine
    source: FoodSource;
}

export interface FoodEntry {
    id: string;
    date: string;                 // YYYY-MM-DD
    mealType: MealType;
    foodId: string;
    foodName: string;
    servings: number;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    micros?: Micronutrients;
    isEstimated: boolean;         // True if quick estimated or AI generated
    isSpice: boolean;             // Grouped in separate spices subsection
}

// ============================================================================
// 4. Health Metrics & Readiness Domain (Apple Watch & VeSync)
// ============================================================================

export type SleepStageType = 'deep' | 'rem' | 'core' | 'awake' | 'in_bed';

export interface SleepInterval {
    stage: SleepStageType;
    startTime: string;            // ISO 8601 (e.g. "2026-11-06T23:30:00Z")
    endTime: string;              // ISO 8601 (e.g. "2026-11-07T01:15:00Z")
    durationMinutes: number;
}

export interface SleepData {
    totalMinutes: number;         // Total asleep time
    timeInBedMinutes: number;
    deepMinutes: number;
    remMinutes: number;
    coreMinutes: number;
    awakeMinutes: number;
    efficiencyPercent?: number;   // (totalAsleep / timeInBed) * 100
    sleepStart?: string;          // Bedtime / sleep start timestamp or formatted string
    sleepEnd?: string;            // Wake-up timestamp or formatted string
    intervals?: SleepInterval[];  // Detailed timeline for the interactive hypnogram graph
}

export interface DailyHealthMetrics {
  date: string;                 // YYYY-MM-DD
  steps?: number;
  sleep?: SleepData;
  sleepStart?: string;          // Sleep start time
  sleepEnd?: string;            // Sleep end time
  restingHeartRate?: number;    // bpm
  hrv?: number;                 // ms (SDNN)
  respiratoryRate?: number;     // breaths/min
  bloodOxygen?: number;         // percentage (e.g. 98)
  weightLbs?: number;           // Morning scale reading (lbs)
  bodyFatPct?: number;          // percentage (e.g. 15.2)
  leanBodyMassLbs?: number;     // lean body mass (lbs)
  activeCalories?: number;      // kcal burned
  exerciseMinutes?: number;     // Apple Watch exercise ring minutes
  standHours?: number;          // Apple Watch stand ring hours (hours with >= 1 min standing)
  standHourly?: number[];       // Hourly standing values throughout the day
  flightsClimbed?: number;      // flights of stairs climbed
  distanceMiles?: number;       // walking/running distance in miles
  source?: string;              // default: 'apple-watch'
}

export type ReadinessStatus = 'optimal' | 'moderate' | 'low';

export interface ReadinessResult {
    score: number;                // 0 to 100
    status: ReadinessStatus;
    sleepScore: number;           // 0 to 100
    rhrScore: number;             // 0 to 100
    hrvScore: number;             // 0 to 100
    loadScore: number;            // 0 to 100
    suggestedStepReduction?: number;
    suggestedCalorieAdjustment?: number;
    advisoryNote: string;
}

// ============================================================================
// 5. Allergy & Restriction Engine Domain
// ============================================================================

export type AllergySeverity = 'red' | 'warning' | 'allowed';

export interface AllergyRule {
    allergen: string;
    threshold?: string;           // e.g. "last_ingredient_warning"
    notes?: string;
}

export interface AllergyCheckResult {
    status: AllergySeverity;
    allergen: string;
    reasoning: string;            // Deterministic explanation shown in UI
}

// ============================================================================
// 6. Rewards & Points Ledger Domain
// ============================================================================

export type LedgerEntryType =
    | 'step_debt'
    | 'step_bonus'
    | 'workout_completed'
    | 'diet_logged'
    | 'reward_redemption';

export interface LedgerEntry {
    id: string;
    date: string;
    type: LedgerEntryType;
    points: number;               // Positive for earned, negative for spent/debt
    description: string;
}

export interface RewardItem {
    id: string;
    title: string;
    costPoints: number;
    icon?: string;
}