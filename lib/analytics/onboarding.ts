import posthog from 'posthog-js'
import { supabase } from '@/lib/supabase'

export type OnboardingAction = 'entered' | 'completed' | 'skipped' | 'back'

export async function trackOnboardingStep(
  step: string,
  action: OnboardingAction,
  metadata?: Record<string, unknown>
) {
  posthog.capture('onboarding_step', { step, action, ...metadata })
  try {
    if (!supabase) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('onboarding_events').insert({ user_id: user.id, step, action, metadata: metadata ?? {} })
  } catch { /* nie User-Flow unterbrechen */ }
}
