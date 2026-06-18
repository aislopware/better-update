import { createFileRoute } from "@tanstack/react-router";

import { LegalLayout } from "../components/legal-layout";

import type { LegalSectionData } from "../components/legal-layout";

const SECTIONS: readonly LegalSectionData[] = [
  {
    heading: "1. Agreement to these terms",
    blocks: [
      {
        kind: "p",
        text: "Better Update (the “Service”) is operated by Trần Văn Công, an individual based in Vietnam (“Better Update”, “we”, “us”). By accessing or using the Service, you agree to be bound by these Terms of Service (the “Terms”). If you do not agree, do not use the Service.",
      },
      {
        kind: "p",
        text: "If you use the Service on behalf of an organization, you represent that you are authorized to bind that organization to these Terms, and “you” refers to that organization.",
      },
    ],
  },
  {
    heading: "2. The Service",
    blocks: [
      {
        kind: "p",
        text: "Better Update is a platform for deploying, monitoring, and rolling back over-the-air (OTA) updates for React Native applications, managing build artifacts and signing credentials, and collaborating within organizations.",
      },
      {
        kind: "p",
        text: "We may add, change, suspend, or discontinue any part of the Service at any time. The Service is under active development and is provided on an “as is” and “as available” basis.",
      },
    ],
  },
  {
    heading: "3. Your account",
    blocks: [
      {
        kind: "p",
        text: "You sign in through a third-party identity provider (currently GitHub). You are responsible for the security of your account and for all activity that occurs under it.",
      },
      {
        kind: "p",
        text: "You must be at least the age of majority in your jurisdiction and able to form a binding contract. Notify us at legal@jmango360.dev if you suspect any unauthorized use of your account.",
      },
    ],
  },
  {
    heading: "4. Organizations and members",
    blocks: [
      {
        kind: "p",
        text: "The Service supports organizations with multiple members and role-based access (owner, admin, developer, and viewer). The organization owner is responsible for managing members, assigning roles, and controlling access to organization data.",
      },
      {
        kind: "p",
        text: "You are responsible for the activity of members you invite and for ensuring they comply with these Terms.",
      },
    ],
  },
  {
    heading: "5. Your content",
    blocks: [
      {
        kind: "p",
        text: "“Your Content” means the update bundles, build artifacts, assets, configuration, metadata, and other materials you upload to the Service. You retain all rights in Your Content.",
      },
      {
        kind: "p",
        text: "You grant us a limited, worldwide, non-exclusive license to host, store, process, transmit, and display Your Content solely to operate the Service and deliver it to your devices and end users. You are responsible for having all rights necessary to upload and distribute Your Content.",
      },
    ],
  },
  {
    heading: "6. Your secrets and source code",
    blocks: [
      {
        kind: "p",
        text: "Signing keys, store credentials, and other secrets you choose to store are encrypted on your device before upload, using keys we never receive. We cannot read, recover, or reset these secrets. If you lose your encryption keys, the data cannot be recovered, and you are solely responsible for safeguarding them.",
      },
      {
        kind: "p",
        text: "Your original source code is never uploaded to the Service. OTA updates consist of your compiled JavaScript bundle (Hermes bytecode) together with bundled assets. We store these artifacts in order to deliver them to your devices; unlike your secrets, they are not end-to-end encrypted, and we may access them as needed to operate the Service. See our Privacy Policy for details.",
      },
    ],
  },
  {
    heading: "7. Acceptable use",
    blocks: [
      { kind: "p", text: "You agree not to use the Service to:" },
      {
        kind: "list",
        items: [
          "upload or distribute unlawful, infringing, deceptive, or malicious content, including malware;",
          "distribute updates that violate applicable law or the policies of any app store or platform;",
          "interfere with, disrupt, or place undue load on the Service or its infrastructure;",
          "attempt to gain unauthorized access to any system, account, or data;",
          "reverse engineer the Service except to the extent permitted by applicable law;",
          "use the Service in violation of any applicable export-control, sanctions, or trade laws.",
        ],
      },
      {
        kind: "p",
        text: "We may remove content or suspend or terminate accounts that violate these Terms.",
      },
    ],
  },
  {
    heading: "8. Third-party services",
    blocks: [
      {
        kind: "p",
        text: "The Service integrates with third parties, including GitHub for authentication, Apple and Google for app distribution, and Cloudflare for hosting and content delivery. Your use of those services is governed by their own terms, and we are not responsible for them.",
      },
    ],
  },
  {
    heading: "9. Plans and fees",
    blocks: [
      {
        kind: "p",
        text: "The Service is currently provided free of charge. We may introduce paid plans in the future; if we do, we will clearly disclose any applicable fees, and obtain any required consent, before they apply to you.",
      },
    ],
  },
  {
    heading: "10. Disclaimers",
    blocks: [
      {
        kind: "p",
        text: "To the maximum extent permitted by law, the Service is provided without warranties of any kind, whether express, implied, or statutory, including warranties of merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the Service will be uninterrupted, error-free, or secure, or that updates will be delivered without delay or failure.",
      },
    ],
  },
  {
    heading: "11. Limitation of liability",
    blocks: [
      {
        kind: "p",
        text: "To the maximum extent permitted by law, Better Update will not be liable for any indirect, incidental, special, consequential, or punitive damages, or for any loss of profits, data, or goodwill, arising out of or related to your use of the Service.",
      },
      {
        kind: "p",
        text: "Our total aggregate liability for any claim arising out of or related to the Service will not exceed the greater of the amount you paid us in the twelve months before the claim or USD 100.",
      },
    ],
  },
  {
    heading: "12. Indemnification",
    blocks: [
      {
        kind: "p",
        text: "You agree to indemnify and hold harmless Better Update and its personnel from any claim or demand arising out of Your Content, your use of the Service, or your breach of these Terms.",
      },
    ],
  },
  {
    heading: "13. Termination",
    blocks: [
      {
        kind: "p",
        text: "You may stop using the Service at any time. We may suspend or terminate your access if you breach these Terms or as required to comply with law. On termination, your right to use the Service ends; sections that by their nature should survive will survive.",
      },
    ],
  },
  {
    heading: "14. Changes to these terms",
    blocks: [
      {
        kind: "p",
        text: "We may update these Terms from time to time. We will notify you of material changes through the Service or by email. Your continued use of the Service after changes take effect constitutes acceptance of the updated Terms.",
      },
    ],
  },
  {
    heading: "15. Governing law",
    blocks: [
      {
        kind: "p",
        text: "These Terms are governed by the laws of Vietnam, without regard to its conflict-of-laws rules. You agree to submit to the exclusive jurisdiction of the competent courts of Vietnam for any dispute arising out of or relating to these Terms or the Service.",
      },
      {
        kind: "p",
        text: "The Service is available to users worldwide. If you use the Service as a consumer, nothing in these Terms deprives you of the mandatory consumer protections of your country of residence.",
      },
    ],
  },
  {
    heading: "16. Contact",
    blocks: [
      {
        kind: "p",
        text: "Questions about these Terms can be sent to legal@jmango360.dev.",
      },
    ],
  },
];

const TermsPage = () => (
  <LegalLayout
    title="Terms of Service"
    lastUpdated="21 May 2026"
    intro="These terms govern your access to and use of Better Update. Please read them carefully."
    sections={SECTIONS}
  />
);

export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: "Terms of Service · Better Update" }] }),
  component: TermsPage,
});
