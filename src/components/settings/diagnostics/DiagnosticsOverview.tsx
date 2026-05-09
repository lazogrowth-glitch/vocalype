import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { save } from "@tauri-apps/plugin-dialog";
import { commands } from "@/bindings";
import { Button } from "../../ui/Button";
import { SettingContainer } from "../../ui/SettingContainer";
import { Textarea } from "../../ui/Textarea";
import { getUserFacingErrorMessage } from "@/lib/userFacingErrors";
import type { RuntimeDiagnosticsSnapshot } from "../../../types/runtimeObservability";

interface DiagnosticsOverviewProps {
  grouped?: boolean;
}

type ActionState = "idle" | "loading";
const SUPPORT_EMAIL = "contact@vocalype.com";

function summarizeSnapshot(
  snapshot: RuntimeDiagnosticsSnapshot,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const problems: string[] = [];

  if (!snapshot.model_loaded) {
    problems.push(
      t("settings.debug.overview.summaryFlags.modelNotLoaded", {
        defaultValue: "model not loaded",
      }),
    );
  }
  if (!snapshot.selected_microphone_available) {
    problems.push(
      t("settings.debug.overview.summaryFlags.microphoneMissing", {
        defaultValue: "selected microphone missing",
      }),
    );
  }
  if (!snapshot.microphone_backend_ready) {
    problems.push(
      t("settings.debug.overview.summaryFlags.backendNotReady", {
        defaultValue: "microphone backend not ready",
      }),
    );
  }
  if (snapshot.recent_errors.length > 0) {
    problems.push(
      t("settings.debug.overview.summaryFlags.recentErrors", {
        defaultValue: "recent runtime errors",
      }),
    );
  }

  const summaryLines = [
    `Vocalype ${snapshot.app_version}`,
    `${t("settings.debug.overview.fields.lifecycle", { defaultValue: "Lifecycle" })}: ${snapshot.lifecycle_state}`,
    `${t("settings.debug.overview.fields.model", { defaultValue: "Model" })}: ${snapshot.loaded_model_name || snapshot.loaded_model_id || snapshot.selected_model}`,
    `${t("settings.debug.overview.fields.language", { defaultValue: "Language" })}: ${snapshot.selected_language}`,
    `${t("settings.debug.overview.fields.microphone", { defaultValue: "Microphone" })}: ${snapshot.selected_microphone || t("settings.debug.overview.notAvailable", { defaultValue: "not available" })}`,
    `${t("settings.debug.overview.fields.pasteMethod", { defaultValue: "Paste method" })}: ${snapshot.paste_method}`,
    `${t("settings.debug.overview.fields.inputLevel", { defaultValue: "Input level" })}: ${snapshot.input_level_state}`,
    `${t("settings.debug.overview.fields.permission", { defaultValue: "Microphone permission" })}: ${snapshot.microphone_permission_state}`,
    `${t("settings.debug.overview.fields.recentErrors", { defaultValue: "Recent errors" })}: ${snapshot.recent_errors.length}`,
  ];

  if (problems.length > 0) {
    summaryLines.push(
      `${t("settings.debug.overview.fields.attention", { defaultValue: "Needs attention" })}: ${problems.join(", ")}`,
    );
  }

  return summaryLines.join("\n");
}

function buildFullSupportReport(
  snapshot: RuntimeDiagnosticsSnapshot,
  t: (key: string, options?: Record<string, unknown>) => string,
  details: {
    issueSummary: string;
    issueSteps: string;
    expectedBehavior: string;
  },
) {
  const lines = [
    t("settings.debug.overview.support.reportTitle", {
      defaultValue: "Vocalype support report",
    }),
    "=======================",
    "",
    `${t("settings.debug.overview.support.reportSections.issueSummary", {
      defaultValue: "Issue summary",
    })}: ${details.issueSummary || t("settings.debug.overview.support.notProvided", { defaultValue: "Not provided" })}`,
    "",
    `${t("settings.debug.overview.support.reportSections.steps", {
      defaultValue: "What happened",
    })}:`,
    details.issueSteps ||
      t("settings.debug.overview.support.notProvided", {
        defaultValue: "Not provided",
      }),
    "",
    `${t("settings.debug.overview.support.reportSections.expected", {
      defaultValue: "Expected behavior",
    })}:`,
    details.expectedBehavior ||
      t("settings.debug.overview.support.notProvided", {
        defaultValue: "Not provided",
      }),
    "",
    `${t("settings.debug.overview.support.reportSections.summary", {
      defaultValue: "Diagnostics summary",
    })}:`,
    summarizeSnapshot(snapshot, t),
    "",
    `${t("settings.debug.overview.support.reportSections.runtime", {
      defaultValue: "Runtime details",
    })}:`,
    `app_version: ${snapshot.app_version}`,
    `captured_at_ms: ${snapshot.captured_at_ms}`,
    `lifecycle_state: ${snapshot.lifecycle_state}`,
    `selected_model: ${snapshot.selected_model}`,
    `loaded_model_id: ${snapshot.loaded_model_id ?? "n/a"}`,
    `loaded_model_name: ${snapshot.loaded_model_name ?? "n/a"}`,
    `selected_language: ${snapshot.selected_language}`,
    `selected_microphone: ${snapshot.selected_microphone ?? "n/a"}`,
    `microphone_permission_state: ${snapshot.microphone_permission_state}`,
    `paste_method: ${snapshot.paste_method}`,
    `input_level_state: ${snapshot.input_level_state}`,
    `recent_errors_count: ${snapshot.recent_errors.length}`,
    `last_audio_error: ${snapshot.last_audio_error ?? "n/a"}`,
    `current_app_context: ${snapshot.current_app_context?.category ?? "n/a"} / ${snapshot.current_app_context?.process_name ?? "n/a"}`,
    `last_transcription_context: ${snapshot.last_transcription_app_context?.category ?? "n/a"} / ${snapshot.last_transcription_app_context?.process_name ?? "n/a"}`,
  ];

  if (snapshot.recent_errors.length > 0) {
    lines.push(
      "",
      `${t("settings.debug.overview.support.reportSections.errors", {
        defaultValue: "Recent errors",
      })}:`,
    );
    snapshot.recent_errors
      .slice(-5)
      .reverse()
      .forEach((entry) => {
        lines.push(`- [${entry.stage}] ${entry.code}: ${entry.message}`);
      });
  }

  return lines.join("\n");
}

export const DiagnosticsOverview: React.FC<DiagnosticsOverviewProps> = ({
  grouped = true,
}) => {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<RuntimeDiagnosticsSnapshot | null>(
    null,
  );
  const [actionState, setActionState] = useState<ActionState>("idle");
  const [status, setStatus] = useState<string | null>(null);
  const [issueSummary, setIssueSummary] = useState("");
  const [issueSteps, setIssueSteps] = useState("");
  const [expectedBehavior, setExpectedBehavior] = useState("");

  const clearStatusSoon = () => {
    window.setTimeout(() => setStatus(null), 3500);
  };

  const getOrRefreshSnapshot = async () => {
    if (snapshot) return snapshot;

    const result = await commands.getRuntimeDiagnostics();
    if (result.status === "ok") {
      const nextSnapshot = result.data as RuntimeDiagnosticsSnapshot;
      setSnapshot(nextSnapshot);
      return nextSnapshot;
    }

    throw result.error;
  };

  const refreshSnapshot = async () => {
    setActionState("loading");
    try {
      const result = await commands.getRuntimeDiagnostics();
      if (result.status === "ok") {
        const nextSnapshot = result.data as RuntimeDiagnosticsSnapshot;
        setSnapshot(nextSnapshot);
        setStatus(
          t("settings.debug.overview.status.refreshed", {
            defaultValue: "Diagnostics refreshed",
          }),
        );
      } else {
        setStatus(getUserFacingErrorMessage(result.error, { t }));
      }
    } catch (error) {
      setStatus(getUserFacingErrorMessage(error, { t }));
    } finally {
      setActionState("idle");
      clearStatusSoon();
    }
  };

  const handleCopySummary = async () => {
    let activeSnapshot: RuntimeDiagnosticsSnapshot;
    setActionState("loading");
    try {
      activeSnapshot = await getOrRefreshSnapshot();
    } catch (error) {
      setStatus(getUserFacingErrorMessage(error, { t }));
      clearStatusSoon();
      setActionState("idle");
      return;
    }
    setActionState("idle");

    try {
      await navigator.clipboard.writeText(summarizeSnapshot(activeSnapshot, t));
      setStatus(
        t("settings.debug.overview.status.copied", {
          defaultValue: "Summary copied",
        }),
      );
    } catch (error) {
      setStatus(
        t("settings.debug.overview.status.copyFailed", {
          defaultValue: "Copy failed: {{error}}",
          error: getUserFacingErrorMessage(error, { t }),
        }),
      );
    } finally {
      clearStatusSoon();
    }
  };

  const handleContactSupport = async () => {
    setActionState("loading");
    try {
      const activeSnapshot = await getOrRefreshSnapshot();
      const subject = t("settings.debug.overview.support.subject", {
        defaultValue: "Vocalype support request",
      });
      const body = [
        `${t("settings.debug.overview.support.bodyIssueSummary", {
          defaultValue: "Issue summary:",
        })} ${
          issueSummary ||
          t("settings.debug.overview.support.notProvided", {
            defaultValue: "Not provided",
          })
        }`,
        "",
        t("settings.debug.overview.support.bodyIntro", {
          defaultValue:
            "Hello, I need help with Vocalype. Here is my diagnostics summary:",
        }),
        "",
        summarizeSnapshot(activeSnapshot, t),
        "",
        t("settings.debug.overview.support.bodySteps", {
          defaultValue: "What I was doing when the issue happened:",
        }),
        issueSteps || "",
        "",
        t("settings.debug.overview.support.bodyExpected", {
          defaultValue: "What I expected instead:",
        }),
        expectedBehavior || "",
        "",
        t("settings.debug.overview.support.bodyAttachment", {
          defaultValue:
            "If needed, I can also attach the exported diagnostics JSON.",
        }),
      ].join("\n");

      const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.open(mailto, "_blank");
      setStatus(
        t("settings.debug.overview.status.supportOpened", {
          defaultValue: "Email draft opened",
        }),
      );
    } catch (error) {
      setStatus(
        t("settings.debug.overview.status.supportOpenFailed", {
          defaultValue: "Could not open support email: {{error}}",
          error: getUserFacingErrorMessage(error, { t }),
        }),
      );
    } finally {
      setActionState("idle");
      clearStatusSoon();
    }
  };

  const handleCopyFullReport = async () => {
    setActionState("loading");
    try {
      const activeSnapshot = await getOrRefreshSnapshot();
      const report = buildFullSupportReport(activeSnapshot, t, {
        issueSummary,
        issueSteps,
        expectedBehavior,
      });
      await navigator.clipboard.writeText(report);
      setStatus(
        t("settings.debug.overview.status.fullReportCopied", {
          defaultValue: "Full support report copied",
        }),
      );
    } catch (error) {
      setStatus(
        t("settings.debug.overview.status.fullReportCopyFailed", {
          defaultValue: "Could not copy support report: {{error}}",
          error: getUserFacingErrorMessage(error, { t }),
        }),
      );
    } finally {
      setActionState("idle");
      clearStatusSoon();
    }
  };

  const handleExportSupportPackage = async () => {
    setActionState("loading");
    try {
      const activeSnapshot = await getOrRefreshSnapshot();
      const report = buildFullSupportReport(activeSnapshot, t, {
        issueSummary,
        issueSteps,
        expectedBehavior,
      });
      const path = await save({
        defaultPath: "vocalype-support-package.zip",
        filters: [{ name: "ZIP", extensions: ["zip"] }],
      });
      if (!path) {
        setActionState("idle");
        return;
      }
      const result = await commands.exportSupportPackage(path, report);
      if (result.status === "ok") {
        setStatus(
          t("settings.debug.overview.status.supportPackageExported", {
            defaultValue: "Support package exported",
          }),
        );
      } else {
        setStatus(getUserFacingErrorMessage(result.error, { t }));
      }
    } catch (error) {
      setStatus(
        t("settings.debug.overview.status.supportPackageExportFailed", {
          defaultValue: "Could not export support package: {{error}}",
          error: getUserFacingErrorMessage(error, { t }),
        }),
      );
    } finally {
      setActionState("idle");
      clearStatusSoon();
    }
  };

  const handleExport = async () => {
    setActionState("loading");
    try {
      const path = await save({
        defaultPath: "vocalype-diagnostics.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) {
        setActionState("idle");
        return;
      }

      const result = await commands.exportRuntimeDiagnostics(path);
      if (result.status === "ok") {
        setStatus(
          t("settings.debug.overview.status.exported", {
            defaultValue: "Diagnostics exported",
          }),
        );
      } else {
        setStatus(getUserFacingErrorMessage(result.error, { t }));
      }
    } catch (error) {
      setStatus(
        t("settings.debug.overview.status.exportFailed", {
          defaultValue: "Export failed: {{error}}",
          error: getUserFacingErrorMessage(error, { t }),
        }),
      );
    } finally {
      setActionState("idle");
      clearStatusSoon();
    }
  };

  const handleOpenLogs = async () => {
    try {
      await commands.openLogDir();
      setStatus(
        t("settings.debug.overview.status.logsOpened", {
          defaultValue: "Log folder opened",
        }),
      );
    } catch (error) {
      setStatus(
        t("settings.debug.overview.status.logsOpenFailed", {
          defaultValue: "Could not open logs: {{error}}",
          error: getUserFacingErrorMessage(error, { t }),
        }),
      );
    } finally {
      clearStatusSoon();
    }
  };

  const summaryCards = useMemo(() => {
    if (!snapshot) return [];

    return [
      {
        label: t("settings.debug.overview.fields.version", {
          defaultValue: "Version",
        }),
        value: `v${snapshot.app_version}`,
      },
      {
        label: t("settings.debug.overview.fields.model", {
          defaultValue: "Model",
        }),
        value:
          snapshot.loaded_model_name ||
          snapshot.loaded_model_id ||
          snapshot.selected_model,
      },
      {
        label: t("settings.debug.overview.fields.microphone", {
          defaultValue: "Microphone",
        }),
        value:
          snapshot.selected_microphone ||
          t("settings.debug.overview.notAvailable", {
            defaultValue: "Not available",
          }),
      },
      {
        label: t("settings.debug.overview.fields.recentErrors", {
          defaultValue: "Recent errors",
        }),
        value: String(snapshot.recent_errors.length),
      },
    ];
  }, [snapshot, t]);

  const healthTone = useMemo(() => {
    if (!snapshot) return "neutral";
    if (
      snapshot.recent_errors.length > 0 ||
      !snapshot.selected_microphone_available ||
      !snapshot.microphone_backend_ready
    ) {
      return "warning";
    }
    return "good";
  }, [snapshot]);

  const healthLabel = useMemo(() => {
    if (!snapshot) {
      return t("settings.debug.overview.health.idle", {
        defaultValue: "No snapshot yet",
      });
    }
    if (healthTone === "warning") {
      return t("settings.debug.overview.health.warning", {
        defaultValue: "Attention recommended",
      });
    }
    return t("settings.debug.overview.health.good", {
      defaultValue: "Looks healthy",
    });
  }, [healthTone, snapshot, t]);

  const recentErrors = useMemo(
    () => (snapshot?.recent_errors ?? []).slice(-3).reverse(),
    [snapshot],
  );

  return (
    <SettingContainer
      title={t("settings.debug.overview.title", {
        defaultValue: "Diagnostics",
      })}
      description={t("settings.debug.overview.description", {
        defaultValue:
          "Collect a support snapshot, copy a short summary, or open the local logs when something feels off.",
      })}
      descriptionMode="inline"
      grouped={grouped}
      layout="stacked"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={refreshSnapshot}
            disabled={actionState === "loading"}
          >
            {t("settings.debug.overview.actions.refresh", {
              defaultValue: "Refresh snapshot",
            })}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleCopySummary}
            disabled={actionState === "loading"}
          >
            {t("settings.debug.overview.actions.copySummary", {
              defaultValue: "Copy summary",
            })}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleExport}
            disabled={actionState === "loading"}
          >
            {t("settings.debug.overview.actions.export", {
              defaultValue: "Export JSON",
            })}
          </Button>
          <Button size="sm" variant="secondary" onClick={handleOpenLogs}>
            {t("settings.debug.overview.actions.openLogs", {
              defaultValue: "Open logs",
            })}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleCopyFullReport}
            disabled={actionState === "loading"}
          >
            {t("settings.debug.overview.actions.copyFullReport", {
              defaultValue: "Copy full report",
            })}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleExportSupportPackage}
            disabled={actionState === "loading"}
          >
            {t("settings.debug.overview.actions.exportSupportPackage", {
              defaultValue: "Export support package",
            })}
          </Button>
          <Button
            size="sm"
            variant="primary-soft"
            onClick={handleContactSupport}
            disabled={actionState === "loading"}
          >
            {t("settings.debug.overview.actions.contactSupport", {
              defaultValue: "Send to support",
            })}
          </Button>
        </div>

        <div
          className={`rounded-[14px] border px-4 py-3 ${
            healthTone === "good"
              ? "border-emerald-500/20 bg-emerald-500/8"
              : healthTone === "warning"
                ? "border-amber-500/20 bg-amber-500/8"
                : "border-white/8 bg-white/[0.03]"
          }`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[13px] font-semibold text-white/92">
              {healthLabel}
            </span>
            {status ? (
              <span className="text-[12px] text-white/55">{status}</span>
            ) : null}
          </div>
          <p className="mt-1 text-[12px] leading-5 text-white/50">
            {snapshot
              ? t("settings.debug.overview.capturedAt", {
                  defaultValue: "Captured at {{value}}",
                  value: new Date(snapshot.captured_at_ms).toLocaleString(),
                })
              : t("settings.debug.overview.empty", {
                  defaultValue:
                    "Take a snapshot before sending details to support.",
                })}
          </p>
        </div>

        {summaryCards.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {summaryCards.map((item) => (
              <div
                key={item.label}
                className="rounded-[14px] border border-white/8 bg-white/[0.03] px-4 py-3"
              >
                <p className="text-[11px] uppercase tracking-[0.08em] text-white/38">
                  {item.label}
                </p>
                <p className="mt-1 text-[14px] font-semibold leading-5 text-white/92 break-words">
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[16px] border border-white/8 bg-white/[0.03] p-4">
            <div className="mb-3">
              <h3 className="text-[14px] font-semibold text-white/92">
                {t("settings.debug.overview.support.composeTitle", {
                  defaultValue: "Prepare your support message",
                })}
              </h3>
              <p className="mt-1 text-[12px] leading-5 text-white/52">
                {t("settings.debug.overview.support.composeDescription", {
                  defaultValue:
                    "Large apps usually ask for a short repro, expected behavior, and a diagnostics snapshot. Fill this once and reuse it.",
                })}
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-white/66">
                  {t("settings.debug.overview.support.issueSummaryLabel", {
                    defaultValue: "Issue summary",
                  })}
                </label>
                <Textarea
                  variant="compact"
                  value={issueSummary}
                  onChange={(event) => setIssueSummary(event.target.value)}
                  placeholder={t(
                    "settings.debug.overview.support.issueSummaryPlaceholder",
                    {
                      defaultValue:
                        "Example: paste fails in Slack after recording ends",
                    },
                  )}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-white/66">
                  {t("settings.debug.overview.support.stepsLabel", {
                    defaultValue: "What happened",
                  })}
                </label>
                <Textarea
                  value={issueSteps}
                  onChange={(event) => setIssueSteps(event.target.value)}
                  placeholder={t(
                    "settings.debug.overview.support.stepsPlaceholder",
                    {
                      defaultValue:
                        "List the steps, what app was open, and what Vocalype did.",
                    },
                  )}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-white/66">
                  {t("settings.debug.overview.support.expectedLabel", {
                    defaultValue: "What you expected",
                  })}
                </label>
                <Textarea
                  variant="compact"
                  value={expectedBehavior}
                  onChange={(event) => setExpectedBehavior(event.target.value)}
                  placeholder={t(
                    "settings.debug.overview.support.expectedPlaceholder",
                    {
                      defaultValue:
                        "Example: text should be pasted in the active field without losing clipboard content.",
                    },
                  )}
                />
              </div>
            </div>
          </div>

          <div className="rounded-[16px] border border-white/8 bg-white/[0.03] p-4">
            <div className="mb-3">
              <h3 className="text-[14px] font-semibold text-white/92">
                {t("settings.debug.overview.support.checklistTitle", {
                  defaultValue: "Support checklist",
                })}
              </h3>
              <p className="mt-1 text-[12px] leading-5 text-white/52">
                {t("settings.debug.overview.support.checklistDescription", {
                  defaultValue:
                    "This is the kind of context support teams usually ask for first.",
                })}
              </p>
            </div>
            <div className="space-y-2 text-[12px] leading-5 text-white/70">
              <p>
                {snapshot
                  ? t("settings.debug.overview.support.checks.snapshotReady", {
                      defaultValue: "Snapshot ready",
                    })
                  : t(
                      "settings.debug.overview.support.checks.snapshotMissing",
                      {
                        defaultValue: "Take a fresh snapshot before sending",
                      },
                    )}
              </p>
              <p>
                {issueSteps.trim()
                  ? t("settings.debug.overview.support.checks.reproReady", {
                      defaultValue: "Reproduction details added",
                    })
                  : t("settings.debug.overview.support.checks.reproMissing", {
                      defaultValue: "Add what happened and where it happened",
                    })}
              </p>
              <p>
                {expectedBehavior.trim()
                  ? t("settings.debug.overview.support.checks.expectedReady", {
                      defaultValue: "Expected behavior added",
                    })
                  : t(
                      "settings.debug.overview.support.checks.expectedMissing",
                      {
                        defaultValue: "Explain what you expected instead",
                      },
                    )}
              </p>
              <p>
                {t("settings.debug.overview.support.checks.exportHint", {
                  defaultValue:
                    "If support asks for more detail, export the JSON and attach it to your email.",
                })}
              </p>
            </div>

            {recentErrors.length > 0 ? (
              <div className="mt-4 rounded-[12px] border border-amber-500/18 bg-amber-500/8 px-3 py-3">
                <p className="text-[11px] uppercase tracking-[0.08em] text-amber-200/80">
                  {t("settings.debug.overview.support.recentErrorsTitle", {
                    defaultValue: "Recent errors",
                  })}
                </p>
                <div className="mt-2 space-y-1.5 text-[12px] leading-5 text-white/72">
                  {recentErrors.map((entry) => (
                    <p key={`${entry.code}-${entry.timestamp_ms}`}>
                      [{entry.stage}] {entry.code}: {entry.message}
                    </p>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </SettingContainer>
  );
};
