# Glev

## Overview

Glev is a Type 1 Diabetes insulin decision-support system designed to provide personalized insulin recommendations. It analyzes historical meal data, glucose levels, and insulin dosages to offer data-driven insights and empower users in managing their diabetes. The project integrates with Supabase for data and authentication and uses AI for meal parsing and recommendation logic.

## User Preferences

- I prefer simple language.
- I want iterative development.
- Ask before making major changes.
- I prefer detailed explanations.

## System Architecture

**Frontend:**
- Developed with Next.js 15 App Router, running on port 5000, featuring a mobile-first, responsive design.
- Theming system in `app/globals.css` supports dark and light modes, maintaining consistent brand accents.
- Navigation includes a sidebar for desktop and bottom navigation for mobile.
- Some pages, like `app/mockups/dark-cockpit/page.tsx`, are intentionally dark for fixed product mockups.

**Backend/API:**
- Supabase manages user authentication (email/password) and PostgreSQL database operations.
- `src/middleware.ts` protects all authenticated routes.
- An Express 5 API server (`artifacts/api-server`) is available for development support.

**Core Logic & Features:**
- **Meal Classification:** Meals are categorized as `FAST_CARBS`, `HIGH_PROTEIN`, `HIGH_FAT`, or `BALANCED` based on macronutrient content.
- **Dose Evaluation:** Insulin doses are evaluated as `GOOD`, `HIGH` (overdose), or `LOW` (underdose) using an Insulin-to-Carbohydrate Ratio (ICR) formula.
- **Glev Engine:** Provides AI-driven insulin recommendations by identifying similar historical meals and assigning a confidence level (HIGH, MEDIUM, LOW). The Engine page features a dynamic layout for chat interaction.
- **Data Seeding:** The dashboard loads realistic T1D meals for new users if their meal entries are empty.
- **Localization:** Uses `next-intl` with `de` (default) and `en` locales, resolving locale preferences from cookies or `Accept-Language` headers.
- **Insulin & Exercise Logging:** New tables (`insulin_logs`, `exercise_logs`) and API routes support logging and retrieving insulin dosages and exercise activities, which the Engine considers for recommendations (safety hooks provide warnings without altering dosage).
- **Native Shells (Capacitor):** iOS and Android apps are thin Capacitor 8.x webview shells loading `https://glev.app`, allowing instant content updates.
- **Operator-Tools (`/admin/*`):** Drei `ADMIN_API_SECRET`-gegateete Tabs, die sich ein gemeinsames `glev_admin_token`-Cookie teilen: `/admin/buyers` (Käufer:innen-Liste), `/admin/drip` (Drip-Mail-Pipeline-Status & manuelle Aktionen) und `/admin/emails` (Live-Preview aller Mail-Templates inkl. Welcome + Drip — rendert direkt aus `lib/emails/*` damit „was du siehst" garantiert „was Resend schickt" ist; Variablen via `?name=` und `?email=` per URL).

**Data Models:**
- `meals` table stores meal details, including `input_text`, `parsed_json`, glucose levels, carbs, insulin, meal type, and evaluation.
- `user_preferences` table stores per-user UI preferences like dashboard and insights card order.

## External Dependencies

- **Supabase:** PostgreSQL database, authentication, and user preference storage.
- **OpenAI GPT-5:** AI functionalities for meal parsing and other AI features, integrated via Replit AI Integrations.
- **Next.js 15:** Frontend framework.
- **React:** UI library.
- **Vite:** Frontend tooling for design sandbox.
- **Express 5:** API server framework for development.
- **next-intl:** Localization library.
- **Playwright:** End-to-end and unit testing.
- **Capacitor 8.x:** Used for wrapping the web application into native iOS and Android shells.
- **Web Speech API:** Provides voice input functionality.
- **HealthKit (iOS):** Used for background blood glucose synchronization on iOS devices.