/**
 * Privacy notice.
 *
 * DRAFTED FROM THE CODE, NOT FROM A TEMPLATE — every claim below was checked
 * against what the app actually does. It still needs review by someone
 * qualified before launch: this describes the processing accurately, but
 * whether the wording satisfies UK GDPR is a legal judgement, not an
 * engineering one. The controller's legal name and address are placeholders
 * and must be filled in; a notice without an identifiable controller is
 * non-compliant on its face.
 *
 * Bump POLICY_VERSION whenever the substance changes. Consent is recorded
 * against the version, so a material change can require re-acceptance instead
 * of silently relying on agreement to an older text.
 */

export const POLICY_VERSION = '2026-08-10';

export interface PolicySection {
  heading: string;
  body: string[];
}

export const PRIVACY_SECTIONS: PolicySection[] = [
  {
    heading: 'Who is responsible',
    body: [
      'SpendWise (“we”) is the data controller for the information described here. Contact: privacy@spendwise.uk.',
      'If you are not satisfied with how we handle your data you can complain to the Information Commissioner’s Office (ico.org.uk), the UK supervisory authority.',
    ],
  },
  {
    heading: 'What we collect',
    body: [
      'Account: the phone number you verify, or the account identifier and email address supplied by Google or Apple if you sign in that way. We never receive your Google or Apple password.',
      'Your budget: the display name, monthly income, budgets, savings target, categories, cards and avatar you enter.',
      'Your transactions: amount, currency, date, category, card, and — if you add them — the merchant name and any note.',
      'Technical: a device identifier so your devices can sync, and the IP address and time of security-relevant events such as sign-in.',
      'We do not connect to your bank, and we do not collect location, contacts, or browsing activity.',
    ],
  },
  {
    heading: 'Why we use it, and on what basis',
    body: [
      'To provide the app — storing and syncing your budget and transactions across your devices. Lawful basis: performance of our contract with you.',
      'To sign you in and keep your account secure, including rate limiting and keeping a record of sign-in events. Lawful basis: our legitimate interest in preventing unauthorised access and abuse.',
      'To send a one-time code by SMS when you choose to sign in by phone. Lawful basis: performance of our contract with you.',
      'We do not use your data for advertising, we do not sell it, and we do not use it to make automated decisions about you.',
    ],
  },
  {
    heading: 'Where it is stored',
    body: [
      'Your data is stored on your device first, so the app works offline, and synced to our servers hosted with DigitalOcean.',
      'Merchant names and notes are encrypted before they are written to our database.',
      'Each account’s data is isolated at the database level, so one account cannot read another’s.',
    ],
  },
  {
    heading: 'Who else sees it',
    body: [
      'Google or Apple, if you choose to sign in with them — they confirm your identity to us. Their own privacy policies apply to that.',
      'Our hosting provider (DigitalOcean) and, when SMS sign-in is enabled, an SMS provider. They process data on our instructions only.',
      'Nobody else. We do not share or sell your data.',
    ],
  },
  {
    heading: 'How long we keep it',
    body: [
      'For as long as your account exists. Delete your account in Profile and your transactions, categories, cards and settings are removed immediately and permanently.',
      'Security records of sign-in events are kept after deletion for fraud prevention, but stripped of anything identifying you.',
    ],
  },
  {
    heading: 'Your rights',
    body: [
      'You can ask for a copy of your data, correct it, delete it, restrict or object to how we use it, or ask for it in a portable form.',
      'Deletion is built in: Profile → Delete account removes everything, and there is no soft delete or recovery period.',
      'For anything else, email privacy@spendwise.uk. We will respond within one month.',
    ],
  },
  {
    heading: 'Cookies and storage',
    body: [
      'We use browser storage to keep you signed in and to hold your data on your device. There are no advertising or analytics cookies.',
    ],
  },
  {
    heading: 'Changes',
    body: [
      `This notice was last updated on ${POLICY_VERSION}. If we change it materially we will ask you to review it again.`,
    ],
  },
];
