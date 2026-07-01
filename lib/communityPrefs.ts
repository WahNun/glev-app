import { supabase } from "./supabase";

export type CommunityPrefs = {
  votingVisible: boolean;
  votingEnabled: boolean;
};

export async function fetchCommunityPrefs(): Promise<CommunityPrefs> {
  if (!supabase) return { votingVisible: false, votingEnabled: false };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { votingVisible: false, votingEnabled: false };

  const { data, error } = await supabase
    .from("profiles")
    .select("community_voting_visible, community_voting_enabled")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) return { votingVisible: false, votingEnabled: false };

  return {
    votingVisible: data.community_voting_visible === true,
    votingEnabled: data.community_voting_enabled === true,
  };
}
