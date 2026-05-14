export type TeamRole = "owner" | "admin" | "member";
export type TeamMemberStatus = "active" | "invited";

export type TeamWorkspacePayload = {
  id: string;
  name: string;
  current_user_role: TeamRole;
  seats_included: number;
  processing_region?: "ca" | "us";
  shared_lexicon_enabled?: boolean;
  billing_contact_email: string;
  support_contact_email: string;
  members: Array<{
    id: string;
    user_id?: string | null;
    name: string;
    email: string;
    role: TeamRole;
    status: TeamMemberStatus;
  }>;
  shared_templates: Array<{
    id: string;
    name: string;
    description: string;
    prompt: string;
    created_at?: string | null;
    updated_at?: string | null;
    created_by_name?: string | null;
    created_by_email?: string | null;
    updated_by_name?: string | null;
    updated_by_email?: string | null;
  }>;
  shared_snippets: Array<{
    id: string;
    trigger: string;
    expansion: string;
    created_at?: string | null;
    updated_at?: string | null;
    created_by_name?: string | null;
    created_by_email?: string | null;
    updated_by_name?: string | null;
    updated_by_email?: string | null;
  }>;
  shared_dictionary: Array<{
    id: string;
    term: string;
    note?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
    created_by_name?: string | null;
    created_by_email?: string | null;
    updated_by_name?: string | null;
    updated_by_email?: string | null;
  }>;
};
