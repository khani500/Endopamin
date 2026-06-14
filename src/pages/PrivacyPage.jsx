import { Link } from 'react-router-dom';

const SECTIONS = [
  {
    title: 'Information We Collect',
    body: [
      'When you use Endopamin, we collect information you provide directly and data generated through your use of the app:',
      'Account information: email address and authentication credentials managed through our auth provider.',
      'Profile data: display name, age, gender, fitness goals, experience level, body metrics, equipment preferences, injuries, diet preferences, and coach persona selection.',
      'Workout logs: exercises performed, sets, reps, duration, and timestamps.',
      'Nutrition logs: meals, calories, macros, and related food entries.',
      'Coach conversations: text and voice interactions with your AI coach, including session context used to personalize responses.',
      'Usage data: app interactions, notification preferences, and subscription status where applicable.',
    ],
  },
  {
    title: 'How We Use Your Information',
    body: [
      'We use your information to operate and improve Endopamin, including:',
      'Delivering personalized AI coaching based on your profile, goals, and activity history.',
      'Generating workout and nutrition plans tailored to your preferences and progress.',
      'Powering coach chat and voice responses with relevant context from your logs and profile.',
      'Tracking streaks, progress, personal records, and in-app achievements.',
      'Sending optional notifications such as workout reminders, streak alerts, and desk-break prompts.',
      'Processing Pro subscriptions and managing account access.',
      'Maintaining app security, troubleshooting issues, and improving features.',
    ],
  },
  {
    title: 'Third-Party Services',
    body: [
      'Endopamin relies on trusted third-party providers to deliver core functionality:',
      'Supabase — database storage, user authentication, and secure API access to your account data.',
      'Google Gemini AI — processing coach conversations and generating personalized fitness and nutrition content. Message content is sent to Google\'s API to produce AI responses.',
      'Stripe — secure payment processing for Endopamin Pro subscriptions. Stripe handles payment card data; we do not store full card numbers on our servers.',
      'Firebase — push notification delivery for workout reminders and app alerts when you opt in.',
      'These providers process data according to their own privacy policies and only as needed to provide their services to Endopamin.',
    ],
  },
  {
    title: 'Data Retention',
    body: [
      'We retain your account data for as long as your account is active so we can provide the service.',
      'If you delete your account, we remove your profile, workout logs, nutrition logs, coach memory, personal records, plans, notification settings, and related records from our database.',
      'Some data may be retained for a limited period where required by law, fraud prevention, or legitimate business needs (for example, billing records processed by Stripe).',
    ],
  },
  {
    title: 'Account Deletion',
    body: [
      'You can delete your account and all associated data at any time from the Profile screen in the app.',
      'Account deletion permanently removes your auth account, profile, logs, plans, coach memory, and other personal data stored in Endopamin.',
      'Deletion cannot be undone. If you have an active Pro subscription, cancel it through your payment provider before deleting your account.',
    ],
  },
  {
    title: 'Children\'s Privacy',
    body: [
      'Endopamin is not intended for children under 13 years of age.',
      'We do not knowingly collect personal information from children under 13. If you believe a child has provided us with personal data, contact us and we will take steps to delete it.',
    ],
  },
  {
    title: 'Changes to This Policy',
    body: [
      'We may update this Privacy Policy from time to time to reflect changes in our practices, technology, or legal requirements.',
      'When we make changes, we will update the "Last updated" date at the top of this page. Continued use of Endopamin after changes take effect means you accept the revised policy.',
    ],
  },
  {
    title: 'Contact Us',
    body: [
      'If you have questions about this Privacy Policy or how your data is handled, contact us at:',
      'info@endopamin.com',
    ],
  },
];

export default function PrivacyPage() {
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
        <h1 className="mt-2 text-3xl font-black tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-sm text-white/50">Last updated: June 2026</p>
      </header>

      <p className="mb-8 text-sm leading-7 text-white/75">
        Endopamin (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) respects your privacy. This policy explains what
        information we collect, how we use it, and the choices you have regarding your data.
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
