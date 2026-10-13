import { describe, expect, it } from "vitest";
import { createInvitationMail } from "./invitation";
import { InviteUserEmail } from "./templates";

const LINE_BREAK_PATTERN = /[\r\n]/;

describe("invitation mail", () => {
  it("uses the shared template and keeps a complete text fallback", () => {
    const message = createInvitationMail({
      inviterName: "Ada Lovelace",
      inviteUrl: "https://app.example.com/invite/secret",
      organizationName: "Analytical Engines",
      to: "member@example.com",
    });

    expect(message).toMatchObject({
      subject: "Join Analytical Engines",
      text: "Ada Lovelace invited you to join Analytical Engines. Accept your invitation: https://app.example.com/invite/secret",
      to: "member@example.com",
    });
    expect(message.react).toMatchObject({
      props: {
        inviterName: "Ada Lovelace",
        inviteUrl: "https://app.example.com/invite/secret",
        organizationName: "Analytical Engines",
      },
      type: InviteUserEmail,
    });
  });

  it("removes line breaks from the user-controlled mail subject", () => {
    const message = createInvitationMail({
      inviterName: "Ada Lovelace",
      inviteUrl: "https://app.example.com/invite/secret",
      organizationName: "Analytical Engines\r\nBcc: attacker@example.com",
      to: "member@example.com",
    });

    expect(message.subject).toBe(
      "Join Analytical Engines Bcc: attacker@example.com"
    );
    expect(message.subject).not.toMatch(LINE_BREAK_PATTERN);
    expect(message.react).toMatchObject({
      props: {
        organizationName: "Analytical Engines\r\nBcc: attacker@example.com",
      },
    });
  });
});
