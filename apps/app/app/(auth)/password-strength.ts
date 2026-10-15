/** The shortest password the auth server accepts. */
export const MIN_PASSWORD_LENGTH = 8;

const LETTER = /[a-z]/i;
const DIGIT = /\d/;
const MIXED_CASE = /(?=.*[a-z])(?=.*[A-Z])/;
const SYMBOL = /[^a-z\d]/i;

const LABELS = ["Too short", "Weak", "Fair", "Good", "Strong"] as const;

/**
 * A rough 0–4 score for the sign-up meter: one point each for reaching the
 * minimum length, reaching 12 characters, mixing letters and digits, and
 * using mixed case or a symbol. Below the minimum it is always 0.
 */
export const passwordStrength = (password: string) => {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { label: LABELS[0], score: 0 };
  }
  const score =
    1 +
    Number(password.length >= 12) +
    Number(LETTER.test(password) && DIGIT.test(password)) +
    Number(MIXED_CASE.test(password) || SYMBOL.test(password));
  return { label: LABELS[score] ?? LABELS[4], score };
};
