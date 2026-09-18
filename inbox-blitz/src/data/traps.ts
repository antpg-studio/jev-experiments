/**
 * Hand-written emails designed to defeat keyword/regex triage. Each carries a
 * `trap` note explaining which rule it breaks, shown in the disagreement view.
 */
export interface TrapEmail {
  from: string;
  fromEmail: string;
  subject: string;
  body: string;
  trap: string;
}

export const TRAPS: TrapEmail[] = [
  {
    from: "Priya Raman",
    fromEmail: "priya.raman@corvid-logistics.com",
    subject: "not urgent at all",
    body: "Hey team,\n\nNot urgent at all, take your time... just kidding. Prod is down for all of our warehouses since 09:40 and the API returns 502 on every request. Drivers can't scan anything.\n\nPlease call me. +1 (415) 555-0142.\n\nPriya",
    trap: "Sarcastic 'not urgent' → keyword rules say low urgency; the situation is a full outage.",
  },
  {
    from: "Northwind Product Updates",
    fromEmail: "updates@news.northwind.cloud",
    subject: "New: automated refund workflows, plus 3 more September features",
    body: "September product update\n\n• Automated refund workflows: issue a refund from the order view in one click.\n• Cancel-anytime toggles for subscription plans.\n• Faster invoice PDF generation.\n• New security dashboard.\n\nYou are receiving this because you opted in to product news. Manage preferences | Unsubscribe",
    trap: "Newsletter mentions 'refund' and 'cancel' as feature names → rules flag refund + churn; nobody is asking for anything.",
  },
  {
    from: "Marcus Bell",
    fromEmail: "mbell@harlow-dental.com",
    subject: "Great job guys",
    body: "Great job guys. Really love paying twice for the same month. Truly a wonderful experience, five stars. 🙃\n\nInvoice #INV-20933 and #INV-20941 are both for September. Please sort it out.\n\nMarcus",
    trap: "Sarcasm: 'great job', 'love', 'wonderful' → rules read it as friendly; the sender is clearly frustrated about a double charge.",
  },
  {
    from: "Elena Vogt",
    fromEmail: "e.vogt@brightpath.io",
    subject: "Question about my invoice (I'm NOT cancelling!)",
    body: "Hi,\n\nTo be clear up front: I am not cancelling and I don't want to cancel anything. I just want to understand why the September invoice shows 14 seats when we have 12 users.\n\nThanks,\nElena",
    trap: "Contains 'cancel' three times while explicitly saying she is not cancelling → rules flag churn.",
  },
  {
    from: "Grant @ SecureScore",
    fromEmail: "grant@securescore-outreach.com",
    subject: "URGENT: your security score dropped this week",
    body: "Hi there,\n\nOur scanner noticed your domain's security score dropped 4 points this week. Companies like yours lose an average of $4.2M per breach!\n\nBook a 15-minute call this week and I'll send over a free report. Limited slots available.\n\nGrant Ellis\nSecureScore | Enterprise Security Ratings",
    trap: "'URGENT' + 'security' + 'breach' → rules classify as urgent security; it is cold sales outreach.",
  },
  {
    from: "Dana Whitfield",
    fromEmail: "dana.whitfield.ceo@gmail.com",
    subject: "quick favor",
    body: "Are you at your desk? I'm in a board meeting and can't talk. Need you to handle something for me quickly and discreetly. Reply as soon as you see this.\n\nSent from my iPhone",
    trap: "Classic CEO-impersonation gift-card scam with zero phishing keywords (no link, no 'password', no 'verify').",
  },
  {
    from: "Tom Okafor",
    fromEmail: "tom.okafor@meridian-hr.com",
    subject: "Password reset link goes to a blank page",
    body: "Hi support,\n\nWhen I click the password reset link in the email you send, I land on a blank page. Tried Chrome and Safari. Can you verify the link is working on your end and update the account settings? Happy to send a screenshot.\n\nTom",
    trap: "'password', 'link', 'verify', 'account' → rules flag phishing; it is a legitimate bug report.",
  },
  {
    from: "Sofia Lindqvist",
    fromEmail: "sofia@kettlebrook.se",
    subject: "small thing whenever you have a moment",
    body: "Hello,\n\nWhenever you have a moment: since this morning every export we run comes back empty, and the nightly sync appears to have deleted last week's records for all of our users. We're a hospital scheduling team so we're working from paper right now.\n\nNo rush if you're busy.\n\nSofia",
    trap: "Polite understatement ('whenever you have a moment', 'no rush') hides data loss in a hospital → rules say low urgency.",
  },
  {
    from: "FlashDeals",
    fromEmail: "promo@flashdeals-mail.net",
    subject: "ASAP: 70% off ends at midnight!!!",
    body: "Act ASAP! Only hours left to grab 70% off our entire catalog. This is CRITICAL savings you can't miss!!!\n\nShop now → https://flashdeals-mail.net/sale\n\nUnsubscribe",
    trap: "'ASAP', 'CRITICAL', exclamation marks → rules score maximum urgency and 'furious' sentiment; it is marketing noise.",
  },
  {
    from: "Rebecca Chao",
    fromEmail: "rchao@atlas-freight.com",
    subject: "Evaluating options for Q1",
    body: "Hello,\n\nWe're a 400-person freight company and we're evaluating options for Q1. Your Enterprise tier came up in a few conversations. Who would be the right person to walk us through it and talk numbers? Ideally next week.\n\nRebecca Chao\nVP Operations, Atlas Freight",
    trap: "A strong sales lead with none of the words 'pricing', 'quote', 'demo', 'buy' → rules fall through to 'other'.",
  },
  {
    from: "Jonas Petersen",
    fromEmail: "jonas@nordicroast.dk",
    subject: "It's broken that I can't export to CSV",
    body: "Honestly it's broken that there's still no CSV export from the reports page. Every competitor has this. Please add it so we can stop copy-pasting into spreadsheets.\n\nJonas",
    trap: "'broken' → rules classify as a bug; the sender is asking for functionality that does not exist (feature request).",
  },
  {
    from: "Amira Haddad",
    fromEmail: "amira.haddad@lumenworks.co",
    subject: "Re: Duplicate charge on order 88213",
    body: "Perfect, thank you so much — I see the credit on my statement now. You can close this one.\n\nAmira\n\n> On Tue, Sep 15, support@northwind.cloud wrote:\n> Hi Amira, I've issued a refund for the duplicate charge on order 88213. It should appear within 3-5 business days.\n>\n>> Hi, I was charged twice for order 88213 and I'd like a refund of the second charge please.",
    trap: "'refund' appears only in quoted history → rules flag refund + needs reply; the thread is resolved and needs no reply.",
  },
  {
    from: "Derek Malone",
    fromEmail: "dmalone@pinecrest-builders.com",
    subject: "Numbers don't match",
    body: "The amount on my card statement this month is $412.80 but the dashboard says my plan is $349. What's the difference for? Nobody told me about any change.\n\nDerek",
    trap: "A billing dispute with no 'invoice', 'charge', 'billing' or 'refund' keyword → rules say 'other'.",
  },
  {
    from: "Lukas Brandt",
    fromEmail: "lukas.brandt@posteo.de",
    subject: "wipe my stuff",
    body: "Hi, can you wipe everything you have on me? Account, emails, the lot. I'm in Germany and I believe I have the right to ask for this. Please confirm when it's done.\n\nLukas",
    trap: "A GDPR erasure request without 'GDPR', 'delete my data' or 'privacy' → rules miss legal_privacy.",
  },
  {
    from: "Helen Ashworth",
    fromEmail: "h.ashworth@ashworth-partners.co.uk",
    subject: "Re: Re: Re: Ticket 44120",
    body: "I have now explained this four times to four different people. I will not be explaining it a fifth time. I expect a resolution and a named owner by end of day, or my next email goes to your CEO and our legal counsel.\n\nHelen Ashworth",
    trap: "Icy fury with no caps, no swearing, no exclamation marks → rules score sentiment as neutral.",
  },
  {
    from: "Nate Ruiz",
    fromEmail: "nate@fernhill-studio.com",
    subject: "Heads up on next month",
    body: "Just a heads up: we've signed with Ledgerly starting October 1st, so we'll be moving our data over during the last week of September. Can someone send instructions for a full export?\n\nNate",
    trap: "Sender is switching to a competitor but never writes 'cancel', 'churn' or 'leaving' → rules miss churn.",
  },
  {
    from: "DocuSign",
    fromEmail: "noreply@docusign-esign-notice.com",
    subject: "Completed: Please review and sign your document",
    body: "A document has been shared with you for signature.\n\nDocument: Vendor_Agreement_Q3.pdf\nSender: Accounts Payable\n\nREVIEW DOCUMENT: https://docusign-esign-notice.com/view/8213\n\nThis is an automated message from DocuSign. Do not reply.",
    trap: "Polite lookalike-domain phishing with no 'urgent'/'password'/'verify' → rules classify as 'other'.",
  },
  {
    from: "Casey Nguyen",
    fromEmail: "casey@sunnybrook-bakery.com",
    subject: "THANK YOU!!!",
    body: "THANK YOU SO MUCH!!! YOU GUYS ROCK!!! The migration went PERFECTLY and my whole team is thrilled. Seriously, BEST support team I have ever dealt with!!!\n\nCasey",
    trap: "All caps and triple exclamation marks → rules score 'furious'; the sender is delighted.",
  },
  {
    from: "Workplace Weekly",
    fromEmail: "digest@workplaceweekly-news.com",
    subject: "Emergency preparedness: 7 critical steps every office needs",
    body: "This week in Workplace Weekly\n\n• Emergency preparedness: 7 critical steps every office needs\n• How to run an urgent all-hands without the panic\n• Case study: a security breach that wasn't\n\nRead online | Unsubscribe",
    trap: "'Emergency', 'critical', 'urgent', 'breach' in a newsletter → rules score it as urgent security.",
  },
  {
    from: "Ibrahim Diallo",
    fromEmail: "ibrahim@westbay-clinic.org",
    subject: "Re: Login loop on iPad",
    body: "No worries, clearing the cache fixed it. You can close this.\n\nIbrahim\n\n> Hi Ibrahim, could you try clearing Safari's cache and let us know if the login loop persists?",
    trap: "Customer closing the loop → rules treat every customer email as needing a reply.",
  },
];
