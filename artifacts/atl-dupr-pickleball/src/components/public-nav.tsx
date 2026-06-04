import { Link } from "wouter";

export function PublicNav() {
  return (
    <header className="bg-primary text-primary-foreground sticky top-0 z-40 shadow-md">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center">
            <img src="/logo-transparent.png" alt="Atlanta DUPR Pickleball" className="h-14 w-auto" />
          </Link>
        </div>
      </div>
    </header>
  );
}
