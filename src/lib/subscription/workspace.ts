import type { AuthSession } from "@/lib/auth/types";
import type { AppPlan } from "./plans";

export type TeamRole = "owner" | "admin" | "member";
export type TeamMemberStatus = "active" | "invited";

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  status: TeamMemberStatus;
};

export type SharedWorkspaceTemplate = {
  id: string;
  name: string;
  description: string;
  prompt: string;
};

export type SharedWorkspaceSnippet = {
  id: string;
  trigger: string;
  expansion: string;
};

export type SharedWorkspaceTerm = {
  id: string;
  term: string;
  note?: string;
};

export type TeamWorkspace = {
  id: string;
  name: string;
  currentUserRole: TeamRole;
  seatsIncluded: number;
  billingContactEmail: string;
  supportContactEmail: string;
  members: TeamMember[];
  sharedTemplates: SharedWorkspaceTemplate[];
  sharedSnippets: SharedWorkspaceSnippet[];
  sharedDictionary: SharedWorkspaceTerm[];
};

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

export type SharedWorkspaceTemplatePayload =
  TeamWorkspacePayload["shared_templates"][number];
export type SharedWorkspaceSnippetPayload =
  TeamWorkspacePayload["shared_snippets"][number];
export type SharedWorkspaceTermPayload =
  TeamWorkspacePayload["shared_dictionary"][number];

const WORKSPACE_STORAGE_PREFIX = "vocalype.workspace.";

export function deriveTeamWorkspace(
  session: AuthSession | null,
  plan: AppPlan,
): TeamWorkspace | null {
  if (plan !== "small_agency" || !session?.user?.email) {
    return null;
  }

  const userName =
    session.user.name?.trim() || session.user.email.split("@")[0] || "Owner";
  const domain = session.user.email.split("@")[1] || "team.vocalype";
  const workspaceName = `${userName.split(" ")[0]}'s agency`;

  return {
    id: `workspace-${session.user.id}`,
    name: workspaceName,
    currentUserRole: "owner",
    seatsIncluded: 5,
    billingContactEmail: session.user.email,
    supportContactEmail: "priority@vocalype.com",
    members: [
      {
        id: session.user.id,
        name: userName,
        email: session.user.email,
        role: "owner",
        status: "active",
      },
    ],
    sharedTemplates: [
      {
        id: "team-intake",
        name: "Scorecard intake",
        description: "Standardise les notes d'appel candidat pour toute l'equipe.",
        prompt:
          "Turn the dictated text into a recruiter scorecard for the team. Keep the original language. Structure with: fit, strengths, concerns, compensation, and next step. Return only the final scorecard. Text: ${output}",
      },
      {
        id: "team-shortlist",
        name: "Client shortlist update",
        description: "Resume client partage pour envoyer un shortlist propre.",
        prompt:
          "Transform the dictated text into a concise shortlist update for the client. Keep the original language. Include candidate status, fit, risks, and recommended next step. Return only the final client-ready update. Text: ${output}",
      },
    ],
    sharedSnippets: [
      {
        id: "snippet-1",
        trigger: "envoie le debrief",
        expansion: "Je t'envoie le debrief complet dans l'heure avec les prochaines etapes.",
      },
      {
        id: "snippet-2",
        trigger: "shortlist client",
        expansion: "Je partage la shortlist client aujourd'hui avec les points de vigilance et la recommandation finale.",
      },
    ],
    sharedDictionary: [
      {
        id: "term-1",
        term: "Greenhouse",
        note: "ATS principal de l'equipe",
      },
      {
        id: "term-2",
        term: "scorecard",
      },
      {
        id: "term-3",
        term: domain.split(".")[0],
        note: "Nom de domaine equipe",
      },
    ],
  };
}

export function mapTeamWorkspacePayload(
  payload: TeamWorkspacePayload,
): TeamWorkspace {
  return {
    id: payload.id,
    name: payload.name,
    currentUserRole: payload.current_user_role,
    seatsIncluded: payload.seats_included,
    billingContactEmail: payload.billing_contact_email,
    supportContactEmail: payload.support_contact_email,
    members: payload.members.map((member) => ({
      id: member.id,
      name: member.name,
      email: member.email,
      role: member.role,
      status: member.status,
    })),
    sharedTemplates: mapSharedTemplates(payload.shared_templates),
    sharedSnippets: mapSharedSnippets(payload.shared_snippets),
    sharedDictionary: mapSharedDictionary(payload.shared_dictionary),
  };
}

export function mapSharedTemplates(
  templates: SharedWorkspaceTemplatePayload[],
): SharedWorkspaceTemplate[] {
  return templates.map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    prompt: template.prompt,
  }));
}

export function mapSharedSnippets(
  snippets: SharedWorkspaceSnippetPayload[],
): SharedWorkspaceSnippet[] {
  return snippets.map((snippet) => ({
    id: snippet.id,
    trigger: snippet.trigger,
    expansion: snippet.expansion,
  }));
}

export function mapSharedDictionary(
  dictionary: SharedWorkspaceTermPayload[],
): SharedWorkspaceTerm[] {
  return dictionary.map((term) => ({
    id: term.id,
    term: term.term,
    note: term.note ?? undefined,
  }));
}

function getWorkspaceStorageKey(userId: string): string {
  return `${WORKSPACE_STORAGE_PREFIX}${userId}`;
}

export function loadPersistedTeamWorkspace(userId: string): TeamWorkspace | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(getWorkspaceStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TeamWorkspace;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function savePersistedTeamWorkspace(
  userId: string,
  workspace: TeamWorkspace | null,
): void {
  if (typeof window === "undefined") return;
  try {
    const key = getWorkspaceStorageKey(userId);
    if (!workspace) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(workspace));
  } catch {
    // Ignore persistence failures in non-browser or private contexts.
  }
}
