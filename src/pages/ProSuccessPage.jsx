export default function ProSuccessPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#080808] px-6 text-center text-white">
      <div className="mb-4 text-5xl">✓</div>
      <h1 className="m-0 text-2xl font-black text-[#CCFF00]">Welcome to Endopamin Pro</h1>
      <p className="mt-3 max-w-sm text-sm leading-6 text-white/70">
        Your payment was successful. Return to the Endopamin mobile app — Pro features unlock automatically.
      </p>
      <a
        href="/coach"
        className="mt-8 inline-flex rounded-2xl bg-[#CCFF00] px-6 py-3 text-sm font-black text-black no-underline"
      >
        Continue on Web
      </a>
    </div>
  );
}
