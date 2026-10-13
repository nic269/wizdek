import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

const baseStyles = {
  body: {
    backgroundColor: "#f7f7f8",
    color: "#18181b",
    fontFamily: "Arial, sans-serif",
    margin: "0",
    padding: "32px 16px",
  },
  button: {
    backgroundColor: "#18181b",
    borderRadius: "6px",
    color: "#ffffff",
    display: "inline-block",
    fontSize: "14px",
    fontWeight: "600",
    padding: "12px 18px",
    textDecoration: "none",
  },
  container: {
    backgroundColor: "#ffffff",
    border: "1px solid #e4e4e7",
    borderRadius: "8px",
    margin: "0 auto",
    maxWidth: "560px",
    padding: "32px",
  },
  muted: {
    color: "#71717a",
    fontSize: "13px",
    lineHeight: "20px",
  },
} as const;

export const InviteUserEmail = ({
  inviterName,
  organizationName,
  inviteUrl,
}: {
  inviterName: string;
  organizationName: string;
  inviteUrl: string;
}) => (
  <Html>
    <Head />
    <Preview>You have been invited to {organizationName}</Preview>
    <Body style={baseStyles.body}>
      <Container style={baseStyles.container}>
        <Heading>Join {organizationName}</Heading>
        <Text>{inviterName} invited you to collaborate.</Text>
        <Section>
          <Button href={inviteUrl} style={baseStyles.button}>
            Accept invitation
          </Button>
        </Section>
        <Text style={baseStyles.muted}>
          If the button does not work, open this link in your browser:{" "}
          <Link href={inviteUrl}>{inviteUrl}</Link>
        </Text>
      </Container>
    </Body>
  </Html>
);

export const PasswordResetEmail = ({
  appName,
  resetUrl,
}: {
  appName: string;
  resetUrl: string;
}) => (
  <Html>
    <Head />
    <Preview>Reset your {appName} password</Preview>
    <Body style={baseStyles.body}>
      <Container style={baseStyles.container}>
        <Heading>Reset your password</Heading>
        <Text>
          Use this link to choose a new password for your {appName} account.
        </Text>
        <Section>
          <Button href={resetUrl} style={baseStyles.button}>
            Reset password
          </Button>
        </Section>
        <Text style={baseStyles.muted}>
          If you did not request this, you can ignore this email. Link:{" "}
          <Link href={resetUrl}>{resetUrl}</Link>
        </Text>
      </Container>
    </Body>
  </Html>
);

export const VerificationEmail = ({
  appName,
  verifyUrl,
}: {
  appName: string;
  verifyUrl: string;
}) => (
  <Html>
    <Head />
    <Preview>Verify your {appName} email</Preview>
    <Body style={baseStyles.body}>
      <Container style={baseStyles.container}>
        <Heading>Verify your email</Heading>
        <Text>
          Confirm this email address to finish setting up your {appName}{" "}
          account.
        </Text>
        <Section>
          <Button href={verifyUrl} style={baseStyles.button}>
            Verify email
          </Button>
        </Section>
        <Text style={baseStyles.muted}>
          If the button does not work, open this link in your browser:{" "}
          <Link href={verifyUrl}>{verifyUrl}</Link>
        </Text>
      </Container>
    </Body>
  </Html>
);
