export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-cinema-black">
      <div className="text-center text-white">
        <h1 className="text-4xl font-semibold mb-4">
          {process.env.NEXT_PUBLIC_APP_NAME || 'StreamGate'}
        </h1>
        <p className="text-gray-400">Enter your access code to watch</p>
      </div>
    </main>
  );
}
