import { Link } from 'react-router-dom';

const SECTIONS = [
  {
    title: 'Acceptance of Terms',
    body: [
      'By accessing or using Endopamin, you agree to be bound by these Terms of Service and all applicable laws and regulations.',
      'If you do not agree to these terms, you may not use the app. Your continued use of Endopamin after any changes to these terms constitutes acceptance of the updated terms.',
    ],
  },
  {
    title: 'Description of Service',
    body: [
      'Endopamin is an AI-powered fitness coaching application that provides personalized workout guidance, nutrition insights, progress tracking, and coach chat features.',
      'Endopamin is designed for general fitness and wellness purposes only. It is not a medical device and does not provide medical advice, diagnosis, or treatment.',
      'AI-generated recommendations are informational in nature and may not be suitable for every individual or health condition.',
    ],
  },
  {
    title: 'User Accounts',
    body: [
      'You must create an account to use most features of Endopamin. You are responsible for maintaining the confidentiality of your login credentials and for all activity that occurs under your account.',
      'You agree to provide accurate, current, and complete information when creating your profile and to update it as needed.',
      'You must notify us promptly if you suspect unauthorized access to your account. We reserve the right to suspend or terminate accounts that violate these terms or pose a security risk.',
    ],
  },
  {
    title: 'Subscription & Payments',
    body: [
      'Endopamin offers a Pro subscription with the following pricing: $17.99 per month or $143.99 per year, billed through our payment provider at the start of each billing period.',
      'Subscriptions renew automatically unless canceled before the next billing date. You can manage or cancel your subscription through your account settings or your app store payment provider, as applicable.',
      'All charges are final once a billing period has started. We do not offer refunds after billing has occurred, except where required by applicable law.',
      'We may change subscription pricing with reasonable notice. Price changes apply to subsequent billing periods after notice is provided.',
    ],
  },
  {
    title: 'Free Tier Limitations',
    body: [
      'Endopamin offers a free tier with limited access to certain features. Free tier users are subject to the following daily limits:',
      'Up to 5 coach messages per day.',
      'Up to 2 nutrition scans per day.',
      'Free tier limits reset daily and may change at our discretion. Upgrading to Endopamin Pro removes these restrictions and unlocks additional features.',
    ],
  },
  {
    title: 'Health & Safety Disclaimer',
    body: [
      'Endopamin is not a substitute for professional medical advice, diagnosis, or treatment. Always consult a qualified physician or healthcare provider before starting any new exercise program, nutrition plan, or fitness routine.',
      'You use Endopamin at your own risk. Stop exercising and seek medical attention immediately if you experience pain, dizziness, shortness of breath, or any other concerning symptoms.',
      'If you have a medical condition, injury, pregnancy, or other health concern, you must obtain clearance from a healthcare professional before using the app.',
    ],
  },
  {
    title: 'Prohibited Uses',
    body: [
      'You agree not to misuse Endopamin. Prohibited conduct includes, but is not limited to:',
      'Attempting to reverse engineer, scrape, or exploit the app, its AI systems, or underlying infrastructure.',
      'Using the service for unlawful purposes or in violation of any applicable regulations.',
      'Sharing account credentials or reselling access to Endopamin without authorization.',
      'Submitting harmful, abusive, or misleading content through coach chat or other app features.',
      'Interfering with the security, performance, or availability of the service for other users.',
    ],
  },
  {
    title: 'Intellectual Property',
    body: [
      'Endopamin and its content — including software, design, branding, text, graphics, and AI-generated outputs provided through the app — are owned by Endopamin or its licensors and are protected by intellectual property laws.',
      'We grant you a limited, non-exclusive, non-transferable license to use the app for personal, non-commercial fitness purposes in accordance with these terms.',
      'You may not copy, modify, distribute, sell, or create derivative works from Endopamin without our prior written consent.',
    ],
  },
  {
    title: 'Termination',
    body: [
      'You may stop using Endopamin at any time. You may also delete your account from within the app.',
      'We may suspend or terminate your access to Endopamin at our discretion if you violate these terms, misuse the service, or if we discontinue the app or certain features.',
      'Upon termination, your right to use Endopamin ceases immediately. Provisions that by their nature should survive termination — including disclaimers, limitations of liability, and intellectual property rights — will remain in effect.',
    ],
  },
  {
    title: 'Changes to Terms',
    body: [
      'We may update these Terms of Service from time to time to reflect changes in our service, business practices, or legal requirements.',
      'When we make changes, we will update the effective date at the top of this page. Continued use of Endopamin after changes take effect means you accept the revised terms.',
    ],
  },
  {
    title: 'Contact',
    body: [
      'If you have questions about these Terms of Service, contact us at:',
      'info@endopamin.com',
    ],
  },
];

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#0A0A0A] px-5 pb-24 pt-12 text-white">
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-[#CCFF00] no-underline"
      >
        ← Back to Home
      </Link>

      <header className="mb-8 border-b border-white/10 pb-6">
        <p className="m-0 text-[11px] font-bold uppercase tracking-[0.2em] text-white/40">Endopamin</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">Terms of Service</h1>
        <p className="mt-2 text-sm text-white/50">Effective date: June 20, 2026</p>
      </header>

      <p className="mb-8 text-sm leading-7 text-white/75">
        These Terms of Service (&quot;Terms&quot;) govern your access to and use of Endopamin (&quot;we,&quot; &quot;us,&quot; or
        &quot;our&quot;). Please read them carefully before using the app.
      </p>

      <div className="space-y-8">
        {SECTIONS.map((section, index) => (
          <section key={section.title}>
            <h2 className="m-0 text-lg font-bold text-white">
              {index + 1}. {section.title}
            </h2>
            <div className="mt-3 space-y-3">
              {section.body.map(paragraph => (
                <p key={paragraph} className="m-0 text-sm leading-7 text-white/70">
                  {paragraph === 'info@endopamin.com' ? (
                    <a href="mailto:info@endopamin.com" className="font-semibold text-[#CCFF00] no-underline">
                      {paragraph}
                    </a>
                  ) : (
                    paragraph
                  )}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
