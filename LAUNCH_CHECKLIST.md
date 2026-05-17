# Endopamin Launch Checklist

## Technical

- [ ] Environment variables configured in Vercel/Netlify.
- [ ] Supabase RLS policies tested for profiles, workouts, nutrition, check-ins, metrics, and notifications.
- [ ] Gemini API error handling verified with quota and model fallback cases.
- [ ] Loading states reviewed for all fetch and AI calls.
- [ ] Mobile viewport tested at 390px width.
- [ ] Dark mode reviewed for contrast and no light-mode regressions.
- [ ] Firebase service worker registers and receives foreground/background messages.
- [x] `npm run build` completes without errors.

## UX

- [ ] Three-step onboarding works end to end.
- [ ] Coach AI returns real Gemini messages.
- [ ] Voice playback works on iOS and Android.
- [ ] Notifications permission request appears at the right moment.
- [x] Desk Break timer completes a full session.
- [ ] Share Card downloads successfully.

## Business

- [ ] Paywall modal appears for gated Pro features.
- [ ] Free tier limits are enforced.
- [ ] Analytics configured with PostHog or Google Analytics.

## Launch

```bash
npm run build
npx vercel --prod
```

Netlify alternative:

```bash
npm run build
```

Then deploy the `dist` folder.

