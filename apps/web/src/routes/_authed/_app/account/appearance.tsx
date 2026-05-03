import { createFileRoute } from "@tanstack/react-router";

import { AppearanceRadioGroup } from "../../../../components/appearance-radio";
import { SettingCard } from "../../../../components/setting-card";
import { useTheme } from "../../../../lib/use-theme";

import type { Theme } from "../../../../lib/use-theme";

const ThumbLight = () => (
  <svg viewBox="0 0 160 100" className="size-full" xmlns="http://www.w3.org/2000/svg">
    <rect width="160" height="100" fill="#fafafa" />
    <rect x="8" y="8" width="38" height="84" rx="4" fill="#f0f0f0" />
    <rect x="14" y="16" width="26" height="3" rx="1.5" fill="#d4d4d4" />
    <rect x="14" y="24" width="20" height="3" rx="1.5" fill="#d4d4d4" />
    <rect x="14" y="32" width="22" height="3" rx="1.5" fill="#d4d4d4" />
    <rect x="54" y="8" width="98" height="14" rx="3" fill="#ffffff" stroke="#e5e5e5" />
    <rect x="54" y="30" width="98" height="62" rx="4" fill="#ffffff" stroke="#e5e5e5" />
    <rect x="62" y="38" width="40" height="3" rx="1.5" fill="#171717" />
    <rect x="62" y="46" width="60" height="2.5" rx="1" fill="#a3a3a3" />
    <rect x="62" y="58" width="82" height="22" rx="3" fill="#f5f5f5" />
  </svg>
);

const ThumbDark = () => (
  <svg viewBox="0 0 160 100" className="size-full" xmlns="http://www.w3.org/2000/svg">
    <rect width="160" height="100" fill="#0a0a0a" />
    <rect x="8" y="8" width="38" height="84" rx="4" fill="#171717" />
    <rect x="14" y="16" width="26" height="3" rx="1.5" fill="#404040" />
    <rect x="14" y="24" width="20" height="3" rx="1.5" fill="#404040" />
    <rect x="14" y="32" width="22" height="3" rx="1.5" fill="#404040" />
    <rect x="54" y="8" width="98" height="14" rx="3" fill="#171717" stroke="#262626" />
    <rect x="54" y="30" width="98" height="62" rx="4" fill="#171717" stroke="#262626" />
    <rect x="62" y="38" width="40" height="3" rx="1.5" fill="#fafafa" />
    <rect x="62" y="46" width="60" height="2.5" rx="1" fill="#737373" />
    <rect x="62" y="58" width="82" height="22" rx="3" fill="#262626" />
  </svg>
);

const ThumbSystem = () => (
  <svg viewBox="0 0 160 100" className="size-full" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <clipPath id="left-half">
        <rect x="0" y="0" width="80" height="100" />
      </clipPath>
      <clipPath id="right-half">
        <rect x="80" y="0" width="80" height="100" />
      </clipPath>
    </defs>
    <g clipPath="url(#left-half)">
      <rect width="160" height="100" fill="#fafafa" />
      <rect x="8" y="8" width="38" height="84" rx="4" fill="#f0f0f0" />
      <rect x="54" y="8" width="98" height="14" rx="3" fill="#ffffff" stroke="#e5e5e5" />
      <rect x="54" y="30" width="98" height="62" rx="4" fill="#ffffff" stroke="#e5e5e5" />
    </g>
    <g clipPath="url(#right-half)">
      <rect width="160" height="100" fill="#0a0a0a" />
      <rect x="8" y="8" width="38" height="84" rx="4" fill="#171717" />
      <rect x="54" y="8" width="98" height="14" rx="3" fill="#171717" stroke="#262626" />
      <rect x="54" y="30" width="98" height="62" rx="4" fill="#171717" stroke="#262626" />
    </g>
  </svg>
);

const THEME_OPTIONS = [
  { value: "light" as const, label: "Light", preview: <ThumbLight /> },
  { value: "dark" as const, label: "Dark", preview: <ThumbDark /> },
  { value: "system" as const, label: "System", preview: <ThumbSystem /> },
] satisfies readonly { value: Theme; label: string; preview: ReturnType<typeof ThumbLight> }[];

const AppearancePage = () => {
  const { theme, updateTheme } = useTheme();
  return (
    <SettingCard title="Theme" description="Choose how the dashboard should appear to you.">
      <AppearanceRadioGroup
        name="appearance-theme"
        value={theme}
        onValueChange={updateTheme}
        options={THEME_OPTIONS}
      />
    </SettingCard>
  );
};

export const Route = createFileRoute("/_authed/_app/account/appearance")({
  component: AppearancePage,
});
