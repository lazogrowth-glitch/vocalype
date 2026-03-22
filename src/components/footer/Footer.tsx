import React, { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useTranslation } from "react-i18next";

import ModelSelector from "../model-selector";
import UpdateChecker from "../update-checker";

const Footer: React.FC = () => {
  const { t } = useTranslation();
  const [version, setVersion] = useState("");

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const appVersion = await getVersion();
        setVersion(appVersion);
      } catch (error) {
        console.error("Failed to get app version:", error);
        setVersion("0.1.2");
      }
    };

    fetchVersion();
  }, []);

  return (
    <div className="hidden w-full border-t border-white/8 bg-black/10 px-3 py-2 backdrop-blur-sm min-[760px]:block min-[760px]:px-4 min-[760px]:py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-text/55">
        <div className="flex min-w-0 items-center gap-4">
          <ModelSelector />
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden min-[760px]:flex">
            <UpdateChecker />
          </div>
          <span className="text-text/50">•</span>
          <span className="rounded-full border border-white/8 bg-white/[0.04] px-2 py-1 text-[10px] font-medium text-text/62">
            {t("footer.version", {
              defaultValue: "v{{version}}",
              version,
            })}
          </span>
        </div>
      </div>
    </div>
  );
};

export default Footer;
