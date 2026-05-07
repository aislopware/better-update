import { renderInviteEmail } from "./invite";

describe(renderInviteEmail, () => {
  const baseInput = {
    inviterName: "Alice Cooper",
    organizationName: "Acme Inc",
    recipientEmail: "bob@example.com",
    role: "admin",
    acceptUrl: "https://better-update.dev/accept-invitation?id=inv_123",
  };

  it("subject contains organization name", () => {
    const rendered = renderInviteEmail(baseInput);
    expect(rendered.subject).toContain("Acme Inc");
  });

  it("html contains accept URL, inviter, organization, and role", () => {
    const rendered = renderInviteEmail(baseInput);
    expect(rendered.html).toContain(baseInput.acceptUrl);
    expect(rendered.html).toContain("Alice Cooper");
    expect(rendered.html).toContain("Acme Inc");
    expect(rendered.html).toContain("admin");
  });

  it("text fallback contains accept URL and inviter", () => {
    const rendered = renderInviteEmail(baseInput);
    expect(rendered.text).toContain(baseInput.acceptUrl);
    expect(rendered.text).toContain("Alice Cooper");
    expect(rendered.text).toContain("Acme Inc");
  });

  it("escapes HTML in inviter name and organization name", () => {
    const rendered = renderInviteEmail({
      ...baseInput,
      inviterName: '<script>alert("xss")</script>',
      organizationName: "Acme & Co",
    });
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.html).toContain("Acme &amp; Co");
  });

  it("text fallback does not HTML-escape (renders as plain text)", () => {
    const rendered = renderInviteEmail({
      ...baseInput,
      organizationName: "Acme & Co",
    });
    expect(rendered.text).toContain("Acme & Co");
  });
});
