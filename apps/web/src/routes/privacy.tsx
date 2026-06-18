import { createFileRoute } from "@tanstack/react-router";

import { LegalLayout } from "../components/legal-layout";

import type { LegalSectionData } from "../components/legal-layout";

const SECTIONS: readonly LegalSectionData[] = [
  {
    heading: "1. Who we are",
    blocks: [
      {
        kind: "p",
        text: "Better Update (“we”, “us”) is operated by Trần Văn Công, an individual based in Vietnam. This Privacy Policy applies to the Better Update web app and related services (the “Service”). By using the Service, you agree to this policy.",
      },
    ],
  },
  {
    heading: "2. Information we collect",
    blocks: [
      {
        kind: "p",
        text: "Account information. When you sign in with GitHub, we receive your name, email address, GitHub username, avatar, and GitHub user ID.",
      },
      {
        kind: "p",
        text: "Organization and project data. We store the organizations, projects, channels, builds, updates, environment-variable names, and related metadata you create.",
      },
      {
        kind: "p",
        text: "Encrypted secrets. Signing keys, store credentials, and other secrets you store are encrypted on your device before upload. We hold only the ciphertext and cannot read them.",
      },
      {
        kind: "p",
        text: "Update and build artifacts. Your OTA updates (compiled JavaScript bundles — Hermes bytecode — and bundled assets) and build artifacts are stored so we can deliver them to your devices. Your original source code is never uploaded. These artifacts are not end-to-end encrypted, and we can access them to operate the Service.",
      },
      {
        kind: "p",
        text: "Usage and technical data. We collect IP address, request logs, approximate location, browser and device information, and timestamps through our infrastructure provider for security, reliability, and abuse prevention.",
      },
      {
        kind: "p",
        text: "Audit logs. We record actions taken within your organization — who did what, and when — for security and accountability.",
      },
      {
        kind: "p",
        text: "Cookies. We use a session cookie to keep you signed in. We do not use advertising or cross-site tracking cookies.",
      },
    ],
  },
  {
    heading: "3. How we use information",
    blocks: [
      { kind: "p", text: "We use the information we collect to:" },
      {
        kind: "list",
        items: [
          "provide, operate, secure, and improve the Service;",
          "authenticate you and maintain your session;",
          "deliver OTA updates and build artifacts to your devices;",
          "send service, security, and administrative notices;",
          "detect, prevent, and investigate abuse or violations of our Terms;",
          "comply with legal obligations.",
        ],
      },
    ],
  },
  {
    heading: "4. Your secrets stay private",
    blocks: [
      {
        kind: "p",
        text: "Secrets you store are protected with end-to-end encryption: they are encrypted on your device with keys we never receive, so we cannot read, recover, or hand over their contents. This also means that if you lose your keys, we cannot restore the data for you.",
      },
    ],
  },
  {
    heading: "5. How we share information",
    blocks: [
      {
        kind: "p",
        text: "We do not sell your personal information. We share information only as follows:",
      },
      {
        kind: "list",
        items: [
          "Service providers. We use vendors that help us run the Service, including Cloudflare for hosting, storage, and content delivery, and GitHub for authentication. They process data on our behalf under their own terms.",
          "App-distribution platforms. When you choose to use them, Apple and Google receive the information needed to distribute your apps.",
          "Legal and safety. We may disclose information where required by law or to protect the rights, safety, and security of users, the public, or Better Update.",
          "Business transfers. Information may be transferred as part of a merger, acquisition, or sale of assets.",
        ],
      },
    ],
  },
  {
    heading: "6. Data retention",
    blocks: [
      {
        kind: "p",
        text: "We retain information for as long as your account is active or as needed to provide the Service, comply with our legal obligations, resolve disputes, and enforce our agreements. You can ask us to delete your data, subject to those obligations.",
      },
    ],
  },
  {
    heading: "7. International transfers",
    blocks: [
      {
        kind: "p",
        text: "Our infrastructure operates globally, so your information may be processed in countries other than Vietnam, including wherever our infrastructure provider operates. Where we transfer personal data across borders, we take steps to ensure it receives protection consistent with applicable Vietnamese data protection law, including Decree No. 13/2023/ND-CP on Personal Data Protection.",
      },
    ],
  },
  {
    heading: "8. Security",
    blocks: [
      {
        kind: "p",
        text: "We protect information using measures such as encryption in transit, access controls, and end-to-end encryption for stored secrets. No method of transmission or storage is completely secure, and we cannot guarantee absolute security.",
      },
    ],
  },
  {
    heading: "9. Your rights",
    blocks: [
      {
        kind: "p",
        text: "Depending on where you live, you may have the right to access, correct, delete, export, or restrict the processing of your personal data, and to object to certain processing. To exercise these rights, contact legal@jmango360.dev. We will respond as required by applicable law, including Vietnam's Decree No. 13/2023/ND-CP on Personal Data Protection, and the GDPR or CCPA where they apply to you.",
      },
    ],
  },
  {
    heading: "10. Children",
    blocks: [
      {
        kind: "p",
        text: "The Service is not directed to children under 16, and we do not knowingly collect personal information from them. If you believe a child has provided us personal information, contact us and we will delete it.",
      },
    ],
  },
  {
    heading: "11. Changes to this policy",
    blocks: [
      {
        kind: "p",
        text: "We may update this Privacy Policy from time to time. We will notify you of material changes through the Service or by email, and we will update the “last updated” date above.",
      },
    ],
  },
  {
    heading: "12. Contact",
    blocks: [
      {
        kind: "p",
        text: "For privacy questions or requests, contact us at legal@jmango360.dev.",
      },
    ],
  },
];

const PrivacyPage = () => (
  <LegalLayout
    title="Privacy Policy"
    lastUpdated="21 May 2026"
    intro="This policy explains what information Better Update collects, how we use it, and the choices you have."
    sections={SECTIONS}
  />
);

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy Policy · Better Update" }] }),
  component: PrivacyPage,
});
