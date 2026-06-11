# Graph Report - Edopamin  (2026-06-11)

## Corpus Check
- 167 files · ~412,039 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1025 nodes · 1764 edges · 82 communities (69 shown, 13 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 3 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9a8ff10b`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 69|Community 69]]

## God Nodes (most connected - your core abstractions)
1. `useAuth()` - 63 edges
2. `chatWithCoach()` - 18 edges
3. `getCoach()` - 15 edges
4. `useNutritionStore` - 15 edges
5. `parseHubScanFromText()` - 14 edges
6. `scripts` - 12 edges
7. `GeminiLiveSession` - 12 edges
8. `flattenForExtraction()` - 12 edges
9. `parseNutritionFromAiText()` - 12 edges
10. `expo` - 11 edges

## Surprising Connections (you probably didn't know these)
- `useSupabaseClient()` --calls--> `useAuth()`  [INFERRED]
  mobile/src/lib/supabase.ts → src/context/AuthContext.jsx
- `MeScreen()` --calls--> `useAuth()`  [INFERRED]
  mobile/src/screens/MeScreen.tsx → src/context/AuthContext.jsx
- `NutritionHub()` --calls--> `useAuth()`  [EXTRACTED]
  src/features/nutrition/pages/NutritionHub.jsx → src/context/AuthContext.jsx
- `OnboardingPage()` --calls--> `useAuth()`  [EXTRACTED]
  src/pages/OnboardingPage.jsx → src/context/AuthContext.jsx
- `ProfilePage()` --calls--> `useAuth()`  [EXTRACTED]
  src/pages/ProfilePage.jsx → src/context/AuthContext.jsx

## Import Cycles
- None detected.

## Communities (82 total, 13 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (38): ProtectedRoute(), FREE_LIMITS, isProUser(), PRO_FEATURES, AuthContext, AuthProvider(), isProfileComplete(), useAuth() (+30 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (38): AuthGate(), AuthInput(), SignInForm(), SignUpForm(), tokenCache, GradientButton(), GradientButtonProps, ScreenContainer() (+30 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (39): NAV_ITEMS, ErrorBoundary, firebaseConfig, getMessagingIfSupported(), onForegroundMessage(), requestFCMToken(), checkUserAbsence(), coachDisplayName() (+31 more)

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (44): PlanPreviewScreen(), COACH_ID_ALIASES, COACH_META, COACHES, getCoach(), resolveCoachId(), COACH_SYSTEM_PROMPTS, formatCoachMemoryForPrompt() (+36 more)

### Community 4 - "Community 4"
Cohesion: 0.11
Nodes (48): CATEGORIES, FoodDatabaseSearch(), foodCategories, foodDatabase, macrosForGrams(), searchFoodDatabase(), analyzeFoodImage(), applyLookupFallback() (+40 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (27): mockSearchFoodsLocal(), searchFoods(), sendVoiceCoachTurn(), sendVoiceCoachTurnDemo(), AudioWaveform(), CalorieLogPanel(), FoodScanner(), GlassCard() (+19 more)

### Community 6 - "Community 6"
Cohesion: 0.04
Nodes (47): dependencies, firebase, framer-motion, @google/generative-ai, html2canvas, lucide-react, react, react-dom (+39 more)

### Community 7 - "Community 7"
Cohesion: 0.10
Nodes (35): buildCoachExerciseContext(), buildWorkoutPlan(), buildCoachReferenceContext(), buildCoachReferenceContextAsync(), buildExerciseLibraryBlock(), buildWgerExercisePromptContext(), CATEGORY_KEYWORDS, detectExerciseCategory() (+27 more)

### Community 8 - "Community 8"
Cohesion: 0.05
Nodes (6): cardBase, cardSel, DEFAULT, PLAN_LOADING_PHASES, ProfilePage(), STEPS

### Community 9 - "Community 9"
Cohesion: 0.06
Nodes (30): dependencies, @clerk/clerk-expo, expo, expo-linear-gradient, expo-secure-store, expo-status-bar, nativewind, react (+22 more)

### Community 10 - "Community 10"
Cohesion: 0.11
Nodes (20): COACH_NEURAL_VOICES, coachAudioRef, duckBackgroundAudio(), duckedMediaVolumes, forceRestoreBackgroundAudio(), getAvailableVoices(), getCoachVoiceName(), getSpeechRecognitionRestartDelay() (+12 more)

### Community 11 - "Community 11"
Cohesion: 0.11
Nodes (16): getExerciseById(), DESK_CATEGORIES, DeskExerciseModal(), ExerciseCard(), formatDeskDuration(), getCategoryStyle(), GYM_CATEGORIES, HOME_CATEGORIES (+8 more)

### Community 12 - "Community 12"
Cohesion: 0.13
Nodes (21): ACTIVE_RECOVERY_EXERCISES, applySessionDurationToFallbackPlan(), blobToBase64(), buildKnowledgeContext(), COACH_GENERATION_CONFIG, fetchTrainingKnowledge(), fetchTrainingKnowledgeForOnboarding(), GEMINI_API_KEY (+13 more)

### Community 13 - "Community 13"
Cohesion: 0.10
Nodes (15): BAR_COLORS, buildPrRows(), buildWeeklyChart(), calculateActivityRings(), countDistinctLogDays(), DATA, formatPrDate(), formatWeightDiff() (+7 more)

### Community 14 - "Community 14"
Cohesion: 0.26
Nodes (19): BarcodeScanner(), buildBarcodeLogResult(), extractGeminiText(), fetchFromGeminiFallback(), fetchFromOpenFoodFacts(), fetchOffProductOnce(), isNetworkFailure(), lookupBarcodeProduct() (+11 more)

### Community 15 - "Community 15"
Cohesion: 0.12
Nodes (11): useTokenGuard(), isSpeaking(), markIosVoiceWarningShown(), setVoiceMode(), ATHLETE_STATUSES, COACH_PERSONA_ALIASES, COACHES, CoachPage() (+3 more)

### Community 16 - "Community 16"
Cohesion: 0.12
Nodes (9): buildAthleteProfile(), calcBmi(), COACHES, EXPERIENCE, GOALS, LOADING_PHASES, OnboardingPage(), toCm() (+1 more)

### Community 17 - "Community 17"
Cohesion: 0.14
Nodes (10): createSilentKeepAlive(), getCoachImageSrc(), updateMediaSessionMetadata(), useVoiceSession(), sanitizeTranscript(), createVoiceActivityDetector(), stopSpeaking, VOICE_MODES (+2 more)

### Community 18 - "Community 18"
Cohesion: 0.15
Nodes (14): CATEGORIES, EQUIPMENT_FILTERS, ExerciseDetailModal(), ExerciseLibrary(), findCategoryByKey(), getThumbnailUrl(), isCoolDownExercise(), isLegsExercise() (+6 more)

### Community 19 - "Community 19"
Cohesion: 0.13
Nodes (7): EXERCISE_LIBRARY, EXERCISE_SETTINGS, getExercisesBySetting(), LEVELS, LIBRARY_STATS, EQUIPMENT_MAP, RISK_OVERRIDES

### Community 20 - "Community 20"
Cohesion: 0.16
Nodes (11): ACTIVITY_MULTIPLIERS, calculateNutritionTargets(), dedupeUsdaResults(), MEAL_CAL_SPLIT, MEAL_META, normalizeGoal(), nutritionCompletenessScore(), NutritionHub() (+3 more)

### Community 21 - "Community 21"
Cohesion: 0.18
Nodes (11): DESK_BREAK_COACH_MESSAGES, DESK_BREAKS, DeskBreakSession(), EXERCISE_ICONS, getIcon(), DeskBreakSession(), EXERCISE_ICONS, getIcon() (+3 more)

### Community 22 - "Community 22"
Cohesion: 0.19
Nodes (12): generateWorkoutPlan(), buildProgressPrompt(), getPlanProgressSummary(), COACH_COLORS, EQUIPMENT_MAP, ex(), FALLBACK_PLAN(), generateWorkoutPlanWithRetry() (+4 more)

### Community 23 - "Community 23"
Cohesion: 0.13
Nodes (14): backgroundColor, adaptiveIcon, expo, android, assetBundlePatterns, ios, name, orientation (+6 more)

### Community 24 - "Community 24"
Cohesion: 0.20
Nodes (3): GEMINI_API_KEY, GeminiLiveSession, getLiveWsUrl()

### Community 25 - "Community 25"
Cohesion: 0.27
Nodes (12): askGeminiChatStream(), askGeminiWithImage(), assertConfigured(), buildRequestPayload(), endpoint(), generateAudioContent(), generateChatContent(), generateContent() (+4 more)

### Community 26 - "Community 26"
Cohesion: 0.27
Nodes (10): normalizeAthleteGoal(), getNutritionPlanSubtitle(), normalizeNutritionGoal(), formatFoods(), getCoachNoteBullets(), GOAL_COACH_NOTES, MEAL_COLORS, MealCard() (+2 more)

### Community 27 - "Community 27"
Cohesion: 0.17
Nodes (11): background_color, categories, description, display, icons, name, orientation, scope (+3 more)

### Community 28 - "Community 28"
Cohesion: 0.25
Nodes (9): VoiceConversation(), useWorkout(), createSpeechRecognition(), getSpeechRecognitionClass(), isIOSDevice(), playListeningBeep(), prepareSpeechInputOnUserGesture(), resumeAudioContextOnUserGesture() (+1 more)

### Community 29 - "Community 29"
Cohesion: 0.25
Nodes (9): CoachContext, createInitialSession(), getAssessmentGreeting(), loadStoredMessages(), persistMessages(), sessionKey(), useCoachChat(), useCoachSession() (+1 more)

### Community 30 - "Community 30"
Cohesion: 0.33
Nodes (7): buildTrainingKnowledgeBlock(), formatTrainingKnowledgeForPrompt(), LEVEL_RANK, normalizeGoal(), normalizeLocation(), selectTrainingKnowledge(), TRAINING_KNOWLEDGE

### Community 31 - "Community 31"
Cohesion: 0.31
Nodes (8): bodyPartCache, clearExerciseCache(), fetchAllExercises(), fetchBodyPartList(), fetchByBodyPart(), fetchExerciseDB(), searchCache, searchExercises()

### Community 32 - "Community 32"
Cohesion: 0.22
Nodes (8): maxDuration, buildCommand, crons, framework, functions, api/gemini.js, outputDirectory, rewrites

### Community 33 - "Community 33"
Cohesion: 0.25
Nodes (7): compilerOptions, baseUrl, paths, strict, extends, include, @/*

### Community 34 - "Community 34"
Cohesion: 0.46
Nodes (7): getCurrentUser(), requireSupabase(), signIn(), signInWithApple(), signInWithGoogle(), signOut(), signUp()

### Community 35 - "Community 35"
Cohesion: 0.36
Nodes (6): getTimeOfDay(), getWelcomeMessage(), HOUR, MESSAGES, personalize(), pick()

### Community 36 - "Community 36"
Cohesion: 0.43
Nodes (7): FALLBACK_WORKOUT_BODYWEIGHT_FEMALE(), FALLBACK_WORKOUT_BODYWEIGHT_MALE(), FALLBACK_WORKOUT_FEMALE(), FALLBACK_WORKOUT_MALE(), fallbackEx(), getFallbackWorkoutPlan(), usesBodyweightEquipment()

### Community 37 - "Community 37"
Cohesion: 0.53
Nodes (5): COACH_PERSONALITIES, generateContent(), getAccessToken(), handler(), sendFCM()

### Community 38 - "Community 38"
Cohesion: 0.33
Nodes (5): Business, Endopamin Launch Checklist, Launch, Technical, UX

### Community 39 - "Community 39"
Cohesion: 0.40
Nodes (5): cache, getExerciseData(), getWgerImage(), NAME_MAP, WGER_IDS

### Community 40 - "Community 40"
Cohesion: 0.60
Nodes (4): config, estimateBodyBytes(), handler(), isPayloadTooLargeError()

### Community 41 - "Community 41"
Cohesion: 0.70
Nodes (4): extractClientSecret(), getStripe(), handler(), resolveClientSecret()

### Community 42 - "Community 42"
Cohesion: 0.40
Nodes (3): { createClient }, Stripe, supabase

### Community 43 - "Community 43"
Cohesion: 0.40
Nodes (4): FOOD_ITEM_SCHEMA, FOOD_SCAN_GENERATION_CONFIG, FOOD_SCAN_RESPONSE_SCHEMA, TOTAL_SCHEMA

### Community 44 - "Community 44"
Cohesion: 0.40
Nodes (5): buildAthleteFromForm(), buildAthleteFromProfile(), calcBmi(), toCm(), toKg()

### Community 47 - "Community 47"
Cohesion: 0.50
Nodes (3): config, { getDefaultConfig }, { withNativeWind }

### Community 50 - "Community 50"
Cohesion: 0.50
Nodes (3): Expanding the ESLint configuration, React Compiler, React + Vite

## Knowledge Gaps
- **268 isolated node(s):** `stripe`, `COACH_PERSONALITIES`, `config`, `stripe`, `supabase` (+263 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useAuth()` connect `Community 0` to `Community 1`, `Community 2`, `Community 3`, `Community 5`, `Community 8`, `Community 13`, `Community 15`, `Community 16`, `Community 18`, `Community 20`, `Community 21`, `Community 22`, `Community 26`, `Community 28`, `Community 29`?**
  _High betweenness centrality (0.260) - this node is a cross-community bridge._
- **Why does `MeScreen()` connect `Community 1` to `Community 0`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **Why does `BarcodeScanner()` connect `Community 14` to `Community 20`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `useAuth()` (e.g. with `useSupabaseClient()` and `MeScreen()`) actually correct?**
  _`useAuth()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `stripe`, `COACH_PERSONALITIES`, `config` to the rest of the system?**
  _268 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06013986013986014 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06448412698412699 - nodes in this community are weakly interconnected._