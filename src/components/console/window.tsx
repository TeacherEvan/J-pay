import type { ReactNode } from "react";

/**
 * Ops window chrome — the zero-scroll separation unit.
 * Title bar: mint pip + high-clarity paper title + optional aside (actions/badges).
 * Body fills the remaining flex height; children must fit or paginate, never scroll.
 */
export function ConsoleWindow({
  title,
  aside,
  className,
  bodyClassName,
  children,
  id,
}: {
  title: ReactNode;
  aside?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className={`window-surgical flex min-h-0 flex-col ${className ?? ""}`}>
      <div className="window-titlebar">
        <span className="window-pip" aria-hidden="true" />
        <h2 className="window-title">{title}</h2>
        {aside ? <div className="ml-auto flex shrink-0 items-center gap-2">{aside}</div> : null}
      </div>
      <div className={`min-h-0 flex-1 ${bodyClassName ?? "p-3 sm:p-4"}`}>{children}</div>
    </section>
  );
}
