export default function ProCancelPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#080808] px-6 text-center text-white">
      <h1 className="m-0 text-2xl font-black">Checkout canceled</h1>
      <p className="mt-3 max-w-sm text-sm leading-6 text-white/70">
        No charge was made. You can subscribe anytime from the Endopamin app.
      </p>
      <a
        href="/coach"
        className="mt-8 inline-flex rounded-2xl border border-white/20 px-6 py-3 text-sm font-bold text-white/80 no-underline"
      >
        Back to Endopamin
      </a>
    </div>
  );
}
