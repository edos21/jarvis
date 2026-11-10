import type { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "plain" | "danger" };

// A finger needs 44px; on the Mac the same controls stay compact.
export const touchTarget = "max-sm:min-h-11";

// Disabled reads through real tokens: text never fades with opacity.
export const disabledControl = "disabled:border-line disabled:bg-bg disabled:text-muted disabled:hover:brightness-100";

const VARIANTS = {
  primary: "bg-accent text-accent-ink border-accent hover:brightness-110",
  plain: "bg-surface text-ink border-control hover:border-accent",
  danger: "bg-surface text-critical border-control hover:border-critical",
};

export const Button = ({ variant = "plain", className = "", ...props }: Props) => (
  <button
    type="button"
    className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-body font-medium transition-colors max-sm:justify-center ${touchTarget} ${VARIANTS[variant]} ${disabledControl} ${className}`}
    {...props}
  />
);

// The text field every form uses: fieldBase sizes to its content, fieldClass fills its column.
export const fieldBase = `${touchTarget} rounded-md border border-control bg-surface px-2.5 py-1.5 text-body text-ink placeholder:text-muted focus:border-accent`;
export const fieldClass = `w-full ${fieldBase}`;

// A button that runs a mutation: disabled while it runs, and its error shown right next to it.
export const MutationButton = ({
  mutation,
  className = "",
  ...props
}: Props & { mutation: { isPending: boolean; error: Error | null } }) => (
  <span className={`inline-flex items-center gap-1.5 ${className}`}>
    <Button {...props} disabled={mutation.isPending || props.disabled} />
    {mutation.error && <span className="text-meta text-critical">{mutation.error.message}</span>}
  </span>
);

// newTab: false for app links (obsidian://) that open another app instead of a page.
export const LinkButton = ({ href, children, newTab = true }: { href: string; children: React.ReactNode; newTab?: boolean }) => (
  <a
    href={href}
    {...(newTab ? { target: "_blank", rel: "noreferrer" } : {})}
    className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-control bg-surface px-2.5 py-1 text-body font-medium text-ink transition-colors hover:border-accent max-sm:justify-center ${touchTarget}`}
  >
    {children}
  </a>
);
