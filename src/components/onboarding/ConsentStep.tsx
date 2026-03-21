import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import VocalTypeLogo from "../icons/VocalTypeLogo";

interface ConsentStepProps {
  onAccept: () => void;
}

const ConsentStep: React.FC<ConsentStepProps> = ({ onAccept }) => {
  const { t } = useTranslation();
  const [accepted, setAccepted] = useState(false);

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center p-8 gap-6">
      <VocalTypeLogo width={140} />

      <div className="max-w-md w-full flex flex-col gap-5">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-text">
            {t("onboarding.consent.title")}
          </h1>
          <p className="text-sm text-text/60 mt-2">
            {t("onboarding.consent.subtitle")}
          </p>
        </div>

        <div className="rounded-xl border border-mid-gray/20 bg-mid-gray/5 p-5 flex flex-col gap-4 text-sm text-text/80">
          <div className="flex gap-3">
            <span className="text-logo-primary mt-0.5 shrink-0">&#128274;</span>
            <p>{t("onboarding.consent.localStorageInfo")}</p>
          </div>
          <div className="flex gap-3">
            <span className="text-logo-primary mt-0.5 shrink-0">&#128268;</span>
            <p>{t("onboarding.consent.serverSentInfo")}</p>
          </div>
          <div className="flex gap-3">
            <span className="text-logo-primary mt-0.5 shrink-0">&#128290;</span>
            <p>{t("onboarding.consent.exportInfo")}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => openUrl("https://vocaltypeai.com/privacy")}
          className="text-xs text-logo-primary/70 hover:text-logo-primary underline text-center transition-colors"
        >
          {t("onboarding.consent.privacyPolicyLink")}
        </button>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border border-mid-gray/40 bg-mid-gray/10 accent-logo-primary cursor-pointer"
          />
          <span className="text-sm text-text/80">
            {t("onboarding.consent.checkboxLabel")}
          </span>
        </label>

        <button
          type="button"
          disabled={!accepted}
          onClick={onAccept}
          className="w-full rounded-xl bg-logo-primary py-3 text-sm font-semibold text-white transition-all hover:bg-logo-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t("onboarding.consent.continueButton")}
        </button>
      </div>
    </div>
  );
};

export default ConsentStep;
