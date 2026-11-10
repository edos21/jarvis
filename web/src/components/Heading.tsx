// The title of a block; className places it (a margin below, or room in a header row).
export const Heading = ({ children, className = "mb-2" }: { children: React.ReactNode; className?: string }) => (
  <h2 className={`${className} text-body font-semibold`}>{children}</h2>
);
