import { createElement } from "react";
import { type SendMailInput, sendMail } from "./send";
import { InviteUserEmail } from "./templates";

const HEADER_LINE_BREAK_PATTERN = /[\r\n]+/g;

const sanitizeMailSubjectValue = (value: string) =>
  value.replace(HEADER_LINE_BREAK_PATTERN, " ").trim();

export interface InvitationMailInput {
  inviterName: string;
  inviteUrl: string;
  organizationName: string;
  to: string;
}

export const createInvitationMail = (
  input: InvitationMailInput
): SendMailInput => ({
  react: createElement(InviteUserEmail, {
    inviterName: input.inviterName,
    inviteUrl: input.inviteUrl,
    organizationName: input.organizationName,
  }),
  subject: `Join ${sanitizeMailSubjectValue(input.organizationName)}`,
  text: `${input.inviterName} invited you to join ${input.organizationName}. Accept your invitation: ${input.inviteUrl}`,
  to: input.to,
});

export const sendInvitationMail = (input: InvitationMailInput) =>
  sendMail(createInvitationMail(input));
