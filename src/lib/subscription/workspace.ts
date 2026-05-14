import type { AuthSession } from "@/lib/auth/types";
import type { AppPlan } from "./plans";
import type {
  TeamMemberStatus,
  TeamRole,
  TeamWorkspacePayload,
} from "./contracts";

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
  createdAt?: string;
  updatedAt?: string;
  createdByName?: string;
  createdByEmail?: string;
  updatedByName?: string;
  updatedByEmail?: string;
};

export type SharedWorkspaceSnippet = {
  id: string;
  trigger: string;
  expansion: string;
  createdAt?: string;
  updatedAt?: string;
  createdByName?: string;
  createdByEmail?: string;
  updatedByName?: string;
  updatedByEmail?: string;
};

export type SharedWorkspaceTerm = {
  id: string;
  term: string;
  note?: string;
  createdAt?: string;
  updatedAt?: string;
  createdByName?: string;
  createdByEmail?: string;
  updatedByName?: string;
  updatedByEmail?: string;
};

export type TeamWorkspace = {
  id: string;
  name: string;
  currentUserRole: TeamRole;
  seatsIncluded: number;
  processingRegion: "ca" | "us";
  sharedLexiconEnabled: boolean;
  billingContactEmail: string;
  supportContactEmail: string;
  members: TeamMember[];
  sharedTemplates: SharedWorkspaceTemplate[];
  sharedSnippets: SharedWorkspaceSnippet[];
  sharedDictionary: SharedWorkspaceTerm[];
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
    processingRegion: "ca",
    sharedLexiconEnabled: true,
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
        createdByName: userName,
        createdByEmail: session.user.email,
      },
      {
        id: "team-shortlist",
        name: "Client shortlist update",
        description: "Resume client partage pour envoyer un shortlist propre.",
        prompt:
          "Transform the dictated text into a concise shortlist update for the client. Keep the original language. Include candidate status, fit, risks, and recommended next step. Return only the final client-ready update. Text: ${output}",
        createdByName: userName,
        createdByEmail: session.user.email,
      },
    ],
    sharedSnippets: [
      {
        id: "snippet-1",
        trigger: "envoie le debrief",
        expansion: "Je t'envoie le debrief complet dans l'heure avec les prochaines etapes.",
        createdByName: userName,
        createdByEmail: session.user.email,
      },
      {
        id: "snippet-2",
        trigger: "shortlist client",
        expansion: "Je partage la shortlist client aujourd'hui avec les points de vigilance et la recommandation finale.",
        createdByName: userName,
        createdByEmail: session.user.email,
      },
    ],
    sharedDictionary: [
      {
        id: "term-1",
        term: "Greenhouse",
        note: "ATS principal de l'equipe",
        createdByName: userName,
        createdByEmail: session.user.email,
      },
      {
        id: "term-2",
        term: "scorecard",
        createdByName: userName,
        createdByEmail: session.user.email,
      },
      {
        id: "term-3",
        term: domain.split(".")[0],
        note: "Nom de domaine equipe",
        createdByName: userName,
        createdByEmail: session.user.email,
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
    processingRegion: payload.processing_region === "us" ? "us" : "ca",
    sharedLexiconEnabled: payload.shared_lexicon_enabled !== false,
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
    createdAt: template.created_at ?? undefined,
    updatedAt: template.updated_at ?? undefined,
    createdByName: template.created_by_name ?? undefined,
    createdByEmail: template.created_by_email ?? undefined,
    updatedByName: template.updated_by_name ?? undefined,
    updatedByEmail: template.updated_by_email ?? undefined,
  }));
}

export function mapSharedSnippets(
  snippets: SharedWorkspaceSnippetPayload[],
): SharedWorkspaceSnippet[] {
  return snippets.map((snippet) => ({
    id: snippet.id,
    trigger: snippet.trigger,
    expansion: snippet.expansion,
    createdAt: snippet.created_at ?? undefined,
    updatedAt: snippet.updated_at ?? undefined,
    createdByName: snippet.created_by_name ?? undefined,
    createdByEmail: snippet.created_by_email ?? undefined,
    updatedByName: snippet.updated_by_name ?? undefined,
    updatedByEmail: snippet.updated_by_email ?? undefined,
  }));
}

export function mapSharedDictionary(
  dictionary: SharedWorkspaceTermPayload[],
): SharedWorkspaceTerm[] {
  return dictionary.map((term) => ({
    id: term.id,
    term: term.term,
    note: term.note ?? undefined,
    createdAt: term.created_at ?? undefined,
    updatedAt: term.updated_at ?? undefined,
    createdByName: term.created_by_name ?? undefined,
    createdByEmail: term.created_by_email ?? undefined,
    updatedByName: term.updated_by_name ?? undefined,
    updatedByEmail: term.updated_by_email ?? undefined,
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
