export type TeamRole = "owner" | "admin" | "member";
export type TeamMemberStatus = "active" | "invited";

export type TeamWorkspacePayload = {
  id: string;
  name: string;
  current_user_role: TeamRole;
  seats_included: number;
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
  }>;
  shared_snippets: Array<{
    id: string;
    trigger: string;
    expansion: string;
  }>;
  shared_dictionary: Array<{
    id: string;
    term: string;
    note?: string | null;
  }>;
};
