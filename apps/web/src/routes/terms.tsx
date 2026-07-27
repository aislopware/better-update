import { createFileRoute } from "@tanstack/react-router";

import { LegalLayout } from "../components/legal-layout";
import { SITE } from "../lib/site-config";

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
        text: "The Service is provided free of charge, with no paid plans, usage fees, or billing of any kind. It is offered as a public good rather than a commercial product, and nothing in these Terms creates a paid subscription or entitles us to charge you.",
      },
      {
        kind: "p",
        text: "We may add, change, suspend, or discontinue any part of the Service at any time. The Service is under active development and is provided on an “as is” and “as available” basis.",
      },
    ],
  },
  {
    heading: "3. Open source and self-hosting",
    blocks: [
      {
        kind: "p",
        text: "Better Update is open-source software released under the MIT License. The MIT License governs your use of the source code, including the rights to use, copy, modify, and redistribute it; these Terms govern only your use of this hosted instance.",
      },
      {
        kind: "p",
        text: "You are free to run your own instance on your own infrastructure at any time, for any purpose, without our permission and without any fee. If you do, these Terms do not apply to that instance — you become its operator and are responsible for it.",
      },
    ],
  },
  {
    heading: "4. Your account",
    blocks: [
      {
        kind: "p",
        text: "You sign in through a third-party identity provider (currently GitHub). You are responsible for the security of your account and for all activity that occurs under it.",
      },
      {
        kind: "p",
        text: `You must be at least the age of majority in your jurisdiction and able to form a binding contract. Notify us at ${SITE.legalEmail} if you suspect any unauthorized use of your account.`,
      },
    ],
  },
  {
    heading: "5. Organizations and members",
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
    heading: "6. Your content",
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
    heading: "7. Your secrets and source code",
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
    heading: "8. Acceptable use",
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
    heading: "9. Third-party services",
    blocks: [
      {
        kind: "p",
        text: "The Service integrates with third parties, including GitHub for authentication, Apple and Google for app distribution, and Cloudflare for hosting and content delivery. Your use of those services is governed by their own terms, and we are not responsible for them.",
      },
    ],
  },
  {
    heading: "10. No fees",
    blocks: [
      {
        kind: "p",
        text: "The Service is free. There are no paid plans, no usage-based charges, no trials that convert into a subscription, and no billing relationship between us. We do not collect payment details and we will never ask you for them.",
      },
      {
        kind: "p",
        text: "We have no plans to charge for the Service. If that ever changed, we would not apply fees to your existing use without clear advance notice and your explicit consent — and the source code would remain available under the MIT License, so you could always run your own instance instead.",
      },
    ],
  },
  {
    heading: "11. Disclaimers",
    blocks: [
      {
        kind: "p",
        text: "To the maximum extent permitted by law, the Service is provided without warranties of any kind, whether express, implied, or statutory, including warranties of merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the Service will be uninterrupted, error-free, or secure, or that updates will be delivered without delay or failure. The Service is offered free of charge, and these disclaimers reflect that: it is not a commercial product and carries no service-level commitment.",
      },
    ],
  },
  {
    heading: "12. Limitation of liability",
    blocks: [
      {
        kind: "p",
        text: "To the maximum extent permitted by law, Better Update will not be liable for any indirect, incidental, special, consequential, or punitive damages, or for any loss of profits, data, or goodwill, arising out of or related to your use of the Service.",
      },
      {
        kind: "p",
        text: "Because the Service is provided free of charge, our total aggregate liability for any claim arising out of or related to the Service will not exceed USD 100. Nothing in these Terms limits liability that cannot be limited under applicable law, such as liability for fraud, willful misconduct, or death or personal injury caused by negligence.",
      },
    ],
  },
  {
    heading: "13. Indemnification",
    blocks: [
      {
        kind: "p",
        text: "You agree to indemnify and hold harmless Better Update and its personnel from any claim or demand arising out of Your Content, your use of the Service, or your breach of these Terms.",
      },
    ],
  },
  {
    heading: "14. Termination",
    blocks: [
      {
        kind: "p",
        text: "You may stop using the Service at any time. We may suspend or terminate your access if you breach these Terms or as required to comply with law. On termination, your right to use the Service ends; sections that by their nature should survive will survive.",
      },
    ],
  },
  {
    heading: "15. Changes to these terms",
    blocks: [
      {
        kind: "p",
        text: "We may update these Terms from time to time. We will notify you of material changes through the Service or by email. Your continued use of the Service after changes take effect constitutes acceptance of the updated Terms.",
      },
    ],
  },
  {
    heading: "16. Governing law",
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
    heading: "17. Contact",
    blocks: [
      {
        kind: "p",
        text: `Questions about these Terms can be sent to ${SITE.legalEmail}.`,
      },
    ],
  },
];

const TermsPage = () => (
  <LegalLayout
    title="Terms of Service"
    lastUpdated="27 July 2026"
    intro="These terms govern your access to and use of Better Update — a free, MIT-licensed service with no paid plans. Please read them carefully."
    sections={SECTIONS}
  />
);

export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: "Terms of Service · Better Update" }] }),
  component: TermsPage,
});
