export interface VoteOption {
  id: string;
  cluster_id: string | null;
  label: string;
}

export interface VoteSession {
  id: string;
  question: string;
  options: VoteOption[];
  status: "draft" | "active" | "closed";
  created_at: string;
  closed_at: string | null;
}

export interface FeatureCluster {
  id: string;
  title: string;
  description: string | null;
  request_count: number;
  priority_score: number;
  status: string;
  tags: string[];
  created_at: string;
}

export interface CommunityVote {
  id: string;
  session_id: string;
  user_id: string;
  selected_option_id: string;
  free_text: string | null;
  weight: number;
  created_at: string;
}
