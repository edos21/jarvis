// The circle stays small; on the phone the button around it is a full finger wide, pulled left so the circle still
// lines up with the content edge.
export const TaskCheck = ({
  title,
  disabled,
  onClick,
  className = "",
}: {
  title: string;
  disabled: boolean;
  onClick: () => void;
  className?: string;
}) => (
  <button
    type="button"
    aria-label={`Marcar hecha: ${title}`}
    title="Marcar hecha"
    disabled={disabled}
    onClick={onClick}
    className={`group grid size-4 place-items-center max-sm:-ml-[13px] max-sm:mt-0 max-sm:size-11 ${className}`}
  >
    <span className="size-4 rounded-full border border-control transition-colors group-hover:border-accent group-disabled:border-line max-sm:size-[18px]" />
  </button>
);
