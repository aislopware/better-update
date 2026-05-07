export interface InviteEmailInput {
  readonly inviterName: string;
  readonly organizationName: string;
  readonly recipientEmail: string;
  readonly role: string;
  readonly acceptUrl: string;
}

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const escapeHtml = (input: string): string =>
  input.replaceAll(/[&<>"']/gu, (char) => HTML_ESCAPES[char] ?? char);

export const renderInviteEmail = (input: InviteEmailInput): RenderedEmail => {
  const inviter = escapeHtml(input.inviterName);
  const organization = escapeHtml(input.organizationName);
  const role = escapeHtml(input.role);
  const acceptUrl = escapeHtml(input.acceptUrl);

  const subject = `You're invited to join ${input.organizationName} on Better Update`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f7f9;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
<tr><td style="padding:32px 32px 8px 32px;">
<p style="margin:0;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Better Update</p>
<h1 style="margin:12px 0 0 0;font-size:22px;line-height:1.3;font-weight:600;color:#0f172a;">You're invited to ${organization}</h1>
</td></tr>
<tr><td style="padding:16px 32px 8px 32px;font-size:15px;line-height:1.6;color:#334155;">
<p style="margin:0 0 12px 0;"><strong>${inviter}</strong> invited you to join <strong>${organization}</strong> as <strong>${role}</strong>.</p>
<p style="margin:0;">Click the button below to accept the invitation and start collaborating.</p>
</td></tr>
<tr><td style="padding:24px 32px 8px 32px;">
<a href="${acceptUrl}" style="display:inline-block;background-color:#0f172a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:500;padding:12px 24px;border-radius:8px;">Accept invitation</a>
</td></tr>
<tr><td style="padding:8px 32px 32px 32px;font-size:13px;line-height:1.6;color:#64748b;">
<p style="margin:0 0 12px 0;">Or paste this link into your browser:</p>
<p style="margin:0;word-break:break-all;"><a href="${acceptUrl}" style="color:#0f172a;">${acceptUrl}</a></p>
</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #e2e8f0;background-color:#f8fafc;font-size:12px;line-height:1.6;color:#94a3b8;">
<p style="margin:0;">If you weren't expecting this invitation, you can safely ignore this email.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    `${input.inviterName} invited you to join ${input.organizationName} as ${input.role}.`,
    "",
    "Accept the invitation:",
    input.acceptUrl,
    "",
    "If you weren't expecting this invitation, you can safely ignore this email.",
  ].join("\n");

  return { subject, html, text };
};
