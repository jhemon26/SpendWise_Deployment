/**
 * Privacy notice.
 *
 * DRAFTED FROM THE CODE, NOT FROM A TEMPLATE — every claim below was checked
 * against what the app actually does.
 *
 * Deliberately describes WHAT is done, never HOW. Naming the hosting vendor or
 * the mechanism behind a control tells an attacker where to start and tells a
 * user nothing they benefit from. What cannot be removed is the disclosure GDPR
 * requires: the data, the purposes, the lawful bases, the categories of
 * recipient, retention and rights. Cutting those to look secure would trade a
 * theoretical risk for a certain legal one. It still needs review by someone
 * qualified before launch: this describes the processing accurately, but
 * whether the wording satisfies UK GDPR is a legal judgement, not an
 * engineering one. The controller's legal name and address are placeholders
 * and must be filled in; a notice without an identifiable controller is
 * non-compliant on its face.
 *
 * There is deliberately no "where it is stored" section. That is only safe
 * while processing stays in the UK: the moment data is hosted or accessed
 * outside the UK/EEA, Article 13(1)(f) makes disclosing the transfer and its
 * safeguard mandatory, and this section has to come back. Hosting region is
 * currently lon1 (London).
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
      'Technical: an identifier for each device you use, so your data can sync between them, and limited security records such as the time and network address of a sign-in.',
      'We do not connect to your bank, and we do not collect location, contacts, or browsing activity.',
    ],
  },
  {
    heading: 'Why we use it, and on what basis',
    body: [
      'To provide the app — storing and syncing your budget and transactions across your devices. Lawful basis: performance of our contract with you.',
      'To sign you in and to detect and prevent abuse of the service. Lawful basis: our legitimate interest in keeping accounts secure.',
      'To send a one-time code by SMS when you choose to sign in by phone. Lawful basis: performance of our contract with you.',
      'We do not use your data for advertising, we do not sell it, and we do not use it to make automated decisions about you.',
    ],
  },
  {
    heading: 'Who else sees it',
    body: [
      'Google or Apple, if you choose to sign in with them — they confirm your identity to us. Their own privacy policies apply to that.',
      'Our cloud hosting provider and, when SMS sign-in is enabled, a messaging provider. They act only on our instructions and cannot use your data for their own purposes.',
      'Nobody else. We do not share or sell your data.',
    ],
  },
  {
    heading: 'How long we keep it',
    body: [
      'For as long as your account exists. Delete your account in Profile and your transactions, categories, cards and settings are removed immediately and permanently.',
      'Limited security records are kept after deletion to prevent fraud, with anything identifying you removed.',
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
    heading: 'Cookies',
    body: [
      // PECR requires telling people what is stored on their device and why.
      // Strictly necessary storage needs no consent, but it still has to be
      // disclosed, so this cannot be dropped — only kept to the minimum.
      'We use only the storage the app needs to run and to keep you signed in. No advertising or analytics cookies, and no tracking across other sites.',
    ],
  },
  {
    heading: 'Changes',
    body: [
      `This notice was last updated on ${POLICY_VERSION}. If we change it materially we will ask you to review it again.`,
    ],
  },
];
