import { redirect } from "next/navigation";

// /beta/welcome ist die success_url unseres neuen Beta-Stripe-Checkouts.
// Die eigentliche Verify-Payment-+-Signup-Logik lebt aber an /welcome
// (gleiches Muster wie /beta/success → /welcome). Hier nur der 307-
// Server-Redirect mit Query-String-Passthrough, damit /welcome den
// session_id für /api/verify-payment hat. Kein client-JS, kein Flash.
export default async function BetaWelcomeRedirect({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = await searchParams;
  redirect(
    session_id
      ? `/welcome?session_id=${encodeURIComponent(session_id)}`
      : `/welcome`,
  );
}
