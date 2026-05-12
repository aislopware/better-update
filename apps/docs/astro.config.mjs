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
      editLink: {
        baseUrl: "https://github.com/better-update/better-update/edit/main/apps/docs/",
      },
      lastUpdated: true,
      pagination: true,
      sidebar: [
        {
          label: "Getting Started",
          items: [{ slug: "start/quickstart" }, { slug: "start/installation" }],
        },
        {
          label: "Guides",
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
          items: [{ slug: "reference/cli" }],
        },
      ],
    }),
  ],
});
