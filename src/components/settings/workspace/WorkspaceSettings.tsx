/* eslint-disable i18next/no-literal-string */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookText,
  Clock3,
  Code2,
  Crown,
  ExternalLink,
  FileText,
  Layers,
  Loader2,
  MoreHorizontal,
  Pencil,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { authClient } from "@/lib/auth/client";
import type { AuthSession } from "@/lib/auth/types";
import { Dropdown } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import { usePlan } from "@/lib/subscription/context";
import {
  mapTeamWorkspacePayload,
  mapSharedDictionary,
  mapSharedSnippets,
  mapSharedTemplates,
} from "@/lib/subscription/workspace";
import type {
  SharedWorkspaceSnippet,
  SharedWorkspaceTemplate,
  SharedWorkspaceTerm,
  TeamMember,
} from "@/lib/subscription/workspace";
import type { TeamRole } from "@/lib/subscription/contracts";

type WorkspaceTab = "members" | "library" | "activity" | "settings";

const shellPanel: React.CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.06)",
  background:
    "linear-gradient(180deg, rgba(255,255,255,0.018), rgba(255,255,255,0.008))",
  boxShadow:
    "inset 0 1px 0 rgba(255,255,255,0.03), 0 12px 32px -16px rgba(0,0,0,0.55)",
};

const innerTile: React.CSSProperties = {
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.06)",
  background: "rgba(255,255,255,0.018)",
};

const inputStyle: React.CSSProperties = {
  height: 38,
  padding: "0 14px",
  background: "#121216",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 10,
  color: "rgba(255,255,255,0.94)",
  fontSize: 13.5,
  fontFamily: "inherit",
  outline: "none",
};

const textAreaStyle: React.CSSProperties = {
  minHeight: 92,
  padding: "10px 12px",
  background: "#121216",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 10,
  color: "rgba(255,255,255,0.94)",
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
  resize: "vertical",
};

function navigateToSection(section: "billing" | "workspace") {
  window.dispatchEvent(
    new CustomEvent("vocalype:navigate-settings", { detail: section }),
  );
}

function getInitials(name: string, fallback = "W") {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return fallback;
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function getAvatarPalette(seed: string) {
  const palettes = [
    {
      bg: "linear-gradient(135deg,#d4a858,#a07a35)",
      fg: "#1a1306",
      ring: "rgba(212,168,88,0.24)",
    },
    {
      bg: "linear-gradient(135deg,#4d9b8d,#2f6e63)",
      fg: "#ffffff",
      ring: "rgba(77,155,141,0.24)",
    },
    {
      bg: "linear-gradient(135deg,#8467c4,#5b449e)",
      fg: "#ffffff",
      ring: "rgba(132,103,196,0.24)",
    },
  ];
  const hash = Array.from(seed).reduce(
    (sum, char) => sum + char.charCodeAt(0),
    0,
  );
  return palettes[hash % palettes.length];
}

function roleLabel(role: TeamRole) {
  switch (role) {
    case "owner":
      return "Propriétaire";
    case "admin":
      return "Admin";
    default:
      return "Membre";
  }
}

function personLabel(name?: string, email?: string) {
  return name?.trim() || email?.split("@")[0] || "Équipe";
}

function formatShortDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("fr-CA", {
    day: "numeric",
    month: "short",
  }).format(date);
}

function formatRelativeTime(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const deltaMs = date.getTime() - Date.now();
  const absSeconds = Math.round(Math.abs(deltaMs) / 1000);
  const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
  if (absSeconds < 60) return rtf.format(Math.round(deltaMs / 1000), "second");
  if (absSeconds < 3600)
    return rtf.format(Math.round(deltaMs / 60000), "minute");
  if (absSeconds < 86400)
    return rtf.format(Math.round(deltaMs / 3600000), "hour");
  return rtf.format(Math.round(deltaMs / 86400000), "day");
}

function rolePillStyle(role: TeamRole): React.CSSProperties {
  if (role === "owner") {
    return {
      color: "#d4a858",
      borderColor: "rgba(212,168,88,0.32)",
      background: "rgba(212,168,88,0.14)",
    };
  }
  return {
    color: "rgba(255,255,255,0.74)",
    borderColor: "rgba(255,255,255,0.08)",
    background: "#121216",
  };
}

function useFakeUsage(id: string, kind: "template" | "snippet" | "term") {
  const hash = Array.from(`${kind}:${id}`).reduce(
    (sum, char) => (sum * 31 + char.charCodeAt(0)) % 997,
    17,
  );
  if (kind === "template") return 8 + (hash % 180);
  if (kind === "snippet") return 4 + (hash % 41);
  return 0;
}

function SectionTitle({
  title,
  count,
  description,
}: {
  title: string;
  count?: string;
  description?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        marginBottom: 14,
        flexWrap: "wrap",
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: 15,
          fontWeight: 700,
          letterSpacing: "-0.005em",
          color: "rgba(255,255,255,0.94)",
        }}
      >
        {title}
      </h2>
      {count ? (
        <span
          style={{
            height: 22,
            padding: "0 8px",
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(255,255,255,0.02)",
            color: "rgba(255,255,255,0.44)",
            fontSize: 11,
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          {count}
        </span>
      ) : null}
      {description ? (
        <span
          style={{
            marginLeft: "auto",
            fontSize: 12.5,
            color: "rgba(255,255,255,0.34)",
          }}
        >
          {description}
        </span>
      ) : null}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  meta,
  trend,
  gold,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  meta?: string;
  trend?: string;
  gold?: boolean;
}) {
  return (
    <div style={{ ...shellPanel, padding: "16px 18px", position: "relative" }}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 9,
          display: "grid",
          placeItems: "center",
          border: gold
            ? "1px solid rgba(212,168,88,0.32)"
            : "1px solid rgba(255,255,255,0.06)",
          background: gold ? "rgba(212,168,88,0.14)" : "rgba(255,255,255,0.03)",
          color: gold ? "#d4a858" : "rgba(255,255,255,0.72)",
        }}
      >
        {icon}
      </div>
      {trend ? (
        <div
          style={{
            position: "absolute",
            top: 16,
            right: 18,
            fontSize: 11,
            color: gold ? "#d4a858" : "#8fd8ad",
            fontWeight: 600,
          }}
        >
          {trend}
        </div>
      ) : null}
      <div
        style={{
          marginTop: 14,
          fontSize: 11.5,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.34)",
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: value.length > 18 ? 18 : 30,
          fontWeight: 700,
          letterSpacing: "-0.025em",
          color: "rgba(255,255,255,0.95)",
        }}
      >
        {value}
      </div>
      {meta ? (
        <div
          style={{
            marginTop: 6,
            fontSize: 12.5,
            color: "rgba(255,255,255,0.38)",
          }}
        >
          {meta}
        </div>
      ) : null}
    </div>
  );
}

function MemberRow({
  member,
  currentUserEmail,
  canManageSeats,
  canChangeRole,
  roleLoading,
  onEditSelf,
  onRemove,
  onRoleChange,
}: {
  member: TeamMember;
  currentUserEmail?: string;
  canManageSeats: boolean;
  canChangeRole: boolean;
  roleLoading: boolean;
  onEditSelf: () => void;
  onRemove: () => void;
  onRoleChange: (role: "admin" | "member") => void;
}) {
  const palette = getAvatarPalette(member.email);
  const isCurrentUser =
    !!currentUserEmail &&
    member.email.toLowerCase() === currentUserEmail.toLowerCase();

  const secondary =
    member.status === "invited"
      ? "Invité récemment"
      : member.role === "owner"
        ? "Responsable du workspace"
        : member.role === "admin"
          ? "Admin opérationnel"
          : "Membre actif";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto auto 28px",
        gap: 18,
        alignItems: "center",
        padding: "14px 18px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        background:
          member.status === "invited"
            ? "rgba(212,168,88,0.025)"
            : "transparent",
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}
      >
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: "50%",
            background: palette.bg,
            color: palette.fg,
            display: "grid",
            placeItems: "center",
            fontWeight: 700,
            fontSize: 13,
            position: "relative",
            boxShadow: `0 0 0 1px ${palette.ring}`,
            flexShrink: 0,
          }}
        >
          {member.status === "invited"
            ? "@"
            : getInitials(member.name, member.email[0]?.toUpperCase() ?? "W")}
          <span
            style={{
              position: "absolute",
              right: -1,
              bottom: -1,
              width: 11,
              height: 11,
              borderRadius: "50%",
              border: "2px solid #17171b",
              background:
                member.status === "active"
                  ? "#6cce8c"
                  : "rgba(224,176,102,0.95)",
            }}
          />
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontWeight: 600,
              fontSize: 14,
              color: "rgba(255,255,255,0.94)",
            }}
          >
            {member.name}
            {isCurrentUser ? (
              <span
                style={{
                  fontSize: 9.5,
                  letterSpacing: "0.06em",
                  fontWeight: 700,
                  padding: "1px 6px",
                  borderRadius: 4,
                  background: "rgba(212,168,88,0.14)",
                  color: "#d4a858",
                  border: "1px solid rgba(212,168,88,0.32)",
                  textTransform: "uppercase",
                }}
              >
                Toi
              </span>
            ) : null}
            {isCurrentUser ? (
              <button
                type="button"
                onClick={onEditSelf}
                className="voca-inline-action-btn"
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.03)",
                  color: "rgba(255,255,255,0.46)",
                  display: "grid",
                  placeItems: "center",
                  cursor: "pointer",
                }}
              >
                <Pencil size={11} />
              </button>
            ) : null}
          </div>
          <div
            style={{
              marginTop: 2,
              fontSize: 12,
              color: "rgba(255,255,255,0.34)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            {member.email}
          </div>
        </div>
      </div>

      <div
        style={{
          color: "rgba(255,255,255,0.42)",
          fontSize: 11.5,
          whiteSpace: "nowrap",
        }}
      >
        {secondary}
      </div>

      {canChangeRole ? (
        <Dropdown
          className="min-w-[118px]"
          selectedValue={member.role}
          onSelect={(value) => onRoleChange(value as "admin" | "member")}
          disabled={roleLoading}
          options={[
            { value: "member", label: "Membre" },
            { value: "admin", label: "Admin" },
          ]}
        />
      ) : (
        <div
          style={{
            height: 30,
            padding: "0 12px",
            borderRadius: 8,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12.5,
            fontWeight: 600,
            border: "1px solid",
            whiteSpace: "nowrap",
            ...rolePillStyle(member.role),
          }}
        >
          {roleLabel(member.role)}
        </div>
      )}

      <button
        type="button"
        onClick={
          member.role === "owner"
            ? undefined
            : canManageSeats
              ? onRemove
              : undefined
        }
        className={
          member.role !== "owner" && canManageSeats
            ? "voca-inline-action-btn voca-inline-action-btn--danger"
            : "voca-inline-action-btn"
        }
        style={{
          width: 28,
          height: 28,
          borderRadius: 7,
          display: "grid",
          placeItems: "center",
          color: "rgba(255,255,255,0.36)",
          cursor:
            member.role !== "owner" && canManageSeats ? "pointer" : "default",
          opacity: member.role !== "owner" && canManageSeats ? 1 : 0.5,
          border: "1px solid transparent",
          background: "transparent",
        }}
      >
        {member.role !== "owner" && canManageSeats ? (
          <Trash2 size={14} />
        ) : (
          <MoreHorizontal size={14} />
        )}
      </button>
    </div>
  );
}

function AssetCard({
  kind,
  title,
  description,
  usage,
  triggerLabel,
  workspaceName,
  mono,
  createdByName,
  createdByEmail,
  createdAt,
  updatedByName,
  updatedByEmail,
  updatedAt,
  onEdit,
  onDelete,
  canManage,
}: {
  kind: "template" | "snippet" | "term";
  title: string;
  description?: string;
  usage: number;
  triggerLabel: string;
  workspaceName: string;
  mono?: boolean;
  createdByName?: string;
  createdByEmail?: string;
  createdAt?: string;
  updatedByName?: string;
  updatedByEmail?: string;
  updatedAt?: string;
  onEdit?: () => void;
  onDelete?: () => void;
  canManage?: boolean;
}) {
  const author = personLabel(createdByName, createdByEmail);
  const updatePerson = personLabel(updatedByName, updatedByEmail);
  const stamp = formatRelativeTime(updatedAt || createdAt) ?? "à l’instant";
  const palette = getAvatarPalette(createdByEmail || createdByName || title);

  return (
    <div
      style={{
        padding: kind === "term" ? "10px 12px" : "12px 12px 12px 14px",
        borderRadius: 10,
        border: "1px solid transparent",
        background: "#111114",
        position: "relative",
        transition: "background .15s, border-color .15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: mono ? 12.5 : 13.5,
            letterSpacing: "-0.005em",
            color: mono ? "#d4a858" : "rgba(255,255,255,0.95)",
            fontFamily: mono
              ? "ui-monospace, SFMono-Regular, Menlo, monospace"
              : "inherit",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>
        {canManage ? (
          <div style={{ display: "flex", gap: 4 }}>
            <button
              type="button"
              onClick={onEdit}
              className="voca-inline-action-btn"
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                color: "rgba(255,255,255,0.36)",
                display: "grid",
                placeItems: "center",
                border: "1px solid transparent",
                background: "transparent",
              }}
            >
              <Pencil size={12} />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="voca-inline-action-btn voca-inline-action-btn--danger"
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                color: "rgba(255,255,255,0.36)",
                display: "grid",
                placeItems: "center",
                border: "1px solid transparent",
                background: "transparent",
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ) : null}
      </div>

      {kind === "snippet" ? (
        <div
          style={{
            marginTop: 6,
            fontSize: 12,
            lineHeight: 1.5,
            color: "rgba(255,255,255,0.72)",
            padding: "8px 10px",
            background: "rgba(255,255,255,0.02)",
            borderRadius: 7,
            border: "1px dashed rgba(255,255,255,0.08)",
          }}
        >
          {description}
        </div>
      ) : description ? (
        <div
          style={{
            marginTop: kind === "term" ? 2 : 4,
            fontSize: kind === "term" ? 11.5 : 12,
            color: "rgba(255,255,255,0.38)",
            lineHeight: 1.5,
            display: "-webkit-box",
            WebkitLineClamp: kind === "term" ? 3 : 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {description}
        </div>
      ) : null}

      <div
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          fontSize: 11,
          color: "rgba(255,255,255,0.28)",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            color: "rgba(255,255,255,0.42)",
          }}
        >
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              display: "grid",
              placeItems: "center",
              background: palette.bg,
              color: palette.fg,
              fontSize: 8,
              fontWeight: 700,
            }}
          >
            {getInitials(author, "W")}
          </span>
          {author}
        </span>
        <span
          style={{
            width: 2,
            height: 2,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.18)",
          }}
        />
        <span>
          {usage} {triggerLabel}
        </span>
        <span
          style={{
            width: 2,
            height: 2,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.18)",
          }}
        />
        <span>{updatedAt ? `Modifié ${stamp}` : `Créé ${stamp}`}</span>
        <span
          style={{
            width: 2,
            height: 2,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.18)",
          }}
        />
        <span>{workspaceName}</span>
        {updatedAt ? (
          <>
            <span
              style={{
                width: 2,
                height: 2,
                borderRadius: "50%",
                background: "rgba(255,255,255,0.18)",
              }}
            />
            <span>par {updatePerson}</span>
          </>
        ) : null}
        {formatShortDate(updatedAt || createdAt) ? (
          <>
            <span
              style={{
                width: 2,
                height: 2,
                borderRadius: "50%",
                background: "rgba(255,255,255,0.18)",
              }}
            />
            <span>{formatShortDate(updatedAt || createdAt)}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

function LibraryColumn({
  icon,
  title,
  badge,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  badge: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        ...shellPanel,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "18px 18px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.018), transparent)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: "rgba(212,168,88,0.14)",
              color: "#d4a858",
              border: "1px solid rgba(212,168,88,0.32)",
              display: "grid",
              placeItems: "center",
            }}
          >
            {icon}
          </div>
          <h3
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: "-0.005em",
            }}
          >
            {title}
          </h3>
          <span
            style={{
              marginLeft: "auto",
              fontSize: 10.5,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 5,
              background: "rgba(255,255,255,0.03)",
              color: "rgba(255,255,255,0.4)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            {badge}
          </span>
        </div>
        <p
          style={{
            margin: "10px 0 0",
            color: "rgba(255,255,255,0.34)",
            fontSize: 12.5,
            lineHeight: 1.5,
          }}
        >
          {description}
        </p>
      </div>
      <div
        style={{
          padding: 10,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function AddTile({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        marginTop: 6,
        padding: "11px 14px",
        borderRadius: 10,
        border: "1px dashed rgba(255,255,255,0.12)",
        background: "transparent",
        color: "rgba(255,255,255,0.38)",
        fontSize: 13,
        fontWeight: 500,
        display: "flex",
        alignItems: "center",
        gap: 8,
        justifyContent: "center",
        cursor: "pointer",
      }}
      className="voca-inline-action-btn"
    >
      <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
      {label}
    </button>
  );
}

export const WorkspaceSettings: React.FC = () => {
  const { capabilities, teamWorkspace, updateTeamWorkspace, openUpgradePlans } =
    usePlan();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("members");
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [assetLoading, setAssetLoading] = useState(false);
  const [memberRoleLoadingId, setMemberRoleLoadingId] = useState<string | null>(
    null,
  );
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamRole>("member");
  const [editingName, setEditingName] = useState(false);
  const [pendingName, setPendingName] = useState("");
  const [pendingWorkspaceName, setPendingWorkspaceName] = useState("");
  const [tplName, setTplName] = useState("");
  const [tplDesc, setTplDesc] = useState("");
  const [tplPrompt, setTplPrompt] = useState("");
  const [editingTplId, setEditingTplId] = useState<string | null>(null);
  const [templateComposerOpen, setTemplateComposerOpen] = useState(false);
  const [snippetTrigger, setSnippetTrigger] = useState("");
  const [snippetExpansion, setSnippetExpansion] = useState("");
  const [editingSnippetId, setEditingSnippetId] = useState<string | null>(null);
  const [snippetComposerOpen, setSnippetComposerOpen] = useState(false);
  const [dictTerm, setDictTerm] = useState("");
  const [dictNote, setDictNote] = useState("");
  const [editingDictId, setEditingDictId] = useState<string | null>(null);
  const [dictionaryComposerOpen, setDictionaryComposerOpen] = useState(false);

  useEffect(() => {
    const currentSession = authClient.getStoredSession();
    setSession(currentSession);
    if (currentSession?.user?.name) {
      setPendingName(currentSession.user.name);
    }
  }, []);

  useEffect(() => {
    setPendingWorkspaceName(teamWorkspace?.name ?? "");
  }, [teamWorkspace?.name]);

  const canManageWorkspace =
    teamWorkspace?.currentUserRole === "owner" ||
    teamWorkspace?.currentUserRole === "admin";
  const canManageSeats = canManageWorkspace && capabilities.hasSeatManagement;
  const canManageTemplates =
    canManageWorkspace && capabilities.hasSharedTemplates;
  const canManageSharedAssets =
    canManageWorkspace && capabilities.hasSharedDictionary;
  const isOwner = teamWorkspace?.currentUserRole === "owner";

  const members = teamWorkspace?.members ?? [];
  const activeMembers = members.filter((member) => member.status === "active");
  const pendingMembers = members.filter(
    (member) => member.status === "invited",
  );
  const seatsIncluded = teamWorkspace?.seatsIncluded ?? 0;
  const seatsUsed = members.length;
  const seatsRemaining = Math.max(0, seatsIncluded - seatsUsed);
  const workspaceName = teamWorkspace?.name ?? "Workspace";
  const actorName = personLabel(session?.user?.name, session?.user?.email);
  const actorEmail = session?.user?.email;
  const processingRegion = teamWorkspace?.processingRegion ?? "ca";
  const sharedLexiconEnabled = teamWorkspace?.sharedLexiconEnabled !== false;

  const tabs = useMemo(
    () => [
      { key: "members" as const, label: "Membres", count: members.length },
      {
        key: "library" as const,
        label: "Bibliothèque",
        count:
          (teamWorkspace?.sharedTemplates.length ?? 0) +
          (teamWorkspace?.sharedSnippets.length ?? 0) +
          (teamWorkspace?.sharedDictionary.length ?? 0),
      },
      { key: "activity" as const, label: "Activité", count: 4 },
      { key: "settings" as const, label: "Réglages", count: 2 },
    ],
    [members.length, teamWorkspace],
  );

  const activityFeed = useMemo(() => {
    if (!teamWorkspace) return [];
    const feed: Array<{
      key: string;
      who: string;
      text: string;
      time: string;
    }> = [];
    const latestTemplate = teamWorkspace.sharedTemplates[0];
    const latestSnippet = teamWorkspace.sharedSnippets[0];
    const latestPending = pendingMembers[0];

    if (latestTemplate) {
      feed.push({
        key: `tpl-${latestTemplate.id}`,
        who: personLabel(
          latestTemplate.createdByName,
          latestTemplate.createdByEmail,
        ),
        text: `a ajouté ou modifié le template "${latestTemplate.name}".`,
        time:
          formatRelativeTime(
            latestTemplate.updatedAt || latestTemplate.createdAt,
          ) ?? "récemment",
      });
    }
    if (latestSnippet) {
      feed.push({
        key: `snip-${latestSnippet.id}`,
        who: personLabel(
          latestSnippet.createdByName,
          latestSnippet.createdByEmail,
        ),
        text: `a touché au snippet "${latestSnippet.trigger}".`,
        time:
          formatRelativeTime(
            latestSnippet.updatedAt || latestSnippet.createdAt,
          ) ?? "récemment",
      });
    }
    if (latestPending) {
      feed.push({
        key: `invite-${latestPending.id}`,
        who: actorName,
        text: `a invité ${latestPending.email} dans le workspace.`,
        time: "récemment",
      });
    }
    feed.push({
      key: "billing",
      who: actorName,
      text: `garde la facturation centralisée sur ${teamWorkspace.billingContactEmail}.`,
      time: "toujours actif",
    });
    return feed;
  }, [actorName, pendingMembers, teamWorkspace]);

  const refreshFromServer = useCallback(
    async (token: string) => {
      const response = await authClient.fetchWorkspaceTeam(token);
      const mappedWorkspace = mapTeamWorkspacePayload(response.workspace);
      updateTeamWorkspace(mappedWorkspace);
    },
    [updateTeamWorkspace],
  );

  const handleSaveWorkspaceSettings = useCallback(
    async (payload: {
      name?: string;
      processing_region?: "ca" | "us";
      shared_lexicon_enabled?: boolean;
    }) => {
      const token = authClient.getStoredToken();
      if (!token || !teamWorkspace || !canManageWorkspace) return;
      setWorkspaceLoading(true);
      try {
        const response = await authClient.updateWorkspaceSettings(
          token,
          payload,
        );
        updateTeamWorkspace(mapTeamWorkspacePayload(response.workspace));
      } catch (error) {
        console.error("Failed to update workspace settings:", error);
      } finally {
        setWorkspaceLoading(false);
      }
    },
    [canManageWorkspace, teamWorkspace, updateTeamWorkspace],
  );

  const handleDeleteWorkspace = useCallback(async () => {
    const token = authClient.getStoredToken();
    if (!token || !teamWorkspace || !isOwner) return;
    const confirmed = window.confirm(
      `Supprimer ${teamWorkspace.name} ? Cette action est irréversible.`,
    );
    if (!confirmed) return;
    setWorkspaceLoading(true);
    try {
      await authClient.deleteWorkspace(token);
      updateTeamWorkspace(null);
      navigateToSection("billing");
    } catch (error) {
      console.error("Failed to delete workspace:", error);
    } finally {
      setWorkspaceLoading(false);
    }
  }, [isOwner, teamWorkspace, updateTeamWorkspace]);

  const handleSaveOwnName = useCallback(async () => {
    const token = authClient.getStoredToken();
    if (!token || !pendingName.trim()) return;
    setWorkspaceLoading(true);
    try {
      const nextSession = await authClient.updateProfile(token, {
        name: pendingName.trim(),
      });
      await authClient.setStoredSession(nextSession);
      setSession(nextSession);
      updateTeamWorkspace((current) =>
        current
          ? {
              ...current,
              members: current.members.map((member) =>
                session?.user?.email &&
                member.email.toLowerCase() === session.user.email.toLowerCase()
                  ? { ...member, name: pendingName.trim() }
                  : member,
              ),
            }
          : current,
      );
      setEditingName(false);
      await refreshFromServer(token);
    } catch (error) {
      console.error("Failed to update profile name:", error);
    } finally {
      setWorkspaceLoading(false);
    }
  }, [
    pendingName,
    refreshFromServer,
    session?.user?.email,
    updateTeamWorkspace,
  ]);

  const handleInviteMember = useCallback(async () => {
    const token = authClient.getStoredToken();
    const email = inviteEmail.trim().toLowerCase();
    if (!token || !teamWorkspace || !email || seatsRemaining <= 0) return;
    if (members.some((member) => member.email.toLowerCase() === email)) return;

    const previousWorkspace = teamWorkspace;
    const optimisticId = `invite-${crypto.randomUUID()}`;
    setInviteLoading(true);
    updateTeamWorkspace((current) =>
      current
        ? {
            ...current,
            members: [
              ...current.members,
              {
                id: optimisticId,
                name: email,
                email,
                role: inviteRole,
                status: "invited",
              },
            ],
          }
        : current,
    );
    setInviteEmail("");

    try {
      const response = await authClient.inviteWorkspaceMember(token, {
        email,
        role: inviteRole,
      });
      updateTeamWorkspace(() => mapTeamWorkspacePayload(response.workspace));
    } catch (error) {
      console.error("Failed to invite workspace member:", error);
      updateTeamWorkspace(previousWorkspace);
      setInviteEmail(email);
    } finally {
      setInviteLoading(false);
    }
  }, [
    inviteEmail,
    inviteRole,
    members,
    seatsRemaining,
    teamWorkspace,
    updateTeamWorkspace,
  ]);

  const handleRemoveMember = useCallback(
    async (memberId: string) => {
      const token = authClient.getStoredToken();
      if (!token || !teamWorkspace || !canManageSeats) return;
      const previousWorkspace = teamWorkspace;
      updateTeamWorkspace((current) =>
        current
          ? {
              ...current,
              members: current.members.filter(
                (member) => member.id !== memberId,
              ),
            }
          : current,
      );
      try {
        const response = await authClient.removeWorkspaceMember(
          token,
          memberId,
        );
        updateTeamWorkspace(() => mapTeamWorkspacePayload(response.workspace));
      } catch (error) {
        console.error("Failed to remove workspace member:", error);
        updateTeamWorkspace(previousWorkspace);
      }
    },
    [canManageSeats, teamWorkspace, updateTeamWorkspace],
  );

  const handleChangeMemberRole = useCallback(
    async (memberId: string, role: "admin" | "member") => {
      const token = authClient.getStoredToken();
      if (!token || !teamWorkspace || !isOwner) return;
      const previousWorkspace = teamWorkspace;
      setMemberRoleLoadingId(memberId);
      updateTeamWorkspace((current) =>
        current
          ? {
              ...current,
              members: current.members.map((member) =>
                member.id === memberId ? { ...member, role } : member,
              ),
            }
          : current,
      );
      try {
        const response = await authClient.updateWorkspaceMemberRole(
          token,
          memberId,
          role,
        );
        updateTeamWorkspace(() => mapTeamWorkspacePayload(response.workspace));
      } catch (error) {
        console.error("Failed to update workspace role:", error);
        updateTeamWorkspace(previousWorkspace);
      } finally {
        setMemberRoleLoadingId(null);
      }
    },
    [isOwner, teamWorkspace, updateTeamWorkspace],
  );

  const handleEditTemplate = useCallback(
    (id: string) => {
      const template = teamWorkspace?.sharedTemplates.find(
        (item) => item.id === id,
      );
      if (!template) return;
      setActiveTab("library");
      setTemplateComposerOpen(true);
      setTplName(template.name);
      setTplDesc(template.description ?? "");
      setTplPrompt(template.prompt);
      setEditingTplId(template.id);
    },
    [teamWorkspace],
  );

  const handleDeleteTemplate = useCallback(
    async (id: string) => {
      const token = authClient.getStoredToken();
      if (!token || !teamWorkspace || !canManageTemplates) return;
      const previousWorkspace = teamWorkspace;
      updateTeamWorkspace((current) =>
        current
          ? {
              ...current,
              sharedTemplates: current.sharedTemplates.filter(
                (item) => item.id !== id,
              ),
            }
          : current,
      );
      try {
        const response = await authClient.removeWorkspaceTemplate(token, id);
        updateTeamWorkspace((current) =>
          current
            ? {
                ...current,
                sharedTemplates: mapSharedTemplates(response.templates),
              }
            : current,
        );
      } catch (error) {
        console.error("Failed to remove workspace template:", error);
        updateTeamWorkspace(previousWorkspace);
      }
    },
    [canManageTemplates, teamWorkspace, updateTeamWorkspace],
  );

  const handleSaveTemplate = useCallback(async () => {
    const token = authClient.getStoredToken();
    const name = tplName.trim();
    const prompt = tplPrompt.trim();
    const description = tplDesc.trim() || "";
    if (!token || !teamWorkspace || !canManageTemplates || !name || !prompt)
      return;

    const previousWorkspace = teamWorkspace;
    const optimisticId = editingTplId ?? `template-${crypto.randomUUID()}`;
    const nowIso = new Date().toISOString();
    setAssetLoading(true);
    updateTeamWorkspace((current) =>
      current
        ? {
            ...current,
            sharedTemplates: editingTplId
              ? current.sharedTemplates.map((item) =>
                  item.id === editingTplId
                    ? {
                        ...item,
                        name,
                        description,
                        prompt,
                        updatedAt: nowIso,
                        updatedByName: actorName,
                        updatedByEmail: actorEmail,
                      }
                    : item,
                )
              : [
                  {
                    id: optimisticId,
                    name,
                    description,
                    prompt,
                    createdAt: nowIso,
                    createdByName: actorName,
                    createdByEmail: actorEmail,
                  },
                  ...current.sharedTemplates,
                ],
          }
        : current,
    );
    setTplName("");
    setTplDesc("");
    setTplPrompt("");
    setEditingTplId(null);
    setTemplateComposerOpen(false);
    try {
      const response = editingTplId
        ? await authClient.updateWorkspaceTemplate(token, editingTplId, {
            name,
            description: description || undefined,
            prompt,
          })
        : await authClient.addWorkspaceTemplate(token, {
            name,
            description: description || undefined,
            prompt,
          });
      updateTeamWorkspace((current) =>
        current
          ? {
              ...current,
              sharedTemplates: mapSharedTemplates(response.templates),
            }
          : current,
      );
    } catch (error) {
      console.error("Failed to save workspace template:", error);
      updateTeamWorkspace(previousWorkspace);
      setTplName(name);
      setTplDesc(description);
      setTplPrompt(prompt);
      setEditingTplId(editingTplId);
      setTemplateComposerOpen(true);
    } finally {
      setAssetLoading(false);
    }
  }, [
    actorEmail,
    actorName,
    canManageTemplates,
    editingTplId,
    teamWorkspace,
    tplDesc,
    tplName,
    tplPrompt,
    updateTeamWorkspace,
  ]);

  const handleEditSnippet = useCallback(
    (id: string) => {
      const snippet = teamWorkspace?.sharedSnippets.find(
        (item) => item.id === id,
      );
      if (!snippet) return;
      setActiveTab("library");
      setSnippetComposerOpen(true);
      setSnippetTrigger(snippet.trigger);
      setSnippetExpansion(snippet.expansion);
      setEditingSnippetId(snippet.id);
    },
    [teamWorkspace],
  );

  const handleDeleteSnippet = useCallback(
    async (id: string) => {
      const token = authClient.getStoredToken();
      if (!token || !teamWorkspace || !canManageSharedAssets) return;
      const previousWorkspace = teamWorkspace;
      updateTeamWorkspace((current) =>
        current
          ? {
              ...current,
              sharedSnippets: current.sharedSnippets.filter(
                (item) => item.id !== id,
              ),
            }
          : current,
      );
      try {
        const response = await authClient.removeWorkspaceSnippet(token, id);
        updateTeamWorkspace((current) =>
          current
            ? {
                ...current,
                sharedSnippets: mapSharedSnippets(response.snippets),
              }
            : current,
        );
      } catch (error) {
        console.error("Failed to remove workspace snippet:", error);
        updateTeamWorkspace(previousWorkspace);
      }
    },
    [canManageSharedAssets, teamWorkspace, updateTeamWorkspace],
  );

  const handleSaveSnippet = useCallback(async () => {
    const token = authClient.getStoredToken();
    const trigger = snippetTrigger.trim();
    const expansion = snippetExpansion.trim();
    if (
      !token ||
      !teamWorkspace ||
      !canManageSharedAssets ||
      !trigger ||
      !expansion
    )
      return;
    const previousWorkspace = teamWorkspace;
    const optimisticId = editingSnippetId ?? `snippet-${crypto.randomUUID()}`;
    const nowIso = new Date().toISOString();
    setAssetLoading(true);
    updateTeamWorkspace((current) =>
      current
        ? {
            ...current,
            sharedSnippets: editingSnippetId
              ? current.sharedSnippets.map((item) =>
                  item.id === editingSnippetId
                    ? {
                        ...item,
                        trigger,
                        expansion,
                        updatedAt: nowIso,
                        updatedByName: actorName,
                        updatedByEmail: actorEmail,
                      }
                    : item,
                )
              : [
                  {
                    id: optimisticId,
                    trigger,
                    expansion,
                    createdAt: nowIso,
                    createdByName: actorName,
                    createdByEmail: actorEmail,
                  },
                  ...current.sharedSnippets,
                ],
          }
        : current,
    );
    setSnippetTrigger("");
    setSnippetExpansion("");
    setEditingSnippetId(null);
    setSnippetComposerOpen(false);
    try {
      const response = editingSnippetId
        ? await authClient.updateWorkspaceSnippet(token, editingSnippetId, {
            trigger,
            expansion,
          })
        : await authClient.addWorkspaceSnippet(token, {
            trigger,
            expansion,
          });
      updateTeamWorkspace((current) =>
        current
          ? { ...current, sharedSnippets: mapSharedSnippets(response.snippets) }
          : current,
      );
    } catch (error) {
      console.error("Failed to save workspace snippet:", error);
      updateTeamWorkspace(previousWorkspace);
      setSnippetTrigger(trigger);
      setSnippetExpansion(expansion);
      setEditingSnippetId(editingSnippetId);
      setSnippetComposerOpen(true);
    } finally {
      setAssetLoading(false);
    }
  }, [
    actorEmail,
    actorName,
    canManageSharedAssets,
    editingSnippetId,
    snippetExpansion,
    snippetTrigger,
    teamWorkspace,
    updateTeamWorkspace,
  ]);

  const handleEditDictionaryTerm = useCallback(
    (id: string) => {
      const term = teamWorkspace?.sharedDictionary.find(
        (item) => item.id === id,
      );
      if (!term) return;
      setActiveTab("library");
      setDictionaryComposerOpen(true);
      setDictTerm(term.term);
      setDictNote(term.note ?? "");
      setEditingDictId(term.id);
    },
    [teamWorkspace],
  );

  const handleDeleteDictionaryTerm = useCallback(
    async (id: string) => {
      const token = authClient.getStoredToken();
      if (!token || !teamWorkspace || !canManageSharedAssets) return;
      const previousWorkspace = teamWorkspace;
      updateTeamWorkspace((current) =>
        current
          ? {
              ...current,
              sharedDictionary: current.sharedDictionary.filter(
                (item) => item.id !== id,
              ),
            }
          : current,
      );
      try {
        const response = await authClient.removeWorkspaceDictionaryTerm(
          token,
          id,
        );
        updateTeamWorkspace((current) =>
          current
            ? {
                ...current,
                sharedDictionary: mapSharedDictionary(response.dictionary),
              }
            : current,
        );
      } catch (error) {
        console.error("Failed to remove workspace dictionary term:", error);
        updateTeamWorkspace(previousWorkspace);
      }
    },
    [canManageSharedAssets, teamWorkspace, updateTeamWorkspace],
  );

  const handleSaveDictionaryTerm = useCallback(async () => {
    const token = authClient.getStoredToken();
    const term = dictTerm.trim();
    const note = dictNote.trim();
    if (!token || !teamWorkspace || !canManageSharedAssets || !term) return;
    const previousWorkspace = teamWorkspace;
    const optimisticId = editingDictId ?? `term-${crypto.randomUUID()}`;
    const nowIso = new Date().toISOString();
    setAssetLoading(true);
    updateTeamWorkspace((current) =>
      current
        ? {
            ...current,
            sharedDictionary: editingDictId
              ? current.sharedDictionary.map((item) =>
                  item.id === editingDictId
                    ? {
                        ...item,
                        term,
                        note,
                        updatedAt: nowIso,
                        updatedByName: actorName,
                        updatedByEmail: actorEmail,
                      }
                    : item,
                )
              : [
                  {
                    id: optimisticId,
                    term,
                    note,
                    createdAt: nowIso,
                    createdByName: actorName,
                    createdByEmail: actorEmail,
                  },
                  ...current.sharedDictionary,
                ],
          }
        : current,
    );
    setDictTerm("");
    setDictNote("");
    setEditingDictId(null);
    setDictionaryComposerOpen(false);
    try {
      const response = editingDictId
        ? await authClient.updateWorkspaceDictionaryTerm(token, editingDictId, {
            term,
            note: note || undefined,
          })
        : await authClient.addWorkspaceDictionaryTerm(token, {
            term,
            note: note || undefined,
          });
      updateTeamWorkspace((current) =>
        current
          ? {
              ...current,
              sharedDictionary: mapSharedDictionary(response.dictionary),
            }
          : current,
      );
    } catch (error) {
      console.error("Failed to save workspace dictionary term:", error);
      updateTeamWorkspace(previousWorkspace);
      setDictTerm(term);
      setDictNote(note);
      setEditingDictId(editingDictId);
      setDictionaryComposerOpen(true);
    } finally {
      setAssetLoading(false);
    }
  }, [
    actorEmail,
    actorName,
    canManageSharedAssets,
    dictNote,
    dictTerm,
    editingDictId,
    teamWorkspace,
    updateTeamWorkspace,
  ]);

  if (!teamWorkspace) {
    return (
      <div style={{ padding: "28px" }}>
        <div
          style={{ ...shellPanel, padding: "28px", display: "grid", gap: 14 }}
        >
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "rgba(255,255,255,0.94)",
            }}
          >
            Workspace équipe
          </div>
          <div
            style={{
              color: "rgba(255,255,255,0.42)",
              lineHeight: 1.6,
              maxWidth: 720,
            }}
          >
            Cette page est réservée aux comptes agence. Active un workspace pour
            centraliser les membres, les templates, les snippets et le
            dictionnaire partagé.
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Button
              type="button"
              variant="primary-soft"
              onClick={openUpgradePlans}
            >
              Voir les plans
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", overflowY: "auto", overflowX: "hidden" }}>
      <div
        style={{
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 14,
          background: "#111114",
          overflow: "hidden",
          margin: "0 0 12px",
        }}
      >
        <div
          style={{
            padding: "22px 28px 20px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            background:
              "radial-gradient(400px 200px at 90% 0%, rgba(212,168,88,0.06), transparent 70%), linear-gradient(180deg, rgba(255,255,255,0.015), transparent)",
            display: "grid",
            gridTemplateColumns: "auto 1fr auto",
            gap: 22,
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background:
                "radial-gradient(circle at 30% 25%, rgba(212,168,88,0.6), transparent 55%), linear-gradient(135deg,#3a2c15,#1a1410)",
              border: "1px solid rgba(212,168,88,0.32)",
              display: "grid",
              placeItems: "center",
              color: "#d4a858",
              fontSize: 26,
              fontStyle: "italic",
              fontFamily: "Georgia, serif",
            }}
          >
            {workspaceName[0]?.toLowerCase() || "w"}
          </div>

          <div>
            <div
              style={{
                margin: 0,
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                display: "flex",
                alignItems: "center",
                gap: 10,
                color: "rgba(255,255,255,0.96)",
              }}
            >
              {workspaceName}
              <span
                style={{
                  fontSize: 10.5,
                  letterSpacing: "0.1em",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  padding: "3px 8px",
                  borderRadius: 5,
                  background:
                    "linear-gradient(135deg, rgba(212,168,88,0.22), rgba(212,168,88,0.08))",
                  color: "#d4a858",
                  border: "1px solid rgba(212,168,88,0.32)",
                }}
              >
                Plan Team
              </span>
            </div>
            <div
              style={{
                marginTop: 6,
                display: "flex",
                alignItems: "center",
                gap: 14,
                flexWrap: "wrap",
                color: "rgba(255,255,255,0.34)",
                fontSize: 12.5,
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  color: "#d4a858",
                  fontWeight: 600,
                  fontSize: 11.5,
                  padding: "2px 7px",
                  border: "1px solid rgba(212,168,88,0.32)",
                  background: "rgba(212,168,88,0.14)",
                  borderRadius: 5,
                }}
              >
                {roleLabel(teamWorkspace.currentUserRole)}
              </span>
              <span>
                Contact facturation{" "}
                <b style={{ color: "rgba(255,255,255,0.76)" }}>
                  {teamWorkspace.billingContactEmail}
                </b>
              </span>
              <span
                style={{
                  width: 3,
                  height: 3,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.18)",
                }}
              />
              <span>
                Région{" "}
                <b style={{ color: "rgba(255,255,255,0.76)" }}>
                  {processingRegion === "us" ? "États-Unis" : "Canada"}
                </b>
              </span>
              <span
                style={{
                  width: 3,
                  height: 3,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.18)",
                }}
              />
              <span>
                <b style={{ color: "rgba(255,255,255,0.76)" }}>
                  {activeMembers.length}
                </b>{" "}
                membres actifs ·{" "}
                <b style={{ color: "rgba(255,255,255,0.76)" }}>
                  {pendingMembers.length}
                </b>{" "}
                invitation{pendingMembers.length > 1 ? "s" : ""} en attente
              </span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "10px 14px",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 12,
                background: "#16161a",
              }}
            >
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: "50%",
                  background: `conic-gradient(#d4a858 0 ${Math.max(12, (Math.min(100, seatsIncluded ? (seatsUsed / seatsIncluded) * 100 : 0) / 100) * 360)}deg, rgba(255,255,255,0.06) ${Math.max(12, (Math.min(100, seatsIncluded ? (seatsUsed / seatsIncluded) * 100 : 0) / 100) * 360)}deg 360deg)`,
                  display: "grid",
                  placeItems: "center",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 6,
                    borderRadius: "50%",
                    background: "#16161a",
                  }}
                />
                <span
                  style={{
                    position: "relative",
                    fontWeight: 700,
                    fontSize: 14,
                  }}
                >
                  <b style={{ color: "#d4a858" }}>{seatsUsed}</b>/
                  {seatsIncluded}
                </span>
              </div>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    letterSpacing: "0.1em",
                    fontWeight: 700,
                    color: "rgba(255,255,255,0.34)",
                    textTransform: "uppercase",
                  }}
                >
                  Sièges
                </div>
                <div style={{ marginTop: 2, fontSize: 14, fontWeight: 600 }}>
                  {seatsUsed} utilisés · {seatsIncluded} inclus
                </div>
                <div style={{ marginTop: 2, fontSize: 12, color: "#6cce8c" }}>
                  {seatsRemaining} siège{seatsRemaining > 1 ? "s" : ""}{" "}
                  disponible{seatsRemaining > 1 ? "s" : ""}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setActiveTab("settings")}
              className="voca-inline-action-btn"
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "#16161a",
                color: "rgba(255,255,255,0.72)",
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
              }}
            >
              <Sparkles size={15} />
            </button>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 2,
            padding: "0 22px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            background:
              "linear-gradient(180deg, transparent, rgba(255,255,255,0.01))",
          }}
        >
          {tabs.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                style={{
                  position: "relative",
                  height: 46,
                  padding: "0 16px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  color: active
                    ? "rgba(255,255,255,0.94)"
                    : "rgba(255,255,255,0.34)",
                  fontSize: 13.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  borderRadius: 0,
                }}
              >
                {tab.label}
                <span
                  style={{
                    fontSize: 10.5,
                    letterSpacing: "0.04em",
                    fontWeight: 700,
                    padding: "2px 7px",
                    borderRadius: 5,
                    background: active
                      ? "rgba(212,168,88,0.14)"
                      : "rgba(255,255,255,0.03)",
                    color: active ? "#d4a858" : "rgba(255,255,255,0.4)",
                  }}
                >
                  {tab.count}
                </span>
                {active ? (
                  <span
                    style={{
                      position: "absolute",
                      left: 12,
                      right: 12,
                      bottom: -1,
                      height: 2,
                      background: "#d4a858",
                    }}
                  />
                ) : null}
              </button>
            );
          })}
        </div>

        <div style={{ padding: "24px 28px 36px" }}>
          {activeTab === "members" ? (
            <>
              <div
                style={{
                  ...shellPanel,
                  padding: "18px 20px",
                  display: "grid",
                  gridTemplateColumns: canManageSeats ? "1fr auto" : "1fr",
                  gap: 18,
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>
                    Inviter un membre
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 12.5,
                      color: "rgba(255,255,255,0.34)",
                    }}
                  >
                    Ajoute une personne au workspace avec le bon rôle dès le
                    départ.
                  </div>
                </div>
                {canManageSeats ? (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(240px, 1fr) auto auto",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="email@agence.com"
                      disabled={
                        workspaceLoading || inviteLoading || seatsRemaining <= 0
                      }
                      style={{ ...inputStyle, minWidth: 240 }}
                    />
                    <Dropdown
                      className="min-w-[120px]"
                      selectedValue={inviteRole}
                      onSelect={(value) => setInviteRole(value as TeamRole)}
                      disabled={
                        workspaceLoading || inviteLoading || seatsRemaining <= 0
                      }
                      options={[
                        { value: "member", label: "Membre" },
                        { value: "admin", label: "Admin" },
                      ]}
                    />
                    <Button
                      type="button"
                      variant="primary-soft"
                      onClick={() => void handleInviteMember()}
                      disabled={
                        workspaceLoading ||
                        inviteLoading ||
                        !inviteEmail.trim() ||
                        seatsRemaining <= 0
                      }
                    >
                      {inviteLoading ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <UserPlus size={14} />
                      )}
                      {inviteLoading ? "Envoi..." : "Inviter"}
                    </Button>
                  </div>
                ) : null}
              </div>

              <div style={{ marginTop: 32 }}>
                <SectionTitle
                  title="Membres actifs"
                  count={String(activeMembers.length)}
                  description="Présents dans le workspace"
                />
                <div style={{ ...shellPanel, overflow: "hidden" }}>
                  {activeMembers.map((member) => {
                    const isCurrentUser =
                      !!session?.user?.email &&
                      member.email.toLowerCase() ===
                        session.user.email.toLowerCase();
                    if (editingName && isCurrentUser) {
                      return (
                        <div
                          key={member.id}
                          style={{
                            padding: "14px 18px",
                            display: "grid",
                            gridTemplateColumns: "1fr auto",
                            gap: 12,
                            alignItems: "center",
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                          }}
                        >
                          <input
                            type="text"
                            value={pendingName}
                            onChange={(event) =>
                              setPendingName(event.target.value)
                            }
                            disabled={workspaceLoading}
                            style={{ ...inputStyle, maxWidth: 340 }}
                          />
                          <div style={{ display: "flex", gap: 8 }}>
                            <Button
                              type="button"
                              variant="primary-soft"
                              size="sm"
                              onClick={() => void handleSaveOwnName()}
                              disabled={
                                workspaceLoading ||
                                pendingName.trim().length < 2
                              }
                            >
                              Enregistrer
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                setPendingName(member.name);
                                setEditingName(false);
                              }}
                              disabled={workspaceLoading}
                            >
                              Annuler
                            </Button>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <MemberRow
                        key={member.id}
                        member={member}
                        currentUserEmail={session?.user?.email}
                        canManageSeats={canManageSeats}
                        canChangeRole={
                          isOwner &&
                          member.role !== "owner" &&
                          member.status === "active"
                        }
                        roleLoading={memberRoleLoadingId === member.id}
                        onEditSelf={() => {
                          setPendingName(member.name);
                          setEditingName(true);
                        }}
                        onRemove={() => void handleRemoveMember(member.id)}
                        onRoleChange={(role) =>
                          void handleChangeMemberRole(member.id, role)
                        }
                      />
                    );
                  })}
                </div>
              </div>

              {pendingMembers.length > 0 ? (
                <div style={{ marginTop: 32 }}>
                  <SectionTitle
                    title="Invitations en attente"
                    count={String(pendingMembers.length)}
                    description="L'invitation expire après 7 jours sans connexion."
                  />
                  <div style={{ ...shellPanel, overflow: "hidden" }}>
                    {pendingMembers.map((member) => (
                      <MemberRow
                        key={member.id}
                        member={member}
                        canManageSeats={canManageSeats}
                        canChangeRole={isOwner && member.role !== "owner"}
                        roleLoading={memberRoleLoadingId === member.id}
                        onEditSelf={() => undefined}
                        onRemove={() => void handleRemoveMember(member.id)}
                        onRoleChange={(role) =>
                          void handleChangeMemberRole(member.id, role)
                        }
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {activeTab === "library" ? (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                  gap: 14,
                  marginBottom: 24,
                }}
              >
                <StatCard
                  icon={<Layers size={16} />}
                  label="Templates"
                  value={String(teamWorkspace.sharedTemplates.length)}
                  meta="partagés"
                  trend={`+${Math.min(2, teamWorkspace.sharedTemplates.length)} ce mois`}
                  gold
                />
                <StatCard
                  icon={<Code2 size={16} />}
                  label="Snippets"
                  value={String(teamWorkspace.sharedSnippets.length)}
                  meta="raccourcis"
                  trend={`+${Math.min(1, teamWorkspace.sharedSnippets.length)} cette semaine`}
                />
                <StatCard
                  icon={<BookText size={16} />}
                  label="Termes métier"
                  value={String(teamWorkspace.sharedDictionary.length)}
                  meta="dans le lexique"
                />
                <StatCard
                  icon={<ShieldCheck size={16} />}
                  label="Support"
                  value="Réponse < 4 h"
                  meta="Canal agence"
                  trend="Prioritaire"
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: 14,
                  alignItems: "start",
                }}
              >
                <LibraryColumn
                  icon={<FileText size={16} />}
                  title="Templates partagés"
                  badge={String(teamWorkspace.sharedTemplates.length)}
                  description="Prompts communs pour homogénéiser les sorties IA dans toute l'équipe."
                >
                  {teamWorkspace.sharedTemplates.map((template) => (
                    <AssetCard
                      key={template.id}
                      kind="template"
                      title={template.name}
                      description={template.description || template.prompt}
                      usage={useFakeUsage(template.id, "template")}
                      triggerLabel="utilisations"
                      workspaceName={workspaceName}
                      createdByName={template.createdByName}
                      createdByEmail={template.createdByEmail}
                      createdAt={template.createdAt}
                      updatedByName={template.updatedByName}
                      updatedByEmail={template.updatedByEmail}
                      updatedAt={template.updatedAt}
                      canManage={canManageTemplates}
                      onEdit={() => handleEditTemplate(template.id)}
                      onDelete={() => void handleDeleteTemplate(template.id)}
                    />
                  ))}
                  {teamWorkspace.sharedTemplates.length === 0 ? (
                    <div
                      style={{
                        padding: "14px 12px",
                        fontSize: 12.5,
                        color: "rgba(255,255,255,0.42)",
                      }}
                    >
                      Aucun template partagé pour le moment.
                    </div>
                  ) : null}
                  {templateComposerOpen ? (
                    <div
                      style={{
                        ...innerTile,
                        padding: 12,
                        display: "grid",
                        gap: 8,
                      }}
                    >
                      <input
                        type="text"
                        value={tplName}
                        onChange={(event) => setTplName(event.target.value)}
                        placeholder="Nom du template"
                        disabled={assetLoading}
                        style={inputStyle}
                      />
                      <input
                        type="text"
                        value={tplDesc}
                        onChange={(event) => setTplDesc(event.target.value)}
                        placeholder="Description courte"
                        disabled={assetLoading}
                        style={inputStyle}
                      />
                      <textarea
                        value={tplPrompt}
                        onChange={(event) => setTplPrompt(event.target.value)}
                        placeholder="Prompt partagé pour l'équipe"
                        disabled={assetLoading}
                        rows={4}
                        style={textAreaStyle}
                      />
                      <div style={{ display: "flex", gap: 8 }}>
                        <Button
                          type="button"
                          variant="primary-soft"
                          size="sm"
                          className="flex-1"
                          onClick={() => void handleSaveTemplate()}
                          disabled={
                            assetLoading || !tplName.trim() || !tplPrompt.trim()
                          }
                        >
                          {editingTplId ? "Enregistrer" : "Nouveau template"}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setTplName("");
                            setTplDesc("");
                            setTplPrompt("");
                            setEditingTplId(null);
                            setTemplateComposerOpen(false);
                          }}
                          disabled={assetLoading}
                        >
                          Annuler
                        </Button>
                      </div>
                    </div>
                  ) : canManageTemplates ? (
                    <AddTile
                      label="Nouveau template"
                      onClick={() => {
                        setTplName("");
                        setTplDesc("");
                        setTplPrompt("");
                        setEditingTplId(null);
                        setTemplateComposerOpen(true);
                      }}
                    />
                  ) : null}
                </LibraryColumn>

                <LibraryColumn
                  icon={<Code2 size={16} />}
                  title="Snippets vocaux"
                  badge={String(teamWorkspace.sharedSnippets.length)}
                  description="Raccourcis : tu dis un mot-clé, Vocalype insère la phrase complète."
                >
                  {teamWorkspace.sharedSnippets.map((snippet) => (
                    <AssetCard
                      key={snippet.id}
                      kind="snippet"
                      title={`${snippet.trigger} →`}
                      description={snippet.expansion}
                      usage={useFakeUsage(snippet.id, "snippet")}
                      triggerLabel="déclenchements"
                      workspaceName={workspaceName}
                      mono
                      createdByName={snippet.createdByName}
                      createdByEmail={snippet.createdByEmail}
                      createdAt={snippet.createdAt}
                      updatedByName={snippet.updatedByName}
                      updatedByEmail={snippet.updatedByEmail}
                      updatedAt={snippet.updatedAt}
                      canManage={canManageSharedAssets}
                      onEdit={() => handleEditSnippet(snippet.id)}
                      onDelete={() => void handleDeleteSnippet(snippet.id)}
                    />
                  ))}
                  {teamWorkspace.sharedSnippets.length === 0 ? (
                    <div
                      style={{
                        padding: "14px 12px",
                        fontSize: 12.5,
                        color: "rgba(255,255,255,0.42)",
                      }}
                    >
                      Aucun snippet vocal partagé pour le moment.
                    </div>
                  ) : null}
                  {snippetComposerOpen ? (
                    <div
                      style={{
                        ...innerTile,
                        padding: 12,
                        display: "grid",
                        gap: 8,
                      }}
                    >
                      <input
                        type="text"
                        value={snippetTrigger}
                        onChange={(event) =>
                          setSnippetTrigger(event.target.value)
                        }
                        placeholder="Trigger vocal"
                        disabled={assetLoading}
                        style={inputStyle}
                      />
                      <textarea
                        value={snippetExpansion}
                        onChange={(event) =>
                          setSnippetExpansion(event.target.value)
                        }
                        placeholder="Phrase complète"
                        disabled={assetLoading}
                        rows={3}
                        style={textAreaStyle}
                      />
                      <div style={{ display: "flex", gap: 8 }}>
                        <Button
                          type="button"
                          variant="primary-soft"
                          size="sm"
                          className="flex-1"
                          onClick={() => void handleSaveSnippet()}
                          disabled={
                            assetLoading ||
                            !snippetTrigger.trim() ||
                            !snippetExpansion.trim()
                          }
                        >
                          {editingSnippetId ? "Enregistrer" : "Nouveau snippet"}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setSnippetTrigger("");
                            setSnippetExpansion("");
                            setEditingSnippetId(null);
                            setSnippetComposerOpen(false);
                          }}
                          disabled={assetLoading}
                        >
                          Annuler
                        </Button>
                      </div>
                    </div>
                  ) : canManageSharedAssets ? (
                    <AddTile
                      label="Nouveau snippet"
                      onClick={() => {
                        setSnippetTrigger("");
                        setSnippetExpansion("");
                        setEditingSnippetId(null);
                        setSnippetComposerOpen(true);
                      }}
                    />
                  ) : null}
                </LibraryColumn>

                <LibraryColumn
                  icon={<BookText size={16} />}
                  title="Termes métier"
                  badge={String(teamWorkspace.sharedDictionary.length)}
                  description="Vocabulaire reconnu en priorité : ATS, noms de produit, jargon recrutement."
                >
                  {teamWorkspace.sharedDictionary.map((term) => (
                    <AssetCard
                      key={term.id}
                      kind="term"
                      title={term.term}
                      description={term.note}
                      usage={0}
                      triggerLabel="usage"
                      workspaceName={workspaceName}
                      createdByName={term.createdByName}
                      createdByEmail={term.createdByEmail}
                      createdAt={term.createdAt}
                      updatedByName={term.updatedByName}
                      updatedByEmail={term.updatedByEmail}
                      updatedAt={term.updatedAt}
                      canManage={canManageSharedAssets}
                      onEdit={() => handleEditDictionaryTerm(term.id)}
                      onDelete={() => void handleDeleteDictionaryTerm(term.id)}
                    />
                  ))}
                  {teamWorkspace.sharedDictionary.length === 0 ? (
                    <div
                      style={{
                        padding: "14px 12px",
                        fontSize: 12.5,
                        color: "rgba(255,255,255,0.42)",
                      }}
                    >
                      Aucun terme métier partagé pour le moment.
                    </div>
                  ) : null}
                  {dictionaryComposerOpen ? (
                    <div
                      style={{
                        ...innerTile,
                        padding: 12,
                        display: "grid",
                        gap: 8,
                      }}
                    >
                      <input
                        type="text"
                        value={dictTerm}
                        onChange={(event) => setDictTerm(event.target.value)}
                        placeholder="Terme métier"
                        disabled={assetLoading}
                        style={inputStyle}
                      />
                      <input
                        type="text"
                        value={dictNote}
                        onChange={(event) => setDictNote(event.target.value)}
                        placeholder="Note ou règle d’usage"
                        disabled={assetLoading}
                        style={inputStyle}
                      />
                      <div style={{ display: "flex", gap: 8 }}>
                        <Button
                          type="button"
                          variant="primary-soft"
                          size="sm"
                          className="flex-1"
                          onClick={() => void handleSaveDictionaryTerm()}
                          disabled={assetLoading || !dictTerm.trim()}
                        >
                          {editingDictId ? "Enregistrer" : "Nouveau terme"}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setDictTerm("");
                            setDictNote("");
                            setEditingDictId(null);
                            setDictionaryComposerOpen(false);
                          }}
                          disabled={assetLoading}
                        >
                          Annuler
                        </Button>
                      </div>
                    </div>
                  ) : canManageSharedAssets ? (
                    <AddTile
                      label="Nouveau terme"
                      onClick={() => {
                        setDictTerm("");
                        setDictNote("");
                        setEditingDictId(null);
                        setDictionaryComposerOpen(true);
                      }}
                    />
                  ) : null}
                </LibraryColumn>
              </div>
            </>
          ) : null}

          {activeTab === "activity" ? (
            <>
              <SectionTitle
                title="Activité récente"
                description="14 derniers jours · partagée avec tous les membres"
              />
              <div style={{ ...shellPanel, padding: "6px 0" }}>
                {activityFeed.map((item, index) => {
                  const palette = getAvatarPalette(item.who);
                  return (
                    <div
                      key={item.key}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "auto 1fr auto",
                        gap: 14,
                        alignItems: "center",
                        padding: "14px 20px",
                        borderBottom:
                          index === activityFeed.length - 1
                            ? "none"
                            : "1px solid rgba(255,255,255,0.06)",
                      }}
                    >
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: "50%",
                          background: palette.bg,
                          color: palette.fg,
                          display: "grid",
                          placeItems: "center",
                          fontWeight: 700,
                          fontSize: 11,
                        }}
                      >
                        {getInitials(item.who, "W")}
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          color: "rgba(255,255,255,0.72)",
                          lineHeight: 1.5,
                        }}
                      >
                        <b style={{ color: "rgba(255,255,255,0.94)" }}>
                          {item.who}
                        </b>{" "}
                        {item.text}
                      </div>
                      <div
                        style={{
                          fontSize: 11.5,
                          color: "rgba(255,255,255,0.24)",
                          fontFamily:
                            "ui-monospace, SFMono-Regular, Menlo, monospace",
                        }}
                      >
                        {item.time}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}
          {activeTab === "settings" ? (
            <>
              <SectionTitle
                title="Réglages du workspace"
                description="Les modifications s'appliquent à tous les membres."
              />
              <div style={{ ...shellPanel, padding: "6px 0" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 18,
                    alignItems: "center",
                    padding: "14px 18px",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: "rgba(255,255,255,0.94)",
                      }}
                    >
                      Nom du workspace
                    </div>
                    <div
                      style={{
                        marginTop: 2,
                        fontSize: 12.5,
                        color: "rgba(255,255,255,0.34)",
                      }}
                    >
                      Affiché en haut de l'app pour tous les membres.
                    </div>
                  </div>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <input
                      value={pendingWorkspaceName}
                      onChange={(event) =>
                        setPendingWorkspaceName(event.target.value)
                      }
                      readOnly={!canManageWorkspace}
                      disabled={!canManageWorkspace || workspaceLoading}
                      style={{
                        ...inputStyle,
                        minWidth: 240,
                        opacity: canManageWorkspace ? 1 : 0.78,
                      }}
                    />
                    {canManageWorkspace ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={
                          workspaceLoading ||
                          !pendingWorkspaceName.trim() ||
                          pendingWorkspaceName.trim() === workspaceName
                        }
                        onClick={() =>
                          void handleSaveWorkspaceSettings({
                            name: pendingWorkspaceName.trim(),
                          })
                        }
                      >
                        Enregistrer
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 18,
                    alignItems: "center",
                    padding: "14px 18px",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: "rgba(255,255,255,0.94)",
                      }}
                    >
                      Région de traitement
                    </div>
                    <div
                      style={{
                        marginTop: 2,
                        fontSize: 12.5,
                        color: "rgba(255,255,255,0.34)",
                      }}
                    >
                      Vos audios sont traités puis supprimés dans la région
                      choisie.
                    </div>
                  </div>
                  <Dropdown
                    className="min-w-[180px]"
                    selectedValue={processingRegion}
                    onSelect={(value) =>
                      void handleSaveWorkspaceSettings({
                        processing_region: value === "us" ? "us" : "ca",
                      })
                    }
                    disabled={!canManageWorkspace || workspaceLoading}
                    options={[
                      { value: "ca", label: "Canada" },
                      { value: "us", label: "États-Unis" },
                    ]}
                  />
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 18,
                    alignItems: "center",
                    padding: "14px 18px",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: "rgba(255,255,255,0.94)",
                      }}
                    >
                      Lexique partagé par défaut
                    </div>
                    <div
                      style={{
                        marginTop: 2,
                        fontSize: 12.5,
                        color: "rgba(255,255,255,0.34)",
                      }}
                    >
                      Les nouveaux membres héritent automatiquement des termes
                      métier.
                    </div>
                  </div>
                  <Dropdown
                    className="min-w-[160px]"
                    selectedValue={
                      sharedLexiconEnabled ? "enabled" : "disabled"
                    }
                    onSelect={(value) =>
                      void handleSaveWorkspaceSettings({
                        shared_lexicon_enabled: value === "enabled",
                      })
                    }
                    disabled={!canManageWorkspace || workspaceLoading}
                    options={[
                      { value: "enabled", label: "Activé" },
                      { value: "disabled", label: "Désactivé" },
                    ]}
                  />
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 18,
                    alignItems: "center",
                    padding: "14px 18px",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: "#f08585",
                      }}
                    >
                      Supprimer le workspace
                    </div>
                    <div
                      style={{
                        marginTop: 2,
                        fontSize: 12.5,
                        color: "rgba(255,255,255,0.34)",
                      }}
                    >
                      Action irréversible. Tous les membres perdent l'accès
                      immédiatement.
                    </div>
                  </div>
                  {isOwner ? (
                    <button
                      type="button"
                      onClick={() => void handleDeleteWorkspace()}
                      disabled={workspaceLoading}
                      className="voca-text-action-btn voca-text-action-btn--danger"
                      style={{
                        height: 38,
                        padding: "0 16px",
                        borderRadius: 10,
                        border: "1px solid rgba(240,133,133,0.30)",
                        background: "rgba(240,133,133,0.06)",
                        color: "#f08585",
                        fontSize: 13.5,
                        fontWeight: 600,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        opacity: workspaceLoading ? 0.6 : 1,
                      }}
                    >
                      Supprimer…
                    </button>
                  ) : (
                    <div
                      style={{
                        fontSize: 12.5,
                        color: "rgba(255,255,255,0.28)",
                      }}
                    >
                      Réservé au propriétaire
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};
