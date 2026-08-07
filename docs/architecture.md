# Diet + Gym + Wearables Tracker — Full Architecture

Two changes from v1 drive this structure:
1. **Polish** → needs a real design system layer, not ad-hoc styled components.
2. **Wearable data** (sleep score, steps, readiness, HR) → needs a *sync/ingestion layer* separate from your own logged data, because it comes from third-party APIs on its own schedule, not from a user tapping "save."

---

## Top-Level

```
/app
  /frontend
  /backend
  /docs
```

---

## `/frontend` (React Native + Expo, TypeScript, NativeWind)

```
/frontend
  /app                        # expo-router file-based routes
    _layout.tsx                # root layout: theme provider, auth gate, font loading
    /(tabs)
      _layout.tsx               # tab bar config
      home.tsx                  # dashboard screen (composes widgets, no logic itself)
      diet.tsx
      gym.tsx
      health.tsx                 # NEW — sleep/readiness/steps screen
    /diet
      log-meal.tsx
      meal-history.tsx
    /gym
      log-workout.tsx
      workout-history.tsx
      exercise-detail/[id].tsx
    /settings
      index.tsx
      connect-wearable.tsx       # NEW — OAuth/link flow for Apple Health, Oura, Whoop, etc.
    /auth
      login.tsx
      register.tsx

  /components
    /ui                         # DESIGN SYSTEM — the "polish" layer
      Button.tsx
      Card.tsx
      ProgressRing.tsx           # for readiness/calorie/protein rings
      Sparkline.tsx
      Sheet.tsx                  # bottom sheet primitive
      Skeleton.tsx                # loading states, not spinners — feels polished
      Badge.tsx
      theme.ts                    # re-exports tokens for component-level use
    /diet
      MacroBar.tsx
      MealCard.tsx
    /gym
      WorkoutCard.tsx
      SetRow.tsx
    /health
      SleepScoreCard.tsx          # NEW
      ReadinessRing.tsx           # NEW
      StepsCard.tsx               # NEW
      HRVTrendChart.tsx           # NEW
    /home
      DailySummaryCard.tsx        # blends diet + gym + health into one glanceable card
      StreakBadge.tsx

  /theme
    tokens.ts                    # colors, spacing, radii, typography scale — single source of truth
    darkMode.ts
    animations.ts                # shared Reanimated configs (spring presets etc.)

  /hooks
    useDailyTotals.ts
    useWorkoutHistory.ts
    useHealthMetrics.ts           # NEW — pulls today's sleep/readiness/steps
    useAuth.ts

  /services                      # thin API clients — mirror backend routers 1:1
    api.ts                        # base fetch wrapper (auth headers, error handling)
    dietApi.ts
    gymApi.ts
    healthApi.ts                  # NEW
    eventsApi.ts                  # optional: read-only debug view of the context bus

  /store                          # Zustand (lightweight, fits solo-project scope)
    authStore.ts
    dietStore.ts
    gymStore.ts
    healthStore.ts                # NEW

  /types
    diet.ts
    gym.ts
    health.ts                     # NEW — SleepData, ReadinessScore, StepData shapes
    events.ts

  /utils
    dateRange.ts
    formatters.ts                 # e.g. formatMacro, formatDuration
```

**Why this shape:** `/components/ui` is the actual "polish" investment — every screen composes from these instead of one-off styling, so the app feels coherent instead of like separately-built screens. `/health` is treated as a peer to diet/gym everywhere (component, hook, store, service) rather than bolted onto home — cleaner to reuse when Jarvis eventually wants readiness data.

---

## `/backend` (Python + FastAPI)

```
/backend
  /routers
    auth.py
    diet.py
    gym.py
    health.py                    # NEW — GET /health/today, /health/history
    wearables.py                 # NEW — OAuth callbacks + manual sync trigger
    events.py                    # read/debug endpoint for the context bus

  /models                        # SQLAlchemy ORM
    user.py
    meal.py
    workout.py
    daily_target.py
    health_metric.py             # NEW — unified table: date, sleep_score, readiness, steps, resting_hr, source
    wearable_connection.py       # NEW — user_id, provider, access_token, refresh_token, last_synced_at
    event.py

  /schemas                        # Pydantic request/response models (mirrors /models but API-facing)
    meal.py
    workout.py
    health.py                     # NEW
    wearable.py                   # NEW

  /services                       # business logic, UI-agnostic (the "durable asset")
    diet_service.py               # log_meal(), get_daily_calories()
    gym_service.py                # log_workout(), get_workout_history()
    health_service.py             # NEW — get_daily_readiness(), get_health_summary()
    events_service.py             # emit_event() — single choke point every service calls
    dashboard_service.py          # NEW — blends diet+gym+health into one home payload

  /integrations                   # NEW — one adapter per wearable provider, isolated on purpose
    base.py                       # WearableProvider interface: fetch_sleep(), fetch_steps(), fetch_readiness()
    apple_health.py                # HealthKit export/webhook parsing
    oura.py                        # Oura Cloud API client
    whoop.py                       # Whoop API client
    normalizer.py                  # maps each provider's raw payload → your health_metric schema

  /workers                        # NEW — background jobs, not request-triggered
    sync_wearables.py             # periodic pull (cron/APScheduler) per connected provider
    __init__.py

  /core
    config.py                     # env vars, settings
    security.py                   # JWT issuing/verification, password hashing
    db.py                         # session/engine setup

  /tests
    test_diet_service.py
    test_gym_service.py
    test_health_service.py        # NEW
    test_events_service.py

  main.py                          # FastAPI app instantiation, router registration, middleware
```

**Why `/integrations` is separate from `/services`:** wearable APIs are flaky, rate-limited, and each has a different auth model (OAuth token refresh, webhook vs. polling). Isolating them behind a `WearableProvider` interface means `health_service.py` never touches provider-specific code — swapping Oura for Whoop, or adding a second device later, doesn't ripple through the app. `normalizer.py` is the seam that keeps your `health_metric` table provider-agnostic.

**Why health data gets its own table instead of joining into `events` only:** events are a fire-and-forget log ("steps synced"); `health_metric` is queryable daily state ("what was readiness on July 30") that your dashboard needs to read fast. Sync jobs write to `health_metric` *and* emit an event — best of both.

---

## `/docs`

```
/docs
  lessons_learned.md
  architecture.md                # this doc, kept current as you build
  wearable_provider_notes.md     # NEW — auth quirks, rate limits, field mappings per provider
```

---

## Data flow for the new health piece

```
Wearable API (Oura/Whoop/Apple Health)
   → /integrations/{provider}.py   (fetch raw)
   → /integrations/normalizer.py   (map to common shape)
   → health_service.py             (validate, upsert into health_metric)
   → events_service.py             (emit "health_synced" event)
   → dashboard_service.py          (reads health_metric + meals + workouts → one home payload)
   → GET /health/today, GET /home  (frontend hooks consume)
```
