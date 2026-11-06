# Personal Health & Training Tracker: Project Brief
*Oct 23, 2026 · @Prathik*

## Vision
A private, single-user health tracker that combines Apple Watch data, a lifting log, a food diary and a pantry, so you open one app instead of several. It aims to replace MyFitnessPal, Liftoff and your Google Sheets program. A later AI layer will adjust your diet, steps and recommendations to keep your goals on track.

## User and Goals
- **User:** You alone. There is no login, and one profile record stores your info.
- **Training:** Powerlifting (squat, bench, deadlift) plus explosive work, building toward fight sports.
- **Current cut:** 160 lb to 150 lb, at 2.1k calories and 10k steps a day.
- **Timeline:** The cut is a soft target, with a planned pause around Dec 16. The AI changes mode (maintain, bulk) only when you tell it in chat.
- **Progress measure:** A 7-day average of body weight, never a single morning's reading.

## Platform and Architecture
- **Front end:** A dark-mode PWA on iPhone, built with React and TypeScript.
- **Back end:** A Node/TS API on your home server, with a possible Python service for the AI layer later.
- **Access:** Private network only (for example Tailscale) with HTTPS. No password is needed for a single user.
- **Android:** A native app is planned later, so the data layer stays separate from the UI.
- **Data in:**
  - Apple Watch metrics (steps, sleep stages, resting heart rate, HRV) come through a one-time Shortcut or helper-app export.
  - Weight comes from the VeSync scale via Apple Health.
  - Body composition is a later extra.

## Offline and Sync Rules
- Offline, you can read the day's plan and diary.
- You can log sets and foods that already exist. These save on the phone and sync when the server is reachable.
- Adding anything new to the database (a new food or exercise) requires the server, which prevents duplicates.
- **Food lookup order:** Your server's database first, then an external API (USDA or Open Food Facts), saving the result to your server.

## App Structure
The app has five dark-mode tabs: data-centric, but not cluttered.
1. **Home:** Step average, goal and current steps, sleep stages summary, readiness arc (score plus red-to-green fill), today's lift, next meal, a muscle-group body graph, and pending suggestions.
2. **Gym:**
   - **Google Sheets-style program block at top:** Displays weeks and prescribed %-of-PR weights. Fully editable so you can customize or adjust block lengths (4, 5, 6 weeks).
   - **Daily routines & schedule below:** Select a scheduled workout to view and log exercises.
   - **Programmed vs Non-Programmed auto-population:**
     - Primary SBD lifts auto-fill target weights directly from the program formula ($\text{PR} \times \text{Week \%}$). Previous weights are not needed here.
     - Non-programmed exercises (accessories, explosive work) auto-fill previous performance for progressive overload tracking.
   - **Role separation:** Distinguishes primary competition lifts (`primary_sbd`) from tempo or volume variations (`variation`) so accessory numbers never pollute competition 1RM history.
   - **Set logging:** Set number, previous result (for accessories), input fields, completion check, and "+ Add Set".
   - **Lifts ranking:** Liftoff-style strength rankings.
   - **Rest timer:** In-app timer keeps running with the screen locked.
3. **Diet:**
   - Calories and macros sit at the top and drill down to comprehensive micronutrients (vitamins, minerals, lipids, sodium, potassium, etc.), backed by USDA and Open Food Facts.
   - The main view is a calendar-style daily timeline.
   - Sub-sections such as spices show specific amounts.
4. **Pantry:** A typed food list with optional quantities.
5. **Settings:** Profile, goals, restrictions and allergy tolerances, lift rankings, and PRs.

## Gym Details
- **Program:** Custom training blocks (5-week default: two weeks volume, one week CNS, one week taper, one week PR testing; editable to any block length).
  - Explicit active pointers (`currentWeek`, `currentDay`) keep track of where you are in the block reliably.
  - New PRs update future blocks automatically.
- **Lifts & Swapping:** SBD lifts anchor the block, but exercises can be swapped if needed ("just today" or "update plan going forward") without breaking the top sheet or block progression.
- **Logging per set:** Set number, reps, weight, and percent of PR (for SBD). RPE is optional.
- **Per-exercise tracking type:** A fixed menu (reps, reps and weight, time, time and weight, distance, height) plus a custom option.
- **Custom exercises:** Saved to the server database and tagged with muscle groups.

## Diet Details
- **Nutrient depth:** Calories, macros, and full micronutrients (saturated/trans fat, cholesterol, vitamins, minerals, electrolytes), extensible for any nutrient provided by USDA or Open Food Facts.
- **Entry sources:** Numbers you give are used as is. Otherwise the AI estimates, and estimated entries carry a visible label and can be edited.
- **Diary style:** MyFitnessPal-like, with every edit instantly updating the remaining budget and recommendations.
- **Profile-driven exclusions:** Your stated restrictions (for example Hindu, nut allergy) generate an editable never-recommend list.
- **Allergy severity:** Each allergen has a tolerance rule and a three-level alert system.
  - **Red error:** Contains the allergen at an unsafe level.
  - **Warning:** "May contain" or borderline.
  - **Allowed with a note:** Present within your tolerance.
  - *Example:* Sesame is a red error unless it is the last ingredient, which triggers a warning. The app always shows its reasoning.
- **Rule type:** These checks are deterministic code, not AI judgment.
- **Learning period:** The first 7 days observe what you eat and take stated likes.

## Health & Sleep Details
- **Apple Watch Sleep Stages:** Captures Core, Deep, REM, and Awake stages.
  - Aggregated daily stats feed into the rule-based readiness calculation.
  - Interactive hypnogram: Clicking the sleep graph reveals the full time-based interval breakdown across the night.
- **Readiness Score:**
  - **Inputs:** Sleep (duration & quality/stages), resting heart rate, HRV if available, and recent training load, compared against your own baseline.
  - **Behavior:** Advisory only.
  - **Low readiness:** Proposes lowering the step goal and adjusting calories so the cut stays on track. You accept or dismiss each proposal.
  - **Lifting:** Weights and volume change only if you tell the chat.

## AI Layer (Later Phase)
- **Chat:** The control layer for exceptions (travel, maintenance, bulk, PR-week tweaks).
- **Rolling window:** The AI works over the last 7 days to avoid sudden swings, and missed intake is spread across the week.
- **Tier 1 (cloud API, acceptable):** Chat, nutrition estimates, and basic suggestions.
- **Tier 2 (local model, after a hardware upgrade):** Complex recommendations such as meal plans from your pantry within your restrictions. The end goal is a fully private AI.

## Milestones
Each milestone is usable on its own, so you can pick the project up for a single evening and still finish something.
1. Server, data import, and the Home tab with the rule-based readiness score and sleep stage breakdown.
2. Gym tab, with the editable Google Sheets block, SBD %-of-PR auto-fill, accessory previous weight auto-fill, the timer, and exercise database.
3. Diet tab with USDA/Open Food Facts food search and comprehensive macro/micro tracking.
4. Pantry, allergy and restriction system, and Settings.
5. Offline logging and sync.
6. AI chat, estimates, and suggestions through the API.
7. Local AI and body composition, once the hardware arrives and the scale data is confirmed.

## Constraints and Success Criteria
- **Timeline and hours:** Open-ended, with no fixed date or weekly hours. It is a side project for your spare time.
- **Skills:** Years of coding experience, with Python, React, Node/TS, some C++, and a home-server setup from your music player project.
- **Success:** You stop opening MyFitnessPal, Liftoff, and your Google Sheet.

## Open Items to Verify Early
- [ ] Which scale metrics (weight, body fat, and so on) the VeSync scale actually writes to Apple Health
- [ ] Whether your Watch exports HRV, resting heart rate, and sleep stage intervals reliably through the Shortcut or Health Auto Export
- [ ] Whether Safari can keep the rest timer alive with the screen locked (otherwise use a notification-based fallback)
- [ ] Where the Hindu dietary rules vary, so you can edit the generated exclusion list
