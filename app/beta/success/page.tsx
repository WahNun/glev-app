import { redirect } from "next/navigation";

// /beta/success is the Stripe checkout return URL; we used to render
// a confirmation screen here, but the unified onboarding now lives
// at /welcome (handles "thanks + here's what to do next" for both
// fresh signups and returning beta payers in one place). Redirect
// is a server-side 307 — no flash, no client JS required.
export default function BetaSuccessPage() {
  redirect("/welcome");
}
