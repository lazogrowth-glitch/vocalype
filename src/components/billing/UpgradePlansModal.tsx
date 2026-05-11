/* eslint-disable i18next/no-literal-string */
import React, { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, X } from "lucide-react";
import type { BillingCheckoutRequest, BillingInterval } from "@/lib/auth/types";

type UpgradePlansModalProps = {
  open: boolean;
  onClose: () => void;
  onCheckout: (selection: BillingCheckoutRequest) => Promise<void>;
  loadingKey: string | null;
};

type PlanCard = {
  id: string;
  eyebrow: string;
  title: string;
  monthlyPrice: string;
  annualPrice: string;
  monthlySuffix: string;
  annualSuffix: string;
  note: string;
  features: string[];
  cta: string;
  tone: "gold" | "dark";
  plan?: BillingCheckoutRequest["plan"];
  popular?: boolean;
  contactOnly?: boolean;
};

const PLAN_CARDS: PlanCard[] = [
  {
    id: "independent",
    eyebrow: "SOLO RECRUITER",
    title: "Independent",
    monthlyPrice: "$12",
    annualPrice: "$115.20",
    monthlySuffix: "/mo",
    annualSuffix: "/yr",
    note: "No card required · 14-day trial included",
    features: [
      "Unlimited voice-to-text dictation",
      "Paste into any ATS, CRM or inbox",
      "Offline by default — no Wi-Fi needed",
      "Mac · Windows · Linux",
    ],
    cta: "Start dictating today",
    tone: "gold",
    plan: "independent",
  },
  {
    id: "power_user",
    eyebrow: "MOST POPULAR · POWER USER",
    title: "Power user",
    monthlyPrice: "$24",
    annualPrice: "$230.40",
    monthlySuffix: "/mo",
    annualSuffix: "/yr",
    note: "Billed annually",
    features: [
      "Unlimited dictation and history",
      "Recruiter templates (/note, /followup, /summary)",
      "Voice triggers, per-app context and 9 custom actions",
      "Advanced stats and history export",
    ],
    cta: "Start dictating today",
    tone: "dark",
    popular: true,
    plan: "power_user",
  },
  {
    id: "small_agency",
    eyebrow: "FOR YOUR TEAM",
    title: "Small agency",
    monthlyPrice: "$18",
    annualPrice: "$18",
    monthlySuffix: "/seat/mo",
    annualSuffix: "/seat/mo",
    note: "Team management included",
    features: [
      "Priority support",
      "Shared recruiter templates across the team",
      "Team management and centralized billing",
    ],
    cta: "Contact us",
    tone: "dark",
    contactOnly: true,
  },
];

const getCheckoutKey = (selection: BillingCheckoutRequest) =>
  `${selection.plan ?? "default"}:${selection.interval ?? "monthly"}`;

export const UpgradePlansModal: React.FC<UpgradePlansModalProps> = ({
  open,
  onClose,
  onCheckout,
  loadingKey,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const [interval, setInterval] = useState<BillingInterval>("monthly");

  useEffect(() => {
    if (!open) return;

    const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
      'button, a, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/82 px-6 py-8 backdrop-blur-[2px]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upgrade-plans-title"
        className="relative flex w-full max-w-[1180px] flex-col rounded-[24px] border border-logo-primary/18 bg-[#12110f] shadow-[0_30px_120px_rgba(0,0,0,0.55)]"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-white/70 transition hover:bg-white/[0.06] hover:text-white"
          aria-label="Close plans"
        >
          <X size={16} />
        </button>

        <div className="flex flex-col gap-8 px-10 pb-10 pt-9">
          <div className="flex flex-col items-center gap-5">
            <div className="inline-flex rounded-[18px] border border-logo-primary/22 bg-white/[0.03] p-1.5">
              <button
                type="button"
                onClick={() => setInterval("monthly")}
                className={`min-w-[94px] rounded-[14px] px-5 py-3 text-[14px] font-semibold transition ${
                  interval === "monthly"
                    ? "bg-logo-primary text-[#181204]"
                    : "text-white/72 hover:text-white"
                }`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setInterval("yearly")}
                className={`min-w-[94px] rounded-[14px] px-5 py-3 text-[14px] font-semibold transition ${
                  interval === "yearly"
                    ? "bg-logo-primary text-[#181204]"
                    : "text-white/72 hover:text-white"
                }`}
              >
                Annual
              </button>
            </div>
            <div className="text-center">
              <h2
                id="upgrade-plans-title"
                className="text-[30px] font-semibold leading-tight text-white"
              >
                Upgrade Vocalype
              </h2>
              <p className="mt-2 text-[14px] text-white/45">
                Pick the plan to open in Stripe Checkout.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            {PLAN_CARDS.map((card) => {
              const selection = {
                plan: card.plan,
                interval,
              } satisfies BillingCheckoutRequest;
              const isLoading =
                !card.contactOnly && loadingKey === getCheckoutKey(selection);
              const price =
                interval === "yearly" ? card.annualPrice : card.monthlyPrice;
              const suffix =
                interval === "yearly" ? card.annualSuffix : card.monthlySuffix;

              return (
                <section
                  key={card.id}
                  className={`flex min-h-[540px] flex-col rounded-[22px] border px-7 pb-7 pt-7 ${
                    card.tone === "gold"
                      ? "border-logo-primary/35 bg-[linear-gradient(180deg,rgba(201,168,76,0.08),rgba(255,255,255,0.02))]"
                      : "border-logo-primary/22 bg-white/[0.02]"
                  }`}
                >
                  <div className="mb-5 flex items-start justify-between gap-4">
                    <p className="text-[12px] font-semibold uppercase tracking-[0.04em] text-white/72">
                      {card.eyebrow}
                    </p>
                    {card.popular ? (
                      <span className="rounded-full border border-logo-primary/30 bg-logo-primary/10 px-3 py-1 text-[11px] font-semibold text-logo-primary">
                        Popular
                      </span>
                    ) : null}
                  </div>

                  <h3 className="text-[28px] font-semibold leading-none text-white">
                    {card.title}
                  </h3>
                  <div className="mt-5 flex items-end gap-1 text-white">
                    <span className="text-[62px] font-semibold leading-[0.9]">
                      {price}
                    </span>
                    <span className="mb-2 text-[19px] font-medium text-white/92">
                      {suffix}
                    </span>
                  </div>
                  <p className="mt-3 text-[14px] leading-6 text-white/48">
                    {card.note}
                  </p>

                  <ul className="mt-7 flex flex-1 flex-col gap-4">
                    {card.features.map((feature) => (
                      <li
                        key={feature}
                        className="flex items-start gap-3 text-[15px] leading-7 text-white/78"
                      >
                        <span className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-logo-primary/12 text-logo-primary">
                          <Check size={13} strokeWidth={2.6} />
                        </span>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>

                  {card.contactOnly ? (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          void openUrl(
                            "mailto:contact@vocalype.com?subject=Small%20agency%20plan",
                          )
                        }
                        className="mt-8 inline-flex min-h-[48px] items-center justify-center rounded-[14px] bg-black/55 px-5 text-[15px] font-semibold text-white transition hover:bg-black/72"
                      >
                        {card.cta}
                      </button>
                      <p className="mt-3 text-center text-[13px] text-white/34">
                        Fast response for agency enquiries.
                      </p>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => void onCheckout(selection)}
                        disabled={Boolean(loadingKey)}
                        className={`mt-8 inline-flex min-h-[48px] items-center justify-center rounded-[14px] px-5 text-[15px] font-semibold transition ${
                          card.tone === "gold"
                            ? "bg-logo-primary text-[#181204] hover:brightness-105"
                            : "bg-black/55 text-white hover:bg-black/72"
                        } disabled:cursor-not-allowed disabled:opacity-55`}
                      >
                        {isLoading ? "Opening Checkout..." : card.cta}
                      </button>
                      <p className="mt-3 text-center text-[13px] text-white/34">
                        {card.tone === "gold"
                          ? "No commitment · No credit card"
                          : "Billed with Stripe Checkout"}
                      </p>
                    </>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
