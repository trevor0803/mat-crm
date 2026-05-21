export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-brand-card py-6 text-center text-xs text-brand-gold/60">
      MAT Digital • West Palm Beach • Built {year}
    </footer>
  );
}
