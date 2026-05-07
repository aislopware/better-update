import starlight from "@astrojs/starlight";
import { defineConfig, passthroughImageService } from "astro/config";

export default defineConfig({
  image: {
    service: passthroughImageService(),
  },
  integrations: [
    starlight({
      title: "Better Update",
      description: "The CLI for shipping OTA updates to Expo and React Native apps.",
      logo: {
        light: "./src/assets/logo-light.svg",
        dark: "./src/assets/logo-dark.svg",
        replacesTitle: false,
      },
      favicon: "/favicon.svg",
      customCss: ["./src/styles/custom.css"],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/better-update/better-update",
        },
      ],
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        vi: { label: "Tiếng Việt", lang: "vi" },
        ja: { label: "日本語", lang: "ja" },
        "zh-cn": { label: "简体中文", lang: "zh-CN" },
      },
      editLink: {
        baseUrl: "https://github.com/better-update/better-update/edit/main/apps/docs/",
      },
      lastUpdated: true,
      pagination: true,
      sidebar: [
        {
          label: "Getting Started",
          translations: {
            vi: "Bắt đầu",
            ja: "はじめに",
            "zh-CN": "入门指南",
          },
          items: [{ slug: "start/quickstart" }, { slug: "start/installation" }],
        },
        {
          label: "Guides",
          translations: {
            vi: "Hướng dẫn",
            ja: "ガイド",
            "zh-CN": "使用指南",
          },
          items: [
            { slug: "guides/publishing" },
            { slug: "guides/channels-and-branches" },
            { slug: "guides/rollouts-and-rollbacks" },
            { slug: "guides/native-builds" },
            { slug: "guides/environments" },
          ],
        },
        {
          label: "Reference",
          translations: {
            vi: "Tham chiếu",
            ja: "リファレンス",
            "zh-CN": "参考资料",
          },
          items: [{ slug: "reference/cli" }],
        },
      ],
    }),
  ],
});
